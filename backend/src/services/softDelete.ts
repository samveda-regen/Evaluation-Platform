import { QuestionSource } from '@prisma/client';
import prisma from '../utils/db.js';
import { cascadeDeleteTestTx } from '../controllers/test.js';
import { createAuditLogEntry } from './auditChain.js';
import { emitToSuperAdminRoom } from './socketService.js';
import { sendAlert } from './alerting.js';

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export class ForeignReferenceError extends Error {}

export interface CascadeDeleteSummary {
  testsDeleted: number;
  mcqQuestionsDeleted: number;
  codingQuestionsDeleted: number;
  behavioralQuestionsDeleted: number;
}

// The actual irreversible cascade-delete — shared by the "delete
// immediately" path and the scheduled job that runs once a soft-deleted
// admin's grace period has elapsed. Never called directly by a route
// anymore; both entry points go through this so there's exactly one place
// that performs the real deletion.
export async function performAdminCascadeDelete(
  adminId: string,
  actorEmail: string
): Promise<{ admin: { email: string; name: string }; summary: CascadeDeleteSummary }> {
  const admin = await prisma.admin.findUnique({ where: { id: adminId } });
  if (!admin) {
    throw new Error('admin_not_found');
  }

  const [ownedMcq, ownedCoding, ownedBehavioral] = await Promise.all([
    prisma.mCQQuestion.findMany({ where: { adminId, source: QuestionSource.CUSTOM }, select: { id: true } }),
    prisma.codingQuestion.findMany({ where: { adminId, source: QuestionSource.CUSTOM }, select: { id: true } }),
    prisma.behavioralQuestion.findMany({ where: { adminId, source: QuestionSource.CUSTOM }, select: { id: true } }),
  ]);

  const foreignReference = await prisma.testQuestion.findFirst({
    where: {
      test: { adminId: { not: adminId } },
      OR: [
        { mcqQuestionId: { in: ownedMcq.map((q) => q.id) } },
        { codingQuestionId: { in: ownedCoding.map((q) => q.id) } },
        { behavioralQuestionId: { in: ownedBehavioral.map((q) => q.id) } },
      ],
    },
    select: { id: true },
  });
  if (foreignReference) {
    throw new ForeignReferenceError(
      "One of this admin's custom questions is used by another admin's test. Remove that reference before deleting this account."
    );
  }

  const ownedTests = await prisma.test.findMany({ where: { adminId }, select: { id: true } });
  const summary: CascadeDeleteSummary = {
    testsDeleted: ownedTests.length,
    mcqQuestionsDeleted: ownedMcq.length,
    codingQuestionsDeleted: ownedCoding.length,
    behavioralQuestionsDeleted: ownedBehavioral.length,
  };

  await prisma.$transaction(async (tx) => {
    for (const test of ownedTests) {
      await cascadeDeleteTestTx(tx, test.id);
    }
    if (ownedMcq.length > 0) await tx.mCQQuestion.deleteMany({ where: { id: { in: ownedMcq.map((q) => q.id) } } });
    if (ownedCoding.length > 0) await tx.codingQuestion.deleteMany({ where: { id: { in: ownedCoding.map((q) => q.id) } } });
    if (ownedBehavioral.length > 0)
      await tx.behavioralQuestion.deleteMany({ where: { id: { in: ownedBehavioral.map((q) => q.id) } } });

    // AdminActionLog / AuditLog / AdminClickEvent rows are intentionally
    // left untouched — their adminId FK is SetNull, not Cascade, so this
    // admin's oversight history survives the account deletion below.
    await tx.admin.delete({ where: { id: adminId } });
  });

  await createAuditLogEntry({
    actorAdminId: null,
    actorEmail: actorEmail,
    action: 'delete',
    resourceType: 'Admin',
    resourceId: adminId,
    before: { email: admin.email, name: admin.name, ...summary },
  });

  emitToSuperAdminRoom('audit-entry', {
    action: 'delete',
    resourceType: 'Admin',
    resourceId: adminId,
    actorEmail,
    summary,
    timestamp: new Date().toISOString(),
  });

  return { admin: { email: admin.email, name: admin.name }, summary };
}

// Marks an admin for deletion after a 7-day grace period rather than
// deleting immediately — the default, reversible path. The account keeps
// working normally the whole time; only the scheduled job at the end of
// the window actually removes anything.
export async function scheduleAdminDeletion(adminId: string, reason: string | undefined, actorEmail: string) {
  const pendingDeletionAt = new Date(Date.now() + GRACE_PERIOD_MS);
  const admin = await prisma.admin.update({
    where: { id: adminId },
    data: { pendingDeletionAt, deletionReason: reason ?? null, deletionScheduledByEmail: actorEmail },
  });

  await createAuditLogEntry({
    actorAdminId: null,
    actorEmail,
    action: 'update',
    resourceType: 'AdminDeletion',
    resourceId: adminId,
    after: { pendingDeletionAt: pendingDeletionAt.toISOString(), reason },
  });

  emitToSuperAdminRoom('admin-deletion-scheduled', { adminId, pendingDeletionAt });
  return admin;
}

export async function cancelAdminDeletion(adminId: string, actorEmail: string) {
  const admin = await prisma.admin.update({
    where: { id: adminId },
    data: { pendingDeletionAt: null, deletionReason: null, deletionScheduledByEmail: null },
  });

  await createAuditLogEntry({
    actorAdminId: null,
    actorEmail,
    action: 'update',
    resourceType: 'AdminDeletion',
    resourceId: adminId,
    after: { cancelled: true },
  });

  emitToSuperAdminRoom('admin-deletion-cancelled', { adminId });
  return admin;
}

// Periodic job (see index.ts) — performs the real cascade-delete for any
// admin whose grace period has elapsed.
export async function runScheduledDeletions(): Promise<void> {
  try {
    const due = await prisma.admin.findMany({
      where: { pendingDeletionAt: { lte: new Date() } },
      select: { id: true, email: true, deletionScheduledByEmail: true },
    });

    for (const admin of due) {
      try {
        await performAdminCascadeDelete(admin.id, admin.deletionScheduledByEmail ?? 'system');
        await sendAlert({
          type: 'scheduled_deletion_completed',
          severity: 'info',
          message: `Scheduled deletion completed for ${admin.email}.`,
          meta: { adminId: admin.id },
        });
      } catch (error) {
        console.error(`Scheduled deletion failed for admin ${admin.id}:`, error);
      }
    }
  } catch (error) {
    console.error('runScheduledDeletions failed:', error);
  }
}
