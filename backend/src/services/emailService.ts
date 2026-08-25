const nodemailer = require('nodemailer');
// Invitation email delivery via SMTP.

// ── Default email templates ──────────────────────────────────────────────────
export const DEFAULT_INVITE_SUBJECT = "You're invited to take a test on {{test_name}}";
export const DEFAULT_INVITE_BODY = `Hello {{candidate_name}},

You have been invited to take the test: {{test_name}}.

Exam date: {{exam_start}} to {{exam_end}}
Duration: Approximately {{estimated_time}}
Access code: {{access_code}}

Important: This assessment must be completed using Safe Exam Browser (SEB). Please install SEB before starting the assessment.

After installing SEB, return to this email and click Continue to Assessment.

If you have any questions, feel free to reach out to us.

Best regards,
{{company_name}} Team`;

export const DEFAULT_REMINDER_SUBJECT = "Reminder: {{test_name}} closes soon";
export const DEFAULT_REMINDER_BODY = `Hello {{candidate_name}},

This is a reminder that you haven't started your test yet: {{test_name}}.

Exam date: {{exam_start}} to {{exam_end}}

Duration: Approximately {{estimated_time}}

Access code: {{access_code}}

Important: This assessment must be completed using Safe Exam Browser (SEB). Please install SEB before starting the assessment.

If you have already installed SEB, return to this email and click Continue to Assessment.

Please make sure to complete the assessment before the access window closes on {{closes_at}}.

If you have any questions, feel free to reach out to us.

Best regards,

{{company_name}} Team`;
export const DEFAULT_CONFIRM_SUBJECT = "Thanks for completing {{test_name}}";
export const DEFAULT_CONFIRM_BODY = `Hello {{candidate_name}},

Thank you for completing the test: {{test_name}}.
We appreciate the time and effort you put into the assessment.
Our team will review your results and get back to you soon.

Best regards,
{{company_name}} Team`;

export const DEFAULT_NORMAL_BROWSER_INVITE_SUBJECT = "You're invited to take an online assessment: {{test_name}}";
export const DEFAULT_NORMAL_BROWSER_INVITE_BODY = `Hello {{candidate_name}},

You have been invited to take the assessment: {{test_name}}.

Exam date: {{exam_start}} to {{exam_end}}
Duration: Approximately {{estimated_time}}
Access code: {{access_code}}

You can complete this assessment in a supported web browser. No Safe Exam Browser installation is required.

Open the assessment: {{test_link}}

If you have any questions, feel free to reach out to us.

Best regards,
{{company_name}} Team`;

export const DEFAULT_NORMAL_BROWSER_REMINDER_SUBJECT = "Reminder: {{test_name}} closes soon";
export const DEFAULT_NORMAL_BROWSER_REMINDER_BODY = `Hello {{candidate_name}},

This is a reminder that you haven't started your assessment yet: {{test_name}}.

Duration: Approximately {{estimated_time}}
Access code: {{access_code}}

Open the assessment in your web browser: {{test_link}}

Please complete it before the access window closes on {{closes_at}}.

Best regards,
{{company_name}} Team`;

export const DEFAULT_NORMAL_BROWSER_CONFIRM_SUBJECT = "Thanks for completing {{test_name}}";
export const DEFAULT_NORMAL_BROWSER_CONFIRM_BODY = `Hello {{candidate_name}},

Thank you for completing the assessment: {{test_name}}.
We appreciate the time and effort you put into it.
Our team will review your results and get back to you soon.

Best regards,
{{company_name}} Team`;

// ── Placeholder substitution ─────────────────────────────────────────────────
interface TemplateVars {
  candidate_name: string;
  test_name: string;
  company_name: string;
  estimated_time: string;
  test_link: string;
  access_code: string;
  exam_start: string;
  exam_end: string;
  closes_at: string;
}

