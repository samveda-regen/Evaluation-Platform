const nodemailer = require('nodemailer');
// Invitation email delivery via SMTP.

interface InvitationEmailPayload {
  to: string;
  candidateName: string;
  testName: string;
  testCode?: string;
  testLink: string;
  customMessage?: string;
  subjectTemplate?: string;
  bodyTemplate?: string;
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

type MailProvider = 'auto' | 'smtp';
type ZohoAccountType = 'personal' | 'organization';
type ZohoDataCenter = 'us' | 'eu' | 'in' | 'au' | 'cn';

const DEFAULT_INVITATION_SUBJECT = 'You are invited to take {{testName}}';
const DEFAULT_INVITATION_BODY = [
  'Hi {{candidateName}},',
  '',
  'You have been invited to take the test "{{testName}}".',
  'Click the link below to start:',
  '{{testLink}}',
  '',
  '{{customMessage}}',
  '',
  'Good luck!'
].join('\n');

let cachedTransporter: { key: string; transporter: any } | null = null;

function parseMailProvider(value: string | undefined): MailProvider {
  const normalized = (value || 'smtp').trim().toLowerCase();
  if (normalized === 'smtp' || normalized === 'auto') {
    return normalized;
  }

  console.warn(`Invalid MAIL_PROVIDER "${value}". Falling back to "smtp".`);
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

function extractEmailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] || value).trim().toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TEMPLATE_VARIABLE_REGEX = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;

function renderTemplate(template: string, data: Record<string, string>): string {
  return template.replace(TEMPLATE_VARIABLE_REGEX, (_, key: string) => data[key] ?? '');
}

function normalizeTemplateText(value: string): string {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeSubject(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function ensureCustomMessage(template: string, customMessage: string): string {
  if (!customMessage) {
    return template;
  }

  if (/{{\s*customMessage\s*}}/i.test(template)) {
    return template;
  }

  return `${template.trim()}\n\n{{customMessage}}`;
}

function renderTextAsHtml(text: string): string {
  if (!text) {
    return '';
  }

  const escaped = escapeHtml(text);
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  return linked
    .split(/\n{2,}/g)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br />')}</p>`)
    .join('\n');
}

function buildInvitationContent(payload: InvitationEmailPayload): { subject: string; text: string; html: string } {
  const customMessage = payload.customMessage?.trim() || '';
  const data: Record<string, string> = {
    candidateName: payload.candidateName,
    testName: payload.testName,
    testCode: payload.testCode || '',
    testLink: payload.testLink,
    customMessage
  };

  const rawSubjectTemplate = payload.subjectTemplate?.trim() || DEFAULT_INVITATION_SUBJECT;
  const rawBodyTemplate = payload.bodyTemplate?.trim() || DEFAULT_INVITATION_BODY;
  const bodyTemplate = ensureCustomMessage(rawBodyTemplate, customMessage);

  const subject = normalizeSubject(renderTemplate(rawSubjectTemplate, data))
    || normalizeSubject(renderTemplate(DEFAULT_INVITATION_SUBJECT, data));
  const text = normalizeTemplateText(renderTemplate(bodyTemplate, data))
    || normalizeTemplateText(renderTemplate(DEFAULT_INVITATION_BODY, data));
  const html = renderTextAsHtml(text);

  return { subject, text, html };
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
      const content = buildInvitationContent(payload);
      const info = await transporter.sendMail({
        from: fromAddress,
        to: payload.to,
        subject: content.subject,
        text: content.text,
        html: content.html
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

export async function sendInvitationEmail(payload: InvitationEmailPayload): Promise<void> {
  const provider = getMailProvider();

  try {
    if (provider === 'auto') {
      console.warn('MAIL_PROVIDER=auto resolved to SMTP. Configure SMTP_* environment variables.');
    }
    await sendInvitationEmailViaSmtp(payload);
  } catch (error) {
    console.error('Failed to send invitation email:', {
      provider: 'smtp',
      error
    });
    throw error;
  }
}
