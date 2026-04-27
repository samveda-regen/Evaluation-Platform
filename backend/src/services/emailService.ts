const nodemailer = require('nodemailer');
// Invitation email delivery via SMTP.

interface InvitationEmailPayload {
  to: string;
  candidateName: string;
  testName: string;
  testLink: string;
  customMessage?: string;
}

interface SmtpConfiguration {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
  requireTLS: boolean;
  isZoho: boolean;
  zohoAccountType: ZohoAccountType;
  zohoDataCenter: ZohoDataCenter;
}

type MailProvider = 'auto' | 'smtp' | 'sendgrid';
type ZohoAccountType = 'personal' | 'organization';
type ZohoDataCenter = 'us' | 'eu' | 'in' | 'au' | 'cn';
interface SendGridConfiguration {
  apiKey: string;
  fromAddress: string;
  apiUrl: string;
  timeoutMs: number;
}

let cachedTransporter: { key: string; transporter: any } | null = null;

function parseMailProvider(value: string | undefined): MailProvider {
  const normalized = (value || 'smtp').trim().toLowerCase();
  if (normalized === 'smtp' || normalized === 'sendgrid' || normalized === 'auto') {
    return normalized;
  }

  console.warn(`Invalid MAIL_PROVIDER "${value}". Falling back to "auto".`);
  return 'auto';
}

function resolveProviderForAuto(): Exclude<MailProvider, 'auto'> {
  const hasSendGridApiKey = Boolean(process.env.SENDGRID_API_KEY?.trim());
  if (hasSendGridApiKey) {
    return 'sendgrid';
  }

  return 'smtp';
}

function getMailProvider(): MailProvider {
  return parseMailProvider(process.env.MAIL_PROVIDER);
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseZohoAccountType(value: string | undefined): ZohoAccountType {
  const normalized = (value || 'organization').trim().toLowerCase();
  return normalized === 'personal' ? 'personal' : 'organization';
}

function parseZohoDataCenter(value: string | undefined): ZohoDataCenter {
  const normalized = (value || 'us').trim().toLowerCase();
  if (normalized === 'eu' || normalized === 'in' || normalized === 'au' || normalized === 'cn') {
    return normalized;
  }
  return 'us';
}

function inferZohoDataCenterFromHost(host: string): ZohoDataCenter {
  if (host.endsWith('.zoho.eu')) return 'eu';
  if (host.endsWith('.zoho.in')) return 'in';
  if (host.endsWith('.zoho.com.au')) return 'au';
  if (host.endsWith('.zoho.com.cn')) return 'cn';
  return 'us';
}

function getZohoHostCandidates(accountType: ZohoAccountType, dc: ZohoDataCenter): string[] {
  const prefix = accountType === 'personal' ? 'smtp' : 'smtppro';
  const suffixMap: Record<ZohoDataCenter, string> = {
    us: 'zoho.com',
    eu: 'zoho.eu',
    in: 'zoho.in',
    au: 'zoho.com.au',
    cn: 'zoho.com.cn'
  };

  const primary = `${prefix}.${suffixMap[dc]}`;
  const all = [
    `${prefix}.zoho.com`,
    `${prefix}.zoho.eu`,
    `${prefix}.zoho.in`,
    `${prefix}.zoho.com.au`,
    `${prefix}.zoho.com.cn`
  ];

  return [primary, ...all.filter((host) => host !== primary)];
}

function isZohoConfigured(host: string, provider: string): boolean {
  return provider === 'zoho' || host.includes('zoho.');
}

function getSmtpConfiguration(): SmtpConfiguration {
  const provider = (process.env.SMTP_PROVIDER || '').trim().toLowerCase();
  const smtpHost = process.env.SMTP_HOST?.trim().replace(/\r/g, '');
  const smtpPort = process.env.SMTP_PORT?.trim();
  const smtpUser = process.env.SMTP_USER?.trim().replace(/\r/g, '');
  const smtpPass = process.env.SMTP_PASS?.trim().replace(/\r/g, '');
  const zohoAccountType = parseZohoAccountType(process.env.ZOHO_ACCOUNT_TYPE);
  const envZohoDc = parseZohoDataCenter(process.env.ZOHO_DATA_CENTER);

  const hostFromProvider = provider === 'zoho'
    ? getZohoHostCandidates(zohoAccountType, envZohoDc)[0]
    : '';

  const host = smtpHost || hostFromProvider;
  const zohoConfig = isZohoConfigured(host, provider);
  const zohoDataCenter = zohoConfig
    ? (smtpHost ? inferZohoDataCenterFromHost(smtpHost) : envZohoDc)
    : envZohoDc;

  const port = Number(smtpPort || (zohoConfig ? '465' : '587'));
  const user = smtpUser || '';
  const pass = smtpPass || '';
  const secureOverride = parseBoolean(process.env.SMTP_SECURE);
  const secure = typeof secureOverride === 'boolean' ? secureOverride : port === 465;
  const requireTlsOverride = parseBoolean(process.env.SMTP_REQUIRE_TLS);
  const requireTLS = typeof requireTlsOverride === 'boolean'
    ? requireTlsOverride
    : (zohoConfig ? !secure : false);

  if (!host || !user || !pass || Number.isNaN(port)) {
    throw new Error(
      'SMTP is not configured. Please set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS.'
    );
  }

  return {
    host,
    port,
    user,
    pass,
    secure,
    requireTLS,
    isZoho: zohoConfig,
    zohoAccountType,
    zohoDataCenter
  };
}

function getTransporter(config: SmtpConfiguration): any {
  const cacheKey = [
    config.host,
    config.port,
    config.user,
    config.secure,
    config.requireTLS
  ].join('|');

  if (cachedTransporter?.key === cacheKey) {
    return cachedTransporter.transporter;
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTLS,
    auth: {
      user: config.user,
      pass: config.pass
    },
    ...(config.isZoho ? { tls: { minVersion: 'TLSv1.2' } } : {})
  });

  void transporter
    .verify()
    .then(() => {
      console.log(`SMTP server is ready (${config.host}:${config.port})`);
    })
    .catch((error: unknown) => {
      console.error(`SMTP verification failed (${config.host}:${config.port}):`, error);
    });

  cachedTransporter = { key: cacheKey, transporter };
  return transporter;
}