function applyTemplate(template: string, vars: TemplateVars): string {
  return template
    .replace(/\{\{candidate_name\}\}/g, vars.candidate_name)
    .replace(/\{\{test_name\}\}/g,      vars.test_name)
    .replace(/\{\{company_name\}\}/g,   vars.company_name)
    .replace(/\{\{estimated_time\}\}/g, vars.estimated_time)
    .replace(/\{\{test_link\}\}/g,      vars.test_link)
    .replace(/\{\{access_code\}\}/g,    vars.access_code)
    .replace(/\{\{exam_start\}\}/g,     vars.exam_start)
    .replace(/\{\{exam_end\}\}/g,       vars.exam_end)
    .replace(/\{\{closes_at\}\}/g,      vars.closes_at);
}

// Derives the sebs:// launch link for a candidate's test link. testLink is
// always `${origin}/test/login?token=...` (see buildInviteLink in
// invitationService.ts), so the token is pulled straight out of it rather
// than threading it through the email payload separately.
function deriveSebLaunchLink(testLink: string): string | null {
  try {
    const parsed = new URL(testLink);
    const token = parsed.searchParams.get('token');
    if (!token) return null;

    const scheme = parsed.protocol === 'https:' ? 'sebs:' : 'seb:';
    return `${scheme}//${parsed.host}/api/invitations/${encodeURIComponent(token)}/seb-config`;
  } catch {
    return null;
  }
}
function renderEmailBodyWithSebButtons(
  text: string,
  testLink: string
): string {
  const installToken = '__SEB_INSTALL_BUTTON_TOKEN__';
  const continueToken = '__SEB_CONTINUE_BUTTON_TOKEN__';

  const installButtonExists = text.includes('{{seb_install_button}}');
  const continueButtonExists = text.includes('{{seb_continue_button}}');

  let workingText = text
    .replace(/\{\{seb_install_button\}\}/g, installToken)
    .replace(/\{\{seb_continue_button\}\}/g, continueToken);

  // Backward compatibility:
  // Existing templates may not contain the new tokens.
  // Keep both buttons working by appending them only when neither
  // token has been explicitly positioned in the template.
  if (!installButtonExists && !continueButtonExists) {
    workingText += '\n\n' + installToken + '\n\n' + continueToken;
  } else if (!installButtonExists) {
    workingText += '\n\n' + installToken;
  } else if (!continueButtonExists) {
    workingText += '\n\n' + continueToken;
  }

  let html = textToHtml(workingText);

  html = html.replace(
    new RegExp(installToken, 'g'),
    buildSebInstallButtonHtml(testLink)
  );

  html = html.replace(
    new RegExp(continueToken, 'g'),
    buildSebContinueButtonHtml(testLink)
  );

  return html;
}

// Gmail and most webmail clients strip non-standard URI schemes (sebs://,
// seb://) from email HTML as an anti-abuse measure, silently killing a raw
// protocol href. So the email button instead links to the normal https://
// login page with a `seb=1` flag; CandidateLogin.tsx sees that flag and
// triggers the sebs:// handoff itself once it's running in a real browser,
// where custom protocol links work fine.
function buildSebLandingLink(testLink: string): string {
  try {
    const parsed = new URL(testLink);
    const token = parsed.searchParams.get('token');

    if (!token) return testLink;

    return `${parsed.origin}/test/seb-launch?token=${encodeURIComponent(token)}`;
  } catch {
    return testLink;
  }
}

function buildSebInstallButtonHtml(testLink: string): string {
  const installLink = 'https://safeexambrowser.org/download_en.html';

  return `
    <div style="margin:14px 0">
      <a
        href="${installLink}"
        target="_blank"
        rel="noopener noreferrer"
        style="
          display:inline-block;
          background:#ffffff;
          color:#111827;
          padding:11px 20px;
          border:1px solid #D1D5DB;
          border-radius:8px;
          text-decoration:none;
          font-weight:600;
        "
      >
        Install Safe Exam Browser
      </a>
    </div>
  `;
}
function buildSebContinueButtonHtml(testLink: string): string {
  const launchLink = buildSebLandingLink(testLink);

  return `
    <div style="margin:14px 0">
      <a
        href="${escapeHtml(launchLink)}"
        style="
          display:inline-block;
          background:#111827;
          color:#ffffff;
          padding:12px 24px;
          border-radius:8px;
          text-decoration:none;
          font-weight:600;
        "
      >
        Continue to Assessment
      </a>
    </div>
  `;
}

