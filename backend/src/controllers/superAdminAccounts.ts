import { Response } from 'express';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';
import {
  performAdminCascadeDelete,
  scheduleAdminDeletion,
  cancelAdminDeletion,
  ForeignReferenceError,
} from '../services/softDelete.js';
import { generateAdminImpersonationToken } from '../utils/jwt.js';
import { createAuditLogEntry } from '../services/auditChain.js';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export async function fetchAdminAccounts() {
  const admins = await prisma.admin.findMany({
    include: {
      company: true,
      _count: { select: { tests: true, mcqQuestions: true, codingQuestions: true, behavioralQuestions: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const latestActions = await prisma.adminActionLog.groupBy({
    by: ['adminId'],
    where: { adminId: { in: admins.map((a) => a.id) } },
    _max: { createdAt: true },
    _count: { _all: true },
  });
  const latestByAdmin = new Map(latestActions.map((row) => [row.adminId, row]));

  const now = Date.now();
  return admins.map((admin) => {
    const latest = latestByAdmin.get(admin.id);
    const lastActiveAt = latest?._max.createdAt ?? null;
    const isOnline = lastActiveAt ? now - new Date(lastActiveAt).getTime() < ONLINE_WINDOW_MS : false;

    return {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      companyName: admin.company?.name ?? null,
      createdAt: admin.createdAt,
      lastActiveAt,
      status: isOnline ? 'online' : 'offline',
      actionsRecorded: latest?._count._all ?? 0,
      ownedContent: {
        tests: admin._count.tests,
        mcqQuestions: admin._count.mcqQuestions,
        codingQuestions: admin._count.codingQuestions,
        behavioralQuestions: admin._count.behavioralQuestions,
      },
      securityLocked: admin.securityLocked,
      securityLockReason: admin.securityLockReason,
      pendingDeletionAt: admin.pendingDeletionAt,
      deletionReason: admin.deletionReason,
    };
  });
}

export async function listAdminAccounts(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const admins = await fetchAdminAccounts();
    res.json({ admins });
  } catch (error) {
    console.error('List admin accounts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Deletes right now, skipping the grace period — kept for cases where the
// superadmin explicitly wants an account gone immediately (confirmed via a
// separate checkbox in the UI). The default action is scheduleDeleteAdminAccount.
export async function deleteAdminAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { adminId } = req.params;
    const result = await performAdminCascadeDelete(adminId, req.superAdmin!.email);
    res.json({ message: 'Admin account deleted', summary: result.summary });
  } catch (error) {
    if (error instanceof ForeignReferenceError) {
      res.status(409).json({ error: 'admin_content_referenced_elsewhere', message: error.message });
      return;
    }
    if (error instanceof Error && error.message === 'admin_not_found') {
      res.status(404).json({ error: 'Admin not found' });
      return;
    }
    console.error('Delete admin account error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// The default, reversible deletion path — marks the account for deletion
// in 7 days. It keeps working normally until then; the scheduled job in
// index.ts performs the real delete once the grace period elapses.
export async function scheduleDeleteAdminAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { adminId } = req.params;
    const { reason } = req.body as { reason?: string };

    const admin = await prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin) {
      res.status(404).json({ error: 'Admin not found' });
      return;
    }

    const updated = await scheduleAdminDeletion(adminId, reason, req.superAdmin!.email);
    res.json({ message: 'Deletion scheduled', pendingDeletionAt: updated.pendingDeletionAt });
  } catch (error) {
    console.error('Schedule admin deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function cancelDeleteAdminAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { adminId } = req.params;
    await cancelAdminDeletion(adminId, req.superAdmin!.email);
    res.json({ message: 'Scheduled deletion cancelled' });
  } catch (error) {
    console.error('Cancel admin deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Mints a 15-minute admin token so the superadmin can see exactly what an
// admin sees, for debugging. Loudly audit-logged — this is the one action
// in the whole console that lets a superadmin act with an admin's own
// identity, so it gets the most visible possible trail.
export async function impersonateAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { adminId } = req.params;
    const admin = await prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin) {
      res.status(404).json({ error: 'Admin not found' });
      return;
    }

    const token = generateAdminImpersonationToken({
      id: admin.id,
      email: admin.email,
      role: 'admin',
      impersonatedBy: req.superAdmin!.email,
    });

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'create',
      resourceType: 'AdminImpersonation',
      resourceId: adminId,
      after: { targetEmail: admin.email, expiresInMinutes: 15 },
    });

    res.json({ token, adminEmail: admin.email, expiresInMinutes: 15 });
  } catch (error) {
    console.error('Impersonate admin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