function getFromAddressForSmtp(): string {
  return (process.env.SMTP_FROM?.trim().replace(/\r/g, ''))
    || (process.env.EMAIL_FROM?.trim().replace(/\r/g, ''))
    || (process.env.SMTP_USER?.trim().replace(/\r/g, ''))
    || '';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

function getSendGridConfiguration(): SendGridConfiguration {
  const apiKey = process.env.SENDGRID_API_KEY?.trim().replace(/\r/g, '') || '';
  const fromAddress = (process.env.SENDGRID_FROM?.trim().replace(/\r/g, ''))
    || (process.env.EMAIL_FROM?.trim().replace(/\r/g, ''))
    || '';
  const apiUrl = process.env.SENDGRID_API_URL?.trim().replace(/\r/g, '')
    || 'https://api.sendgrid.com/v3/mail/send';
  const timeoutMs = parsePositiveInt(process.env.SENDGRID_TIMEOUT_MS, 12000);

  if (!apiKey) {
    throw new Error('SendGrid is not configured. Please set SENDGRID_API_KEY.');
  }
  if (!fromAddress) {
    throw new Error('SendGrid "from" address is not configured. Please set SENDGRID_FROM or EMAIL_FROM.');
  }

  return {
    apiKey,
    fromAddress,
    apiUrl,
    timeoutMs
  };
}

function extractEmailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] || value).trim().toLowerCase();
}