function textToHtml(text: string): string {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .map(paragraph => {
      const linked = paragraph
        .replace(/\n/g, '<br />')
        .replace(
          /https?:\/\/[^\s<>"&]+/g,
          url =>
            `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
        );

      return `<p style="margin:0 0 12px;line-height:1.5">${linked}</p>`;
    })
    .join('');
}

// ── Payload ───────────────────────────────────────────────────────────────────
interface InvitationEmailPayload {
  to: string;
  candidateName: string;
  testName: string;
  testLink: string;
  accessCode: string;
  companyName?: string;
  estimatedTime?: string;
  examStart?: string;
  examEnd?: string;
  // custom templates (if set on the test)
  inviteEmailSubject?: string | null;
  inviteEmailBody?: string | null;
  assessmentMode?: 'SEB' | 'NORMAL_BROWSER';
}

interface ReminderEmailPayload {
  to: string;
  candidateName: string;
  testName: string;
  testLink: string;
  accessCode: string;
  closesAt: string;
  companyName?: string;
  estimatedTime?: string;
  // custom templates (if set on the test)
  reminderEmailSubject?: string | null;
  reminderEmailBody?: string | null;
  assessmentMode?: 'SEB' | 'NORMAL_BROWSER';
}

interface ConfirmationEmailPayload {
  to: string;
  candidateName: string;
  testName: string;
  companyName?: string;
  // custom templates (if set on the test)
  confirmEmailSubject?: string | null;
  confirmEmailBody?: string | null;
  assessmentMode?: 'SEB' | 'NORMAL_BROWSER';
}

interface ResultEmailPayload {
  to: string;
  candidateName: string;
  testName: string;
  companyName?: string;
  score: number;
  totalMarks: number;
  passed: boolean | null;
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

type MailProvider = 'auto' | 'smtp' | 'sendgrid' | 'resend';
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
  if (normalized === 'smtp' || normalized === 'sendgrid' || normalized === 'resend' || normalized === 'auto') {
    return normalized as MailProvider;
  }

  console.warn(`Invalid MAIL_PROVIDER "${value}". Falling back to "auto".`);
  return 'auto';
}

function resolveProviderForAuto(): Exclude<MailProvider, 'auto'> {
  if (process.env.RESEND_API_KEY?.trim()) return 'resend';
  if (process.env.SENDGRID_API_KEY?.trim()) return 'sendgrid';
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Build invite email from template ─────────────────────────────────────────
function appendSebPlainTextLine(text: string, testLink: string): string {
 return text;
}

function renderInviteBody(payload: InvitationEmailPayload): string {
  const templateBody = payload.inviteEmailBody || (payload.assessmentMode === 'NORMAL_BROWSER'
    ? DEFAULT_NORMAL_BROWSER_INVITE_BODY
    : DEFAULT_INVITE_BODY);
  return applyTemplate(templateBody, {
    candidate_name: payload.candidateName,
    test_name:      payload.testName,
    company_name:   payload.companyName || 'Our Team',
    estimated_time: payload.estimatedTime || 'some time',
    test_link:      payload.testLink,
    access_code:    payload.accessCode,
    exam_start:     payload.examStart || 'To be announced',
    exam_end:       payload.examEnd || 'To be announced',
    closes_at:      '',
  });
}

function buildInviteText(payload: InvitationEmailPayload): string {
  return appendSebPlainTextLine(renderInviteBody(payload), payload.testLink);
}

function buildInviteSubject(payload: InvitationEmailPayload): string {
  const templateSubject = payload.inviteEmailSubject || (payload.assessmentMode === 'NORMAL_BROWSER'
    ? DEFAULT_NORMAL_BROWSER_INVITE_SUBJECT
    : DEFAULT_INVITE_SUBJECT);
  return applyTemplate(templateSubject, {
    candidate_name: payload.candidateName,
    test_name:      payload.testName,
    company_name:   payload.companyName || 'Our Team',
    estimated_time: payload.estimatedTime || 'some time',
    test_link:      payload.testLink,
    access_code:    payload.accessCode,
    exam_start:     payload.examStart || 'To be announced',
    exam_end:       payload.examEnd || 'To be announced',
    closes_at:      '',
  });
}

function buildInviteHtml(payload: InvitationEmailPayload): string {
  const text = renderInviteBody(payload);

  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#374151;max-width:600px">
${payload.assessmentMode === 'NORMAL_BROWSER' ? textToHtml(text) : renderEmailBodyWithSebButtons(text, payload.testLink)}
</div>`;
}

// ── Build reminder email from template ────────────────────────────────────────
function renderReminderBody(payload: ReminderEmailPayload): string {
  const templateBody = payload.reminderEmailBody || (payload.assessmentMode === 'NORMAL_BROWSER'
    ? DEFAULT_NORMAL_BROWSER_REMINDER_BODY
    : DEFAULT_REMINDER_BODY);
  return applyTemplate(templateBody, {
    candidate_name: payload.candidateName,
    test_name:      payload.testName,
    company_name:   payload.companyName || 'Our Team',
    estimated_time: payload.estimatedTime || 'some time',
    test_link:      payload.testLink,
    access_code:    payload.accessCode,
    exam_start:     '',
    exam_end:       '',
    closes_at:      payload.closesAt,
  });
}

function buildReminderText(payload: ReminderEmailPayload): string {
  return appendSebPlainTextLine(renderReminderBody(payload), payload.testLink);
}

function buildReminderSubject(payload: ReminderEmailPayload): string {
  const templateSubject = payload.reminderEmailSubject || (payload.assessmentMode === 'NORMAL_BROWSER'
    ? DEFAULT_NORMAL_BROWSER_REMINDER_SUBJECT
    : DEFAULT_REMINDER_SUBJECT);
  return applyTemplate(templateSubject, {
    candidate_name: payload.candidateName,
    test_name:      payload.testName,
    company_name:   payload.companyName || 'Our Team',
    estimated_time: payload.estimatedTime || 'some time',
    test_link:      payload.testLink,
    access_code:    payload.accessCode,
    exam_start:     '',
    exam_end:       '',
    closes_at:      payload.closesAt,
  });
}

function buildReminderHtml(payload: ReminderEmailPayload): string {
  const text = renderReminderBody(payload);

  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#374151;max-width:600px">
${payload.assessmentMode === 'NORMAL_BROWSER' ? textToHtml(text) : renderEmailBodyWithSebButtons(text, payload.testLink)}
</div>`;
}

// ── Build confirmation email from template ────────────────────────────────────
function buildConfirmText(payload: ConfirmationEmailPayload): string {
  const templateBody = payload.confirmEmailBody || (payload.assessmentMode === 'NORMAL_BROWSER'
    ? DEFAULT_NORMAL_BROWSER_CONFIRM_BODY
    : DEFAULT_CONFIRM_BODY);
  return applyTemplate(templateBody, {
    candidate_name: payload.candidateName,
    test_name:      payload.testName,
    company_name:   payload.companyName || 'Our Team',
    estimated_time: '',
    test_link:      '',
    access_code:    '',
    exam_start:     '',
    exam_end:       '',
    closes_at:      '',
  });
}

function buildConfirmSubject(payload: ConfirmationEmailPayload): string {
  const templateSubject = payload.confirmEmailSubject || (payload.assessmentMode === 'NORMAL_BROWSER'
    ? DEFAULT_NORMAL_BROWSER_CONFIRM_SUBJECT
    : DEFAULT_CONFIRM_SUBJECT);
  return applyTemplate(templateSubject, {
    candidate_name: payload.candidateName,
    test_name:      payload.testName,
    company_name:   payload.companyName || 'Our Team',
    estimated_time: '',
    test_link:      '',
    access_code:    '',
    exam_start:     '',
    exam_end:       '',
    closes_at:      '',
  });
}

function buildConfirmHtml(payload: ConfirmationEmailPayload): string {
  const text = buildConfirmText(payload);
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#374151;max-width:600px">
${textToHtml(text)}
</div>`;
}

// ── Build result email ────────────────────────────────────────────────────────
function resultOutcomeLine(payload: ResultEmailPayload): string {
  if (payload.passed === null) return '';
  return payload.passed
    ? 'Congratulations, you have passed this assessment!'
    : 'Unfortunately, you did not meet the passing score for this assessment.';
}

function buildResultText(payload: ResultEmailPayload): string {
  const companyName = payload.companyName || 'Our Team';
  const outcomeLine = resultOutcomeLine(payload);
  return `Hello ${payload.candidateName},

Your results for "${payload.testName}" are ready.

Score: ${payload.score} / ${payload.totalMarks}
${outcomeLine ? `${outcomeLine}\n` : ''}
Best regards,
${companyName} Team`;
}

function buildResultSubject(payload: ResultEmailPayload): string {
  return `Your results for ${payload.testName}`;
}

function buildResultHtml(payload: ResultEmailPayload): string {
  const text = buildResultText(payload);
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#374151;max-width:600px">
${textToHtml(text)}
</div>`;
}

// ── SMTP sending ──────────────────────────────────────────────────────────────
function isRetryableZohoError(error: unknown): boolean {
  const err = error as { code?: string; responseCode?: number };
  return err.code === 'EAUTH'
    || err.responseCode === 535
    || err.code === 'ECONNECTION'
    || err.code === 'ETIMEDOUT'
    || err.code === 'ESOCKET'
    || err.code === 'EDNS';
}

async function sendMailViaSmtp(subject: string, textBody: string, htmlBody: string, to: string): Promise<void> {
  const baseConfig = getSmtpConfiguration();
  const fromAddress = getFromAddressForSmtp();

  if (!fromAddress) {
    throw new Error('Email "from" address is not configured. Please set SMTP_FROM, EMAIL_FROM, or SMTP_USER.');
  }

  if (baseConfig.isZoho) {
    const fromEmail = extractEmailAddress(fromAddress);
    const userEmail = baseConfig.user.trim().toLowerCase();
    if (fromEmail && userEmail && fromEmail !== userEmail) {
      console.warn('Zoho SMTP warning: SMTP_FROM does not match SMTP_USER.');
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
    const candidateConfig: SmtpConfiguration = { ...baseConfig, host: candidateHost };
    const transporter = getTransporter(candidateConfig);
    attemptedHosts.push(candidateHost);

    try {
      const info = await transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        text: textBody,
        html: htmlBody
      });
      console.log('Email sent via SMTP:', info.messageId);
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
      throw new Error(`Zoho SMTP authentication failed. Tried: ${attemptedHosts.join(', ')}.`);
    }
    if (err?.code === 'ECONNECTION' || err?.code === 'ETIMEDOUT' || err?.code === 'ESOCKET' || err?.code === 'EDNS') {
      throw new Error(`Zoho SMTP connection failed. Tried: ${attemptedHosts.join(', ')}.`);
    }
  }

  throw lastError;
}

async function readSendGridError(response: Response): Promise<string> {
  const raw = await response.text();
  if (!raw) return `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(raw) as { errors?: Array<{ message?: string }> };
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      const messages = parsed.errors.map((item) => (item?.message || '').trim()).filter(Boolean);
      if (messages.length > 0) return messages.join('; ');
    }
  } catch { }
  return raw.slice(0, 600);
}

async function sendMailViaSendGrid(subject: string, textBody: string, htmlBody: string, to: string): Promise<void> {
  const config = getSendGridConfiguration();
  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: config.fromAddress },
      subject,
      content: [
        { type: 'text/plain', value: textBody },
        { type: 'text/html',  value: htmlBody }
      ]
    }),
    signal: AbortSignal.timeout(config.timeoutMs)
  });

  if (response.status !== 202) {
    const errorMessage = await readSendGridError(response);
    throw new Error(`SendGrid send failed (${response.status}): ${errorMessage}`);
  }
}

