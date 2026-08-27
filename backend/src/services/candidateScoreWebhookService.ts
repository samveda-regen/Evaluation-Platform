import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../utils/db.js';
import { decryptSecret } from '../utils/secretEncryption.js';

type CandidateScoreWebhookPayload = {
  name: string;
  emailid: string;
  score: number;
  totalMarks: number;
  testid: string;
  status: string;
  passingMarks: number | null;
  result: 'passed' | 'failed' | null;
};

const DEFAULT_TIMEOUT_MS = 5000;

function getWebhookUrl(): string {
  return (process.env.CANDIDATE_SCORE_WEBHOOK_URL || '').trim();
}

function getTimeoutMs(): number {
  const configured = Number.parseInt(process.env.CANDIDATE_SCORE_WEBHOOK_TIMEOUT_MS || '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

export async function sendCandidateScoreWebhook(payload: CandidateScoreWebhookPayload): Promise<void> {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      console.error(
        `Candidate score webhook failed with status ${response.status}: ${responseText || response.statusText}`
      );
      return;
    }

    console.info(`Candidate score webhook sent for test ${payload.testid} (${payload.emailid})`);
  } catch (error) {
    console.error('Candidate score webhook error:', error);
  } finally {
    clearTimeout(timeout);
  }
}

interface WebhookDeliveryLogInput {
  companyId: string;
  event: string;
  url: string;
  payload: Record<string, unknown>;
  statusCode: number | null;
  success: boolean;
  error: string | null;
  durationMs: number;
  attempt: number;
}

// Fire-and-forget by design (own try/catch) — a logging failure must never surface
// as a webhook-dispatch failure, and dispatchCompanyWebhookEvent's callers don't
// expect this side-channel write to affect their own await/error handling.
async function logWebhookDelivery(input: WebhookDeliveryLogInput): Promise<void> {
  try {
    await prisma.webhookDeliveryLog.create({
      data: {
        companyId: input.companyId,
        event: input.event,
        url: input.url,
        payload: input.payload as Prisma.InputJsonValue,
        statusCode: input.statusCode,
        success: input.success,
        error: input.error,
        durationMs: input.durationMs,
        attempt: input.attempt,
      },
    });
  } catch (error) {
    console.error('Failed to record webhook delivery log:', error);
  }
}

// Per-company push events (invitation.sent, test.started, test.completed) for
// recruiter-platform partners that configured a webhookUrl on their Company row,
// as an alternative to polling GET /integration/tests/:testId/results. Every
// attempt (success or failure) is recorded to WebhookDeliveryLog so a superadmin
// can see delivery health and replay a failed payload — see superAdminWebhooks.ts.
export async function dispatchCompanyWebhookEvent(
  companyId: string | null | undefined,
  event: string,
  data: Record<string, unknown>,
  attempt: number = 1
): Promise<void> {
  if (!companyId) {
    return;
  }

  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { webhookUrl: true, webhookSecret: true },
    });

    if (!company?.webhookUrl) {
      return;
    }

    const body = JSON.stringify({ event, companyId, data, timestamp: new Date().toISOString() });
    const signature = company.webhookSecret
      ? createHmac('sha256', decryptSecret(company.webhookSecret)).update(body).digest('hex')
      : undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
    const startedAt = Date.now();

    try {
      const response = await fetch(company.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(signature ? { 'X-TalentStaq-Signature': `sha256=${signature}` } : {}),
        },
        body,
        signal: controller.signal,
      });
      const durationMs = Date.now() - startedAt;

      if (!response.ok) {
        const responseText = await response.text().catch(() => '');
        const errorMessage = responseText || response.statusText;
        console.error(`Company webhook (${event}) failed with status ${response.status}: ${errorMessage}`);
        await logWebhookDelivery({
          companyId, event, url: company.webhookUrl, payload: data,
          statusCode: response.status, success: false, error: errorMessage, durationMs, attempt,
        });
        return;
      }

      console.info(`Company webhook (${event}) sent for company ${companyId}`);
      await logWebhookDelivery({
        companyId, event, url: company.webhookUrl, payload: data,
        statusCode: response.status, success: true, error: null, durationMs, attempt,
      });
    } catch (fetchError) {
      const durationMs = Date.now() - startedAt;
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';
      console.error(`Company webhook (${event}) error:`, fetchError);
      await logWebhookDelivery({
        companyId, event, url: company.webhookUrl, payload: data,
        statusCode: null, success: false, error: errorMessage, durationMs, attempt,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error(`Company webhook (${event}) error:`, error);
  }
}
