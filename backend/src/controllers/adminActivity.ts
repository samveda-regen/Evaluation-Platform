import { Request, Response } from 'express';
import prisma from '../utils/db.js';
import { AuthenticatedRequest, AdminPayload } from '../types/index.js';
import { emitToSuperAdminRoom } from '../services/socketService.js';
import { verifyToken } from '../utils/jwt.js';

interface IncomingClickEvent {
  sessionId?: string;
  eventType?: string;
  targetLabel?: string;
  targetSelector?: string;
  route?: string;
  x?: number;
  y?: number;
  clientTimestamp?: string | number;
  metadata?: Record<string, unknown>;
}

const MAX_BATCH_SIZE = 200;

async function persistClickBatch(admin: AdminPayload, events: IncomingClickEvent[]): Promise<number> {
  const trimmed = events.slice(0, MAX_BATCH_SIZE);
  const rows = trimmed
    .filter((e) => typeof e.eventType === 'string' && e.eventType.length > 0)
    .map((e) => ({
      adminId: admin.id,
      adminEmail: admin.email,
      sessionId: typeof e.sessionId === 'string' && e.sessionId ? e.sessionId : 'unknown',
      eventType: e.eventType!.slice(0, 100),
      targetLabel: e.targetLabel ? String(e.targetLabel).slice(0, 200) : null,
      targetSelector: e.targetSelector ? String(e.targetSelector).slice(0, 300) : null,
      route: e.route ? String(e.route).slice(0, 300) : null,
      metadata:
        typeof e.x === 'number' || typeof e.y === 'number' || e.metadata
          ? { x: e.x, y: e.y, ...(e.metadata || {}) }
          : undefined,
      clientTimestamp: e.clientTimestamp ? new Date(e.clientTimestamp) : new Date(),
    }));

  if (rows.length === 0) return 0;

  await prisma.adminClickEvent.createMany({ data: rows });
  emitToSuperAdminRoom('admin-click-batch', {
    adminId: admin.id,
    adminEmail: admin.email,
    count: rows.length,
    events: rows,
  });
  return rows.length;
}

// Best-effort UI-level click/navigation stream, supplementing the
// server-guaranteed AdminActionLog with interactions that never hit the
// network (opening a modal, focusing a field, etc). Any authenticated
// admin may report their own clicks.
export async function recordAdminClicks(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const admin = req.admin!;
    const events: IncomingClickEvent[] = Array.isArray(req.body?.events) ? req.body.events : [];
    const accepted = await persistClickBatch(admin, events);
    res.json({ accepted });
  } catch (error) {
    console.error('Record admin clicks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// navigator.sendBeacon cannot set an Authorization header, so the final
// flush on tab close/hide goes through this dedicated endpoint instead,
// with the admin's token passed as a query param and verified manually.
// Scoped to exactly this one low-stakes, best-effort catch-up path — every
// other admin route keeps using the header-based adminAuth middleware.
export async function recordAdminClicksBeacon(req: Request, res: Response): Promise<void> {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const payload = token ? verifyToken(token) : null;

    if (!payload || payload.role !== 'admin') {
      res.status(401).end();
      return;
    }

    let body: { events?: IncomingClickEvent[] } = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      body = {};
    }

    const events = Array.isArray(body?.events) ? body.events : [];
    await persistClickBatch(payload as AdminPayload, events);
    res.status(204).end();
  } catch (error) {
    console.error('Record admin clicks (beacon) error:', error);
    res.status(500).end();
  }
}
