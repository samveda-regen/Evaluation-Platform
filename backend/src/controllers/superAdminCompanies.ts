import { Response } from 'express';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';
import { createAuditLogEntry } from '../services/auditChain.js';
import { emitToSuperAdminRoom } from '../services/socketService.js';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export async function listCompanies(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const companies = await prisma.company.findMany({
      include: { _count: { select: { admins: true, tests: true, candidates: true } } },
      orderBy: { name: 'asc' },
    });

    res.json({
      companies: companies.map((company) => ({
        id: company.id,
        externalCompanyId: company.externalCompanyId,
        name: company.name,
        webhookConfigured: Boolean(company.webhookUrl),
        createdAt: company.createdAt,
        adminCount: company._count.admins,
        testCount: company._count.tests,
        candidateCount: company._count.candidates,
      })),
    });
  } catch (error) {
    console.error('List companies error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getCompanyDetail(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { companyId } = req.params;
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: { _count: { select: { admins: true, tests: true, candidates: true } } },
    });
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    const admins = await prisma.admin.findMany({
      where: { companyId },
      select: { id: true, email: true, name: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const latestActions = await prisma.adminActionLog.groupBy({
      by: ['adminId'],
      where: { adminId: { in: admins.map((a) => a.id) } },
      _max: { createdAt: true },
    });
    const lastActiveByAdmin = new Map(latestActions.map((row) => [row.adminId, row._max.createdAt]));

    const now = Date.now();
    res.json({
      company: {
        id: company.id,
        externalCompanyId: company.externalCompanyId,
        name: company.name,
        webhookConfigured: Boolean(company.webhookUrl),
        createdAt: company.createdAt,
        adminCount: company._count.admins,
        testCount: company._count.tests,
        candidateCount: company._count.candidates,
      },
      admins: admins.map((admin) => {
        const lastActiveAt = lastActiveByAdmin.get(admin.id) ?? null;
        const isOnline = lastActiveAt ? now - new Date(lastActiveAt).getTime() < ONLINE_WINDOW_MS : false;
        return {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          createdAt: admin.createdAt,
          status: isOnline ? 'online' : 'offline',
        };
      }),
    });
  } catch (error) {
    console.error('Get company detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function renameCompany(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { companyId } = req.params;
    const { name } = req.body as { name?: string };
    if (!name || !name.trim()) {
      res.status(400).json({ error: '"name" is required' });
      return;
    }

    const existing = await prisma.company.findUnique({ where: { id: companyId } });
    if (!existing) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    const company = await prisma.company.update({
      where: { id: companyId },
      data: { name: name.trim() },
    });

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'update',
      resourceType: 'Company',
      resourceId: companyId,
      before: { name: existing.name },
      after: { name: company.name },
    });

    emitToSuperAdminRoom('company-renamed', { companyId, name: company.name });
    res.json({ company: { id: company.id, name: company.name } });
  } catch (error) {
    console.error('Rename company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
