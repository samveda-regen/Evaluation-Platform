import { Response, NextFunction } from 'express';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';
import { emitToSuperAdminRoom } from '../services/socketService.js';
import { recordActionOutcome, recordApiLatencySample } from '../services/telemetryRingBuffer.js';
import { sendAlert } from '../services/alerting.js';

// Lightweight in-memory spike detectors — deliberately simple sliding
// windows rather than a persisted ring buffer, since these only need to
// catch "unusually bursty" behavior in the moment, not produce historical
// analytics (that's what AdminActionLog itself is for).
const DELETE_WINDOW_MS = 2 * 60 * 1000;
const DELETE_THRESHOLD = 5;
const deleteTimestamps = new Map<string, number[]>();

function checkMassDelete(adminId: string): number {
  const now = Date.now();
  const recent = (deleteTimestamps.get(adminId) ?? []).filter((t) => now - t < DELETE_WINDOW_MS);
  recent.push(now);
  deleteTimestamps.set(adminId, recent);
  return recent.length;
}

const EXPORT_WINDOW_MS = 10 * 60 * 1000;
const EXPORT_THRESHOLD = 3;
const exportTimestamps = new Map<string, number[]>();

function checkBulkExport(adminId: string): number {
  const now = Date.now();
  const recent = (exportTimestamps.get(adminId) ?? []).filter((t) => now - t < EXPORT_WINDOW_MS);
  recent.push(now);
  exportTimestamps.set(adminId, recent);
  return recent.length;
}

// Short-lived cache so we don't hit the DB for an admin's display name on
// every single request — the log itself still writes on every request.
interface CachedName {
  name: string;
  expiresAt: number;
}
const nameCache = new Map<string, CachedName>();
const NAME_CACHE_TTL_MS = 5 * 60 * 1000;

async function resolveAdminName(adminId: string, fallbackEmail: string): Promise<string> {
  const now = Date.now();
  const cached = nameCache.get(adminId);
  if (cached && cached.expiresAt > now) {
    return cached.name;
  }

  try {
    const admin = await prisma.admin.findUnique({ where: { id: adminId }, select: { name: true } });
    const name = admin?.name ?? fallbackEmail;
    nameCache.set(adminId, { name, expiresAt: now + NAME_CACHE_TTL_MS });
    return name;
  } catch {
    return fallbackEmail;
  }
}

// Registered globally, before route mounting. `req` is one mutable object
// threaded through the whole middleware chain, so this listener (attached
// early) still observes `req.admin` once the route's own `adminAuth` sets
// it later — `finish` only fires after the full request lifecycle
// (including the controller) completes. This is what makes the log
// complete regardless of which specific route handled the request, without
// having to touch every route file.
//
// One structural gap: `req.admin` is only ever set *after* a valid token,
// so login attempts (success or failure) never reach this middleware.
// Those are logged explicitly inside `loginAdmin` itself instead.
export function adminActionLogger(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const startedAt = Date.now();

  res.on('finish', () => {
    void (async () => {
      const admin = req.admin;
      if (!admin) return;

      const durationMs = Date.now() - startedAt;
      recordActionOutcome(res.statusCode);
      recordApiLatencySample(durationMs);

      if (res.statusCode < 400) {
        const path = req.originalUrl.split('?')[0];
        if (req.method === 'DELETE') {
          const count = checkMassDelete(admin.id);
          if (count >= DELETE_THRESHOLD) {
            void sendAlert({
              type: 'mass_delete',
              severity: 'warning',
              message: `${admin.email} made ${count} delete requests in the last 2 minutes.`,
              meta: { adminId: admin.id, path },
              cooldownKey: admin.id,
            });
          }
        }
        if (path.includes('/export')) {
          const count = checkBulkExport(admin.id);
          if (count >= EXPORT_THRESHOLD) {
            void sendAlert({
              type: 'bulk_export',
              severity: 'info',
              message: `${admin.email} exported results ${count} times in the last 10 minutes.`,
              meta: { adminId: admin.id, path },
              cooldownKey: admin.id,
            });
          }
        }
      }

      try {
        const adminName = await resolveAdminName(admin.id, admin.email);
        const row = await prisma.adminActionLog.create({
          data: {
            adminId: admin.id,
            adminEmail: admin.email,
            adminName,
            method: req.method,
            path: req.originalUrl.split('?')[0],
            statusCode: res.statusCode,
            durationMs,
            ip: req.ip,
            userAgent: req.headers['user-agent']?.toString().slice(0, 300),
          },
        });
        emitToSuperAdminRoom('admin-action', row);
      } catch (error) {
        console.error('adminActionLogger failed to persist an admin action:', error);
      }
    })();
  });

  next();
}