function buildInvitationBody(payload: InvitationEmailPayload): string {
  const lines = [
    `Hi ${payload.candidateName},`,
    '',
    'Thank you for your interest in the AI Developer role at ReGen.',
    '',
    'As discussed, you are invited to take the Online MCQ + Coding Assessment as the next step in our selection process.',
    '',
    'Your exam window will be from 12:00 PM to 4:00 PM. After this time, the portal will automatically close, so please ensure you complete your assessment within the given duration.',
    '',
    'Please use the below link to access the exam portal:',
    payload.testLink,
    '',
    'EXAM INSTRUCTIONS:',
    '1. Ensure you have a stable internet connection before starting the test.',
    '2. Use a laptop/desktop for a better experience (avoid mobile devices).',
    '3. Do not refresh or close the browser during the test.',
    '4. Make sure you complete all questions within the given duration.',
    '5. Avoid switching tabs or opening other applications during the assessment.',
    '6. Any form of malpractice may lead to disqualification.',
    '',
    'Further updates regarding the next steps will be shared with candidates who successfully clear this round.',
    '',
    'If you face any issues accessing the portal, feel free to reply to this email.'
  ];

  if (payload.customMessage?.trim()) {
    lines.push('', payload.customMessage.trim());
  }

  lines.push(
    '',
    'Wishing you all the best!',
    '',
    'Best Regards,',
    'Kiran Penubakala',
    'kiran@regenconsult.au',
    '7658920525'
  );
  return lines.join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildInvitationHtml(payload: InvitationEmailPayload): string {
  const candidateName = escapeHtml(payload.candidateName);
  const testLink = escapeHtml(payload.testLink);
  const customMessage = payload.customMessage?.trim();

  const customMessageBlock = customMessage
    ? `<p>${escapeHtml(customMessage).replace(/\n/g, '<br />')}</p>`
    : '';

  return [
    `<p>Hi ${candidateName},</p>`,
    '<p>Thank you for your interest in the AI Developer role at ReGen.</p>',
    '<p>As discussed, you are invited to take the Online MCQ + Coding Assessment as the next step in our selection process.</p>',
    '<p>Your exam window will be from 1:00 PM to 5:00 PM. After this time, the portal will automatically close, so please ensure you complete your assessment within the given duration.</p>',
    '<p>Please use the below link to access the exam portal:</p>',
    `<p><a href="${testLink}" target="_blank" rel="noopener noreferrer">${testLink}</a></p>`,
    '<p><strong>Exam Instructions:</strong></p>',
    '<ul>',
    '<li>Ensure you have a stable internet connection before starting the test.</li>',
    '<li>Use a laptop/desktop for a better experience (avoid mobile devices).</li>',
    '<li>Do not refresh or close the browser during the test.</li>',
    '<li>Make sure you complete all questions within the given duration.</li>',
    '<li>Avoid switching tabs or opening other applications during the assessment.</li>',
    '<li>Any form of malpractice may lead to disqualification.</li>',
    '</ul>',
    '<p>Further updates regarding the next steps will be shared with candidates who successfully clear this round.</p>',
    '<p>If you face any issues accessing the portal, feel free to reply to this email.</p>',
    customMessageBlock,
    '<p>Wishing you all the best!</p>',
    '<p>Best Regards,<br />Kiran Penubakala<br />kiran@regenconsult.au<br />7658920525</p>'
  ]
    .filter(Boolean)
    .join('\n');
}

function isRetryableZohoError(error: unknown): boolean {
  const err = error as { code?: string; responseCode?: number };
  return err.code === 'EAUTH'
    || err.responseCode === 535
    || err.code === 'ECONNECTION'
    || err.code === 'ETIMEDOUT'
    || err.code === 'ESOCKET'
    || err.code === 'EDNS';
}

async function sendInvitationEmailViaSmtp(payload: InvitationEmailPayload): Promise<void> {
  const baseConfig = getSmtpConfiguration();
  const fromAddress = getFromAddressForSmtp();

  if (!fromAddress) {
    throw new Error('Email "from" address is not configured. Please set SMTP_FROM, EMAIL_FROM, or SMTP_USER.');
  }

  if (baseConfig.isZoho) {
    const fromEmail = extractEmailAddress(fromAddress);
    const userEmail = baseConfig.user.trim().toLowerCase();
    if (fromEmail && userEmail && fromEmail !== userEmail) {
      console.warn('Zoho SMTP warning: SMTP_FROM does not match SMTP_USER. Ensure it is a valid alias for this mailbox.');
    }
  }

  const hostsToTry = baseConfig.isZoho
    ? [
      baseConfig.host,
      ...getZohoHostCandidates(baseConfig.zohoAccountType, baseConfig.zohoDataCenter)
        .filter((host) => host !== baseConfig.host)
    ]
    : [baseConfig.host];

  const attemptedHosts: string[] = [];
  let lastError: unknown = null;

  for (let index = 0; index < hostsToTry.length; index += 1) {
    const candidateHost = hostsToTry[index];
    const candidateConfig: SmtpConfiguration = {
      ...baseConfig,
      host: candidateHost
    };

    const transporter = getTransporter(candidateConfig);
    attemptedHosts.push(candidateHost);

    try {
      const info = await transporter.sendMail({
        from: fromAddress,
        to: payload.to,
        subject: 'AI Developer Assessment – ReGen',
        text: buildInvitationBody(payload),
        html: buildInvitationHtml(payload)
      });

      console.log('Email sent via SMTP:', info.messageId);
      console.log('Accepted:', info.accepted);
      console.log('Rejected:', info.rejected);
      console.log('Response:', info.response);
      return;
    } catch (error) {
      lastError = error;
      const hasMoreHosts = index < hostsToTry.length - 1;

      if (baseConfig.isZoho && isRetryableZohoError(error) && hasMoreHosts) {
        console.warn(`Zoho SMTP attempt failed on ${candidateHost}. Trying fallback host...`);
        continue;
      }

      break;
    }
  }

  if (baseConfig.isZoho) {
    const err = lastError as { code?: string; responseCode?: number } | null;

    if (err?.code === 'EAUTH' || err?.responseCode === 535) {
      throw new Error(
        `Zoho SMTP authentication failed. Tried hosts: ${attemptedHosts.join(', ')}. Use the full Zoho mailbox in SMTP_USER, an app-specific password in SMTP_PASS (required with 2FA), and ensure SMTP_FROM matches the same account or an allowed alias.`
      );
    }

    if (err?.code === 'ECONNECTION' || err?.code === 'ETIMEDOUT' || err?.code === 'ESOCKET' || err?.code === 'EDNS') {
      throw new Error(
        `Zoho SMTP connection failed (initial ${baseConfig.host}:${baseConfig.port}, secure=${baseConfig.secure}, requireTLS=${baseConfig.requireTLS}). Tried hosts: ${attemptedHosts.join(', ')}. Check firewall/port access and set ZOHO_DATA_CENTER correctly (us/eu/in/au/cn).`
      );
    }
  }

  throw lastError;
}

async function readSendGridError(response: Response): Promise<string> {
  const raw = await response.text();
  if (!raw) {
    return `HTTP ${response.status}`;
  }

  try {
    const parsed = JSON.parse(raw) as { errors?: Array<{ message?: string }> };
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      const messages = parsed.errors
        .map((item) => (item?.message || '').trim())
        .filter(Boolean);
      if (messages.length > 0) {
        return messages.join('; ');
      }
    }
  } catch {
    // ignore JSON parse errors and return raw text below
  }

  return raw.slice(0, 600);
}