interface ResendConfiguration {
  apiKey: string;
  fromAddress: string;
  timeoutMs: number;
}

function getResendConfiguration(): ResendConfiguration {
  const apiKey = process.env.RESEND_API_KEY?.trim().replace(/\r/g, '') || '';
  const fromAddress = (process.env.RESEND_FROM?.trim().replace(/\r/g, ''))
    || (process.env.EMAIL_FROM?.trim().replace(/\r/g, ''))
    || '';
  const timeoutMs = parsePositiveInt(process.env.RESEND_TIMEOUT_MS, 12000);

  if (!apiKey) {
    throw new Error('Resend is not configured. Please set RESEND_API_KEY.');
  }
  if (!fromAddress) {
    throw new Error('Resend "from" address is not configured. Please set RESEND_FROM or EMAIL_FROM.');
  }

  return { apiKey, fromAddress, timeoutMs };
}

async function sendMailViaResend(subject: string, textBody: string, htmlBody: string, to: string): Promise<void> {
  const config = getResendConfiguration();
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.fromAddress,
      to: [to],
      subject,
      text: textBody,
      html: htmlBody,
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    let detail = raw.slice(0, 600);
    try {
      const parsed = JSON.parse(raw) as { message?: string; name?: string };
      if (parsed.message) detail = parsed.message;
    } catch { }
    throw new Error(`Resend send failed (${response.status}): ${detail}`);
  }

  const data = await response.json() as { id?: string };
  console.log('Email sent via Resend:', data.id);
}

