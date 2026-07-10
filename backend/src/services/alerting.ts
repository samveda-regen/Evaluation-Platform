import type { Prisma } from '@prisma/client';
import prisma from '../utils/db.js';
import { sendPlainEmail } from './emailService.js';
import { emitToSuperAdminRoom } from './socketService.js';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertInput {
  type: string;
  severity: AlertSeverity;
  message: string;
  meta?: Record<string, unknown>;
  // A stable key scoping the cooldown (e.g. an adminId) — without one, the
  // cooldown is scoped to `type` alone. Prevents one noisy admin/route from
  // spamming every configured channel.
  cooldownKey?: string;
}

const COOLDOWN_MS = 15 * 60 * 1000;
const lastSentAt = new Map<string, number>();

let configCache: { config: Awaited<ReturnType<typeof loadConfig>>; expiresAt: number } | null = null;
const CONFIG_CACHE_TTL_MS = 10 * 1000;

async function loadConfig() {
  return prisma.alertConfig.upsert({
    where: { key: 'global' },
    update: {},
    create: { key: 'global', enabled: false },
  });
}

export function invalidateAlertConfigCache(): void {
  configCache = null;
}

export async function getAlertConfig() {
  if (configCache && configCache.expiresAt > Date.now()) return configCache.config;
  const config = await loadConfig();
  configCache = { config, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
  return config;
}

async function deliver(config: Awaited<ReturnType<typeof loadConfig>>, alert: AlertInput): Promise<{ delivered: boolean; error?: string }> {
  const errors: string[] = [];
  let anySent = false;

  if (config.emailTo) {
    try {
      await sendPlainEmail({
        to: config.emailTo,
        subject: `[${alert.severity.toUpperCase()}] ${alert.type}`,
        text: `${alert.message}\n\n${alert.meta ? JSON.stringify(alert.meta, null, 2) : ''}`,
      });
      anySent = true;
    } catch (error) {
      errors.push(`email: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  if (config.slackWebhookUrl) {
    try {
      const response = await fetch(config.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `*[${alert.severity.toUpperCase()}] ${alert.type}*\n${alert.message}` }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`Slack webhook responded ${response.status}`);
      anySent = true;
    } catch (error) {
      errors.push(`slack: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  if (config.genericWebhookUrl) {
    try {
      const response = await fetch(config.genericWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alert),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`Webhook responded ${response.status}`);
      anySent = true;
    } catch (error) {
      errors.push(`webhook: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  return { delivered: anySent, error: errors.length > 0 ? errors.join('; ') : undefined };
}

// Always persists an AlertLog row (so the superadmin console has a history
// even if no delivery channel is configured yet) and pushes it live over the
// socket. Delivery to email/Slack/webhook only happens if alerting is
// enabled and a cooldown for this type+subject hasn't been hit.
export async function sendAlert(alert: AlertInput): Promise<void> {
  const cooldownScope = `${alert.type}:${alert.cooldownKey ?? ''}`;
  const now = Date.now();
  const last = lastSentAt.get(cooldownScope);
  const withinCooldown = last !== undefined && now - last < COOLDOWN_MS;

  let delivered = false;
  let deliveryError: string | undefined;

  try {
    const config = await getAlertConfig();
    if (config.enabled && !withinCooldown) {
      const result = await deliver(config, alert);
      delivered = result.delivered;
      deliveryError = result.error;
      lastSentAt.set(cooldownScope, now);
    }
  } catch (error) {
    console.error('Alert delivery failed:', error);
    deliveryError = error instanceof Error ? error.message : 'unknown error';
  }

  try {
    const row = await prisma.alertLog.create({
      data: {
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
        meta: (alert.meta ?? undefined) as Prisma.InputJsonValue | undefined,
        delivered,
        deliveryError,
      },
    });
    emitToSuperAdminRoom('alert-created', row);
  } catch (error) {
    console.error('Failed to persist alert log:', error);
  }
}
