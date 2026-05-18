type CandidateScoreWebhookPayload = {
  name: string;
  emailid: string;
  score: number;
  testid: string;
  status: string;
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
