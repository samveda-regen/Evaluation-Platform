import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { emitToSuperAdminRoom } from '../services/socketService.js';
import { createAuditLogEntry } from '../services/auditChain.js';

const SENSITIVE_KEYS = new Set(['password', 'token', 'refreshtoken', 'resetpasswordtokenhash']);
const MAX_STRING_LENGTH = 2000;

// Response bodies in this codebase are usually `{ message, <resource>: {...} }`
// (e.g. `{ message, test: {...} }`) rather than the resource at the top
// level, so the id has to be found one level down too.
function extractResourceId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const obj = body as Record<string, unknown>;
  if (typeof obj.id === 'string') return obj.id;

  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).id === 'string') {
      return (value as Record<string, unknown>).id as string;
    }
  }
  return undefined;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…(truncated)` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1);
    }
    return result;
  }
  return value;
}

interface AuditLogOptions {
  resourceType: string;
  action: 'create' | 'update' | 'delete';
  resourceIdParam?: string;
  fetchBefore?: (resourceId: string) => Promise<unknown>;
}

// Curated, per-route audit trail for mutating admin actions — the "what
// changed" screen. Deliberately scoped to a handful of high-value resources
// rather than an exhaustive generic diff engine (see plan). Runs `next()`
// immediately so it never blocks the request; the actual write happens
// after the response has already been sent.
export function auditLog(options: AuditLogOptions) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const resourceId = options.resourceIdParam ? req.params[options.resourceIdParam] : undefined;

    const beforePromise: Promise<unknown> =
      options.action !== 'create' && options.fetchBefore && resourceId
        ? options.fetchBefore(resourceId).catch(() => null)
        : Promise.resolve(null);

    let capturedBody: unknown = null;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      capturedBody = body;
      return originalJson(body);
    }) as typeof res.json;

    res.on('finish', () => {
      void (async () => {
        if (res.statusCode >= 400) return;

        const admin = req.admin;
        const before = await beforePromise;
        const resolvedResourceId = resourceId ?? extractResourceId(capturedBody);

        try {
          const row = await createAuditLogEntry({
            actorAdminId: admin?.id ?? null,
            actorEmail: admin?.email ?? 'unknown',
            action: options.action,
            resourceType: options.resourceType,
            resourceId: resolvedResourceId ?? null,
            before: redact(before),
            after: redact(capturedBody),
          });
          emitToSuperAdminRoom('audit-entry', row);
        } catch (error) {
          console.error('auditLog middleware failed to persist entry:', error);
        }
      })();
    });

    next();
  };
}
