import { Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';
import { decryptAuditEntries, verifyAuditChain } from '../services/auditChain.js';

function parsePagination(req: AuthenticatedRequest): { skip: number; take: number } {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query.limit ?? '50'), 10) || 50));
  return { skip: (page - 1) * limit, take: limit };
}

function parseDateRange(req: AuthenticatedRequest): { gte?: Date; lte?: Date } {
  const from = typeof req.query.from === 'string' ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === 'string' ? new Date(req.query.to) : undefined;
  return {
    gte: from && !Number.isNaN(from.getTime()) ? from : undefined,
    lte: to && !Number.isNaN(to.getTime()) ? to : undefined,
  };
}

export async function fetchActionLog(params: {
  adminId?: string;
  search?: string;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
}) {
  const { adminId, search, from, to, skip = 0, take = 50 } = params;
  const where: Prisma.AdminActionLogWhereInput = {
    ...(adminId ? { adminId } : {}),
    ...(from || to ? { createdAt: { gte: from, lte: to } } : {}),
    ...(search
      ? {
          OR: [
            { adminEmail: { contains: search, mode: 'insensitive' } },
            { path: { contains: search, mode: 'insensitive' } },
            { method: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [entries, total] = await Promise.all([
    prisma.adminActionLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.adminActionLog.count({ where }),
  ]);
  return { entries, total };
}

export async function fetchAuditLog(params: {
  resourceType?: string;
  search?: string;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
}) {
  const { resourceType, search, from, to, skip = 0, take = 50 } = params;
  const where: Prisma.AuditLogWhereInput = {
    ...(resourceType ? { resourceType } : {}),
    ...(from || to ? { createdAt: { gte: from, lte: to } } : {}),
    ...(search
      ? {
          OR: [
            { actorEmail: { contains: search, mode: 'insensitive' } },
            { resourceType: { contains: search, mode: 'insensitive' } },
            { resourceId: { contains: search, mode: 'insensitive' } },
            { action: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rawEntries, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.auditLog.count({ where }),
  ]);
  return { entries: decryptAuditEntries(rawEntries), total };
}

export async function fetchClickEvents(params: { adminId?: string; sessionId?: string; skip?: number; take?: number }) {
  const { adminId, sessionId, skip = 0, take = 50 } = params;
  const where: Prisma.AdminClickEventWhereInput = {
    ...(adminId ? { adminId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
  const [entries, total] = await Promise.all([
    prisma.adminClickEvent.findMany({ where, orderBy: { receivedAt: sessionId ? 'asc' : 'desc' }, skip, take }),
    prisma.adminClickEvent.count({ where }),
  ]);
  return { entries, total };
}

// Server-guaranteed action log — every authenticated admin API call.
export async function getActionLog(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { skip, take } = parsePagination(req);
    const { gte, lte } = parseDateRange(req);
    const adminId = typeof req.query.adminId === 'string' ? req.query.adminId : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const result = await fetchActionLog({ adminId, search, from: gte, to: lte, skip, take });
    res.json(result);
  } catch (error) {
    console.error('Get action log error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Before/after mutation trail — the "what changed" screen.
export async function getAuditLog(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { skip, take } = parsePagination(req);
    const { gte, lte } = parseDateRange(req);
    const resourceType = typeof req.query.resourceType === 'string' ? req.query.resourceType : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const result = await fetchAuditLog({ resourceType, search, from: gte, to: lte, skip, take });
    res.json(result);
  } catch (error) {
    console.error('Get audit log error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// CSV export of the same filtered set the Audit Log screen shows — capped
// at 5000 rows so an unbounded export can't take down the process.
export async function exportAuditLogCsv(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { gte, lte } = parseDateRange(req);
    const resourceType = typeof req.query.resourceType === 'string' ? req.query.resourceType : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const { entries } = await fetchAuditLog({ resourceType, search, from: gte, to: lte, skip: 0, take: 5000 });

    const header = ['createdAt', 'actorEmail', 'action', 'resourceType', 'resourceId', 'before', 'after'];
    const escapeCsv = (value: unknown): string => {
      const str = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
      return `"${str.replace(/"/g, '""')}"`;
    };
    const rows = entries.map((e) =>
      [e.createdAt.toISOString(), e.actorEmail, e.action, e.resourceType, e.resourceId, e.before, e.after]
        .map(escapeCsv)
        .join(',')
    );
    const csv = [header.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Export audit log CSV error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getAuditChainStatus(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const result = await verifyAuditChain();
    res.json(result);
  } catch (error) {
    console.error('Verify audit chain error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Client-reported UI click/navigation stream.
export async function getClickEvents(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { skip, take } = parsePagination(req);
    const adminId = typeof req.query.adminId === 'string' ? req.query.adminId : undefined;
    const result = await fetchClickEvents({ adminId, skip, take });
    res.json(result);
  } catch (error) {
    console.error('Get click events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Distinct click sessions for a given admin — the entry list for "Session
// Replay" (pick a session, then see its ordered click timeline).
export async function listClickSessions(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const adminId = typeof req.query.adminId === 'string' ? req.query.adminId : undefined;
    const grouped = await prisma.adminClickEvent.groupBy({
      by: ['sessionId', 'adminId', 'adminEmail'],
      where: adminId ? { adminId } : undefined,
      _min: { receivedAt: true },
      _max: { receivedAt: true },
      _count: { _all: true },
      orderBy: { _max: { receivedAt: 'desc' } },
      take: 100,
    });

    res.json({
      sessions: grouped.map((g) => ({
        sessionId: g.sessionId,
        adminId: g.adminId,
        adminEmail: g.adminEmail,
        startedAt: g._min.receivedAt,
        endedAt: g._max.receivedAt,
        eventCount: g._count._all,
      })),
    });
  } catch (error) {
    console.error('List click sessions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getClickSessionReplay(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { sessionId } = req.params;
    const result = await fetchClickEvents({ sessionId, take: 2000 });
    res.json(result);
  } catch (error) {
    console.error('Get click session replay error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
