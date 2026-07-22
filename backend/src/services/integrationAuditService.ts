import prisma from '../utils/db.js';

export async function recordIntegrationAudit(entry: {
  companyId?: string | null;
  actorId: string;
  actorEmail?: string | null;
  action: string;
  method: string;
  path: string;
  statusCode?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.integrationAuditLog.create({
      data: {
        companyId: entry.companyId ?? null,
        actorId: entry.actorId,
        actorEmail: entry.actorEmail ?? null,
        action: entry.action,
        method: entry.method,
        path: entry.path,
        statusCode: entry.statusCode ?? null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      },
    });
  } catch (error) {
    // Audit logging must never break the request it's observing.
    console.error('Integration audit log write failed:', error);
  }
}