async function sendMail(subject: string, textBody: string, htmlBody: string, to: string): Promise<void> {
  const provider = getMailProvider();
  const resolvedProvider = provider === 'auto' ? resolveProviderForAuto() : provider;
  if (provider === 'auto') console.warn(`MAIL_PROVIDER=auto resolved to ${resolvedProvider}.`);

  if (resolvedProvider === 'resend') {
    await sendMailViaResend(subject, textBody, htmlBody, to);
    return;
  }
  if (resolvedProvider === 'sendgrid') {
    await sendMailViaSendGrid(subject, textBody, htmlBody, to);
    return;
  }
  await sendMailViaSmtp(subject, textBody, htmlBody, to);
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function sendInvitationEmail(payload: InvitationEmailPayload): Promise<void> {
  try {
    await sendMail(
      buildInviteSubject(payload),
      buildInviteText(payload),
      buildInviteHtml(payload),
      payload.to
    );
  } catch (error) {
    console.error('Failed to send invitation email:', { error });
    throw error;
  }
}

export async function sendTestReminderEmail(payload: ReminderEmailPayload): Promise<void> {
  try {
    await sendMail(
      buildReminderSubject(payload),
      buildReminderText(payload),
      buildReminderHtml(payload),
      payload.to
    );
  } catch (error) {
    console.error('Failed to send test reminder email:', { error });
    throw error;
  }
}

interface AdminWelcomeEmailPayload {
  to: string;
  name: string;
  password: string;
  loginUrl: string;
  companyName?: string;
}

export async function sendAdminWelcomeEmail(payload: AdminWelcomeEmailPayload): Promise<void> {
  const subject = `Welcome to TalentstaQ — your account is ready`;
  const textBody = `Hi ${payload.name},

Your TalentstaQ admin account has been created${payload.companyName ? ` for ${payload.companyName}` : ''}.

Login URL: ${payload.loginUrl}
Email: ${payload.to}
Temporary password: ${payload.password}

Please log in and change your password as soon as possible.

Best regards,
TalentstaQ Team`;

  const htmlBody = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#374151;max-width:600px">
<p>Hi ${escapeHtml(payload.name)},</p>
<p>Your TalentstaQ admin account has been created${payload.companyName ? ` for <strong>${escapeHtml(payload.companyName)}</strong>` : ''}.</p>
<table style="border-collapse:collapse;margin:16px 0">
  <tr><td style="padding:6px 12px 6px 0;color:#6B7280">Login URL</td><td style="padding:6px 0"><a href="${payload.loginUrl}">${escapeHtml(payload.loginUrl)}</a></td></tr>
  <tr><td style="padding:6px 12px 6px 0;color:#6B7280">Email</td><td style="padding:6px 0">${escapeHtml(payload.to)}</td></tr>
  <tr><td style="padding:6px 12px 6px 0;color:#6B7280">Temporary password</td><td style="padding:6px 0"><code style="background:#F3F4F6;padding:2px 6px;border-radius:4px">${escapeHtml(payload.password)}</code></td></tr>
</table>
<p>Please log in and change your password as soon as possible.</p>
<p>Best regards,<br/>TalentstaQ Team</p>
</div>`;

  try {
    await sendMailViaResend(subject, textBody, htmlBody, payload.to);
  } catch (error) {
    console.error('Failed to send admin welcome email:', { error });
    throw error;
  }
}

interface AdminPasswordResetEmailPayload {
  to: string;
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export async function sendAdminPasswordResetEmail(payload: AdminPasswordResetEmailPayload): Promise<void> {
  const subject = `Reset your TalentstaQ password`;
  const textBody = `Hi ${payload.name},

We received a request to reset the password for your TalentstaQ admin account (${payload.to}).

Reset your password here:
${payload.resetUrl}

This link expires in ${payload.expiresInMinutes} minutes and can only be used once.

If you didn't request this, you can safely ignore this email — your password won't be changed.

Best regards,
TalentstaQ Team`;

  const htmlBody = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#374151;max-width:600px">
<p>Hi ${escapeHtml(payload.name)},</p>
<p>We received a request to reset the password for your TalentstaQ admin account (${escapeHtml(payload.to)}).</p>
<p style="margin:24px 0">
  <a href="${payload.resetUrl}" style="background:#111827;color:#ffffff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Reset password</a>
</p>
<p style="color:#6B7280;font-size:13px">This link expires in ${payload.expiresInMinutes} minutes and can only be used once.</p>
<p>If you didn't request this, you can safely ignore this email — your password won't be changed.</p>
<p>Best regards,<br/>TalentstaQ Team</p>
</div>`;

  try {
    await sendMailViaResend(subject, textBody, htmlBody, payload.to);
  } catch (error) {
    console.error('Failed to send admin password reset email:', { error });
    throw error;
  }
}

export async function sendConfirmationEmail(payload: ConfirmationEmailPayload): Promise<void> {
  try {
    await sendMail(
      buildConfirmSubject(payload),
      buildConfirmText(payload),
      buildConfirmHtml(payload),
      payload.to
    );
  } catch (error) {
    console.error('Failed to send confirmation email:', { error });
    throw error;
  }
}

export async function sendResultEmail(payload: ResultEmailPayload): Promise<void> {
  try {
    await sendMail(
      buildResultSubject(payload),
      buildResultText(payload),
      buildResultHtml(payload),
      payload.to
    );
  } catch (error) {
    console.error('Failed to send result email:', { error });
    throw error;
  }
}

// Minimal, template-free send used by the superadmin alerting service —
// deliberately plain text/html rather than a branded template, since these
// are internal operational notices, not candidate/admin-facing mail.
export async function sendPlainEmail(payload: { to: string; subject: string; text: string }): Promise<void> {
  const escaped = payload.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  await sendMail(payload.subject, payload.text, `<pre style="font-family:monospace">${escaped}</pre>`, payload.to);
}
