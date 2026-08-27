import { Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';
import { createAuditLogEntry } from '../services/auditChain.js';
import { dispatchCompanyWebhookEvent } from '../services/candidateScoreWebhookService.js';

const PAGE_SIZE = 50;

export async function listWebhookDeliveries(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { companyId, success } = req.query as { companyId?: string; success?: string };
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);

    const where: Prisma.WebhookDeliveryLogWhereInput = {};
    if (companyId) where.companyId = companyId;
    if (success === 'true') where.success = true;
    if (success === 'false') where.success = false;

    const [deliveries, total] = await Promise.all([
      prisma.webhookDeliveryLog.findMany({
        where,
        include: { company: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.webhookDeliveryLog.count({ where }),
    ]);

    res.json({
      deliveries: deliveries.map((d) => ({
        id: d.id,
        companyId: d.companyId,
        companyName: d.company.name,
        event: d.event,
        url: d.url,
        statusCode: d.statusCode,
        success: d.success,
        error: d.error,
        durationMs: d.durationMs,
        attempt: d.attempt,
        createdAt: d.createdAt,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (error) {
    console.error('List webhook deliveries error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function retryWebhookDelivery(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { logId } = req.params;
    const original = await prisma.webhookDeliveryLog.findUnique({ where: { id: logId } });
    if (!original) {
      res.status(404).json({ error: 'Delivery log not found' });
      return;
    }

    await createAuditLogEntry({
      actorAdminId: null,
      actorEmail: req.superAdmin!.email,
      action: 'update',
      resourceType: 'WebhookDeliveryLog',
      resourceId: logId,
      before: null,
      after: { retriedEvent: original.event, companyId: original.companyId },
    });

    // Dispatches synchronously (with its own timeout) and writes its own new
    // WebhookDeliveryLog row on completion — the caller just needs the ack.
    await dispatchCompanyWebhookEvent(
      original.companyId,
      original.event,
      original.payload as Record<string, unknown>,
      original.attempt + 1
    );

    res.json({ message: 'Retry dispatched — check the log for the new delivery attempt.' });
  } catch (error) {
    console.error('Retry webhook delivery error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