async function sendInvitationEmailViaSendGrid(payload: InvitationEmailPayload): Promise<void> {
  const config = getSendGridConfiguration();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: payload.to }]
        }
      ],
      from: { email: config.fromAddress },
      subject: 'AI Developer Assessment – ReGen',
      content: [
        { type: 'text/plain', value: buildInvitationBody(payload) },
        { type: 'text/html', value: buildInvitationHtml(payload) }
      ]
    }),
    signal: AbortSignal.timeout(config.timeoutMs)
  });

  if (response.status !== 202) {
    const errorMessage = await readSendGridError(response);
    throw new Error(`SendGrid send failed (${response.status}): ${errorMessage}`);
  }
}

export async function sendInvitationEmail(payload: InvitationEmailPayload): Promise<void> {
  const provider = getMailProvider();
  const resolvedProvider = provider === 'auto' ? resolveProviderForAuto() : provider;

  try {
    if (provider === 'auto') {
      console.warn(`MAIL_PROVIDER=auto resolved to ${resolvedProvider}.`);
    }

    if (resolvedProvider === 'sendgrid') {
      await sendInvitationEmailViaSendGrid(payload);
      return;
    }

    await sendInvitationEmailViaSmtp(payload);
  } catch (error) {
    console.error('Failed to send invitation email:', {
      provider: resolvedProvider,
      error
    });
    throw error;
  }
}
