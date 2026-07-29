import { Response } from 'express';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sendAlert, invalidateAlertConfigCache } from '../services/alerting.js';

export async function getAlertConfigSettings(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const config = await prisma.alertConfig.upsert({
      where: { key: 'global' },
      update: {},
      create: { key: 'global', enabled: false },
    });
    res.json({ config });
  } catch (error) {
    console.error('Get alert config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateAlertConfigSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { enabled, emailTo, slackWebhookUrl, genericWebhookUrl, apiLatencyP95ThresholdMs, sustainedMinutes } =
      req.body as {
        enabled?: boolean;
        emailTo?: string | null;
        slackWebhookUrl?: string | null;
        genericWebhookUrl?: string | null;
        apiLatencyP95ThresholdMs?: number | null;
        sustainedMinutes?: number;
      };

    const config = await prisma.alertConfig.upsert({
      where: { key: 'global' },
      update: {
        ...(enabled !== undefined ? { enabled } : {}),
        ...(emailTo !== undefined ? { emailTo } : {}),
        ...(slackWebhookUrl !== undefined ? { slackWebhookUrl } : {}),
        ...(genericWebhookUrl !== undefined ? { genericWebhookUrl } : {}),
        ...(apiLatencyP95ThresholdMs !== undefined ? { apiLatencyP95ThresholdMs } : {}),
        ...(sustainedMinutes !== undefined ? { sustainedMinutes } : {}),
        updatedByEmail: req.superAdmin!.email,
      },
      create: {
        key: 'global',
        enabled: enabled ?? false,
        emailTo,
        slackWebhookUrl,
        genericWebhookUrl,
        apiLatencyP95ThresholdMs,
        sustainedMinutes: sustainedMinutes ?? 5,
        updatedByEmail: req.superAdmin!.email,
      },
    });
    invalidateAlertConfigCache();
    res.json({ config });
  } catch (error) {
    console.error('Update alert config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function sendTestAlert(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    await sendAlert({
      type: 'test_alert',
      severity: 'info',
      message: `Test alert sent by ${req.superAdmin!.email} from the superadmin console.`,
      cooldownKey: 'test',
    });
    res.json({ message: 'Test alert dispatched — check your configured channels.' });
  } catch (error) {
    console.error('Send test alert error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function listAlerts(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query.limit ?? '50'), 10) || 50));

    const [entries, total] = await Promise.all([
      prisma.alertLog.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.alertLog.count(),
    ]);
    res.json({ entries, total });
  } catch (error) {
    console.error('List alerts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
