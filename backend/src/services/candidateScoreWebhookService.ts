import { createHmac } from 'crypto';
import prisma from '../utils/db.js';
import { decryptSecret } from '../utils/secretEncryption.js';

type CandidateScoreWebhookPayload = {
  name: string;
  emailid: string;
  score: number;
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

// Per-company push events (invitation.sent, test.started, test.completed) for
// recruiter-platform partners that configured a webhookUrl on their Company row,
// as an alternative to polling GET /integration/tests/:testId/results.
export async function dispatchCompanyWebhookEvent(
  companyId: string | null | undefined,
  event: string,
  data: Record<string, unknown>
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

      if (!response.ok) {
        const responseText = await response.text().catch(() => '');
        console.error(
          `Company webhook (${event}) failed with status ${response.status}: ${responseText || response.statusText}`
        );
        return;
      }

      console.info(`Company webhook (${event}) sent for company ${companyId}`);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error(`Company webhook (${event}) error:`, error);
  }
}
