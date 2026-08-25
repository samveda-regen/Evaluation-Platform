import { randomBytes, randomInt } from 'crypto';
import { Readable } from 'stream';
import type { Express } from 'express';
import ExcelJS from 'exceljs';

import prisma from '../utils/db.js';
import { sanitizeInput } from '../utils/sanitize.js';
import { sendInvitationEmail } from './emailService.js';
const csvParser = require('csv-parser');

const EMAIL_BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1000;
const EMAIL_SEND_MAX_ATTEMPTS = 3;
const EMAIL_SEND_RETRY_DELAY_MS = 1500;
const CANDIDATE_LOGIN_PATH = '/test/login';
const CANDIDATE_SEB_QUIT_PATH = '/test/quit-seb';

function activeInvitationTemplate(test: any): {
  assessmentMode: 'SEB' | 'NORMAL_BROWSER';
  subject?: string;
  body?: string;
} {
  const assessmentMode = test.assessmentMode === 'NORMAL_BROWSER' ? 'NORMAL_BROWSER' : 'SEB';
  return {
    assessmentMode,
    subject: assessmentMode === 'NORMAL_BROWSER'
      ? test.normalBrowserInviteEmailSubject ?? undefined
      : test.inviteEmailSubject ?? undefined,
    body: assessmentMode === 'NORMAL_BROWSER'
      ? test.normalBrowserInviteEmailBody ?? undefined
      : test.inviteEmailBody ?? undefined,
  };
}

export function formatExamDate(startTime: Date | null | undefined): string | undefined {
  if (!startTime) return undefined;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(startTime);
}

// Excludes visually-confusing characters (I, O) so codes are easy to read/type by hand.
const ACCESS_CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ACCESS_CODE_DIGITS = '0123456789';

function generateAccessCode(): string {
  let letters = '';
  for (let i = 0; i < 4; i++) letters += ACCESS_CODE_LETTERS[randomInt(ACCESS_CODE_LETTERS.length)];
  let digits = '';
  for (let i = 0; i < 4; i++) digits += ACCESS_CODE_DIGITS[randomInt(ACCESS_CODE_DIGITS.length)];
  return `${letters}-${digits}`;
}

async function generateUniqueAccessCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateAccessCode();
    const existing = await prisma.testInvitation.findUnique({ where: { accessCode: code }, select: { id: true } });
    if (!existing) return code;
  }
  throw new InvitationServiceError('Could not generate a unique access code. Please try again.', 500);
}

interface ParsedInvitationRow {
  name: string;
  email: string;
}

interface BatchSendResult {
  sent: number;
  failed: number;
  failureReason?: string;
}

export interface InvitationDetails {
  invitation: {
    id: string;
    name: string;
    email: string;
    accessCode?: string | null;
  };
  test: {
    id: string;
    testCode: string;
    name: string;
    description: string | null;
    duration: number;
    startTime: Date;
    endTime: Date | null;
    isActive: boolean;
    proctorEnabled: boolean;
    assessmentMode: string;
  };
}

export interface SendInvitationSummary {
  total: number;
  sent: number;
  failed: number;
}

export interface StructuredInvitationCandidate {
  name: string;
  email: string;
  phone?: string;
}

export interface StructuredInvitationSummary extends SendInvitationSummary {
  results: Array<{
    email: string;
    status: 'SENT' | 'FAILED';
    reason?: string;
  }>;
}

export class InvitationServiceError extends Error {
  statusCode: number;
  candidateName?: string;

  constructor(message: string, statusCode = 400, candidateName?: string) {
    super(message);
    this.name = 'InvitationServiceError';
    this.statusCode = statusCode;
    this.candidateName = candidateName || undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function stripKnownLoginPath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized
    .replace(/\/admin(?:\/login)?$/i, '')
    .replace(/\/test\/login$/i, '')
    .replace(/\/+$/, '');
}

function normalizeCandidateBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    const sanitizedPath = stripKnownLoginPath(parsed.pathname);
    if (!sanitizedPath || sanitizedPath === '/') {
      return parsed.origin;
    }

    return `${parsed.origin}${sanitizedPath}`;
  } catch {
    return '';
  }
}

function getFrontendInviteBaseUrl(): string {
  const configured = [
    process.env.CANDIDATE_FRONTEND_URL || '',
    process.env.FRONTEND_URL || ''
  ]
    .join(',')
    .split(',')
    .map((value) => normalizeCandidateBaseUrl(value))
    .find((value) => value.length > 0);

  return configured || 'http://localhost:5173';
}

export function buildInviteLink(token: string): string {
  return `${normalizeBaseUrl(getFrontendInviteBaseUrl())}${CANDIDATE_LOGIN_PATH}?token=${encodeURIComponent(token)}`;
}
export function buildSebQuitLink(token: string): string {
  return `${normalizeBaseUrl(getFrontendInviteBaseUrl())}${CANDIDATE_SEB_QUIT_PATH}?token=${encodeURIComponent(token)}`;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeCellValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string') {
    return sanitizeInput(value.trim());
  }

  return sanitizeInput(String(value).trim());
}

function getCaseInsensitiveValue(row: Record<string, unknown>, key: string): string {
  const entry = Object.entries(row).find(([candidateKey]) =>
    candidateKey.replace(/^\uFEFF/, '').trim().toLowerCase() === key
  );
  if (!entry) {
    return '';
  }

  return normalizeCellValue(entry[1]);
}

async function parseCsvRows(buffer: Buffer): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];

  await new Promise<void>((resolve, reject) => {
    Readable.from([buffer])
      .pipe(csvParser())
      .on('data', (row: Record<string, unknown>) => {
        rows.push(row);
      })
      .on('error', reject)
      .on('end', () => resolve());
  });

  return rows;
}

async function parseXlsxRows(buffer: Buffer): Promise<Record<string, unknown>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as any);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new InvitationServiceError('Uploaded XLSX file is empty.');
  }

  const headerMap = new Map<string, number>();
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    const header = normalizeCellValue(cell.text).toLowerCase();
    if (header) {
      headerMap.set(header, colNumber);
    }
  });

  const nameColumn = headerMap.get('name');
  const emailColumn = headerMap.get('email');

  if (!nameColumn || !emailColumn) {
    throw new InvitationServiceError('File must include "name" and "email" columns.');
  }

  const rows: Record<string, unknown>[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    rows.push({
      name: normalizeCellValue(row.getCell(nameColumn).text),
      email: normalizeCellValue(row.getCell(emailColumn).text)
    });
  }

  return rows;
}

async function parseInvitationFile(file: Express.Multer.File): Promise<{ rows: ParsedInvitationRow[]; invalidRows: number }> {
  const extension = file.originalname.split('.').pop()?.toLowerCase();
  if (!extension || !['csv', 'xlsx'].includes(extension)) {
    throw new InvitationServiceError('Only .csv and .xlsx files are supported.');
  }

  const rawRows = extension === 'csv'
    ? await parseCsvRows(file.buffer)
    : await parseXlsxRows(file.buffer);

  if (rawRows.length === 0) {
    throw new InvitationServiceError('Uploaded file does not contain any data rows.');
  }

  const rows: ParsedInvitationRow[] = [];
  const seenEmails = new Set<string>();
  let invalidRows = 0;

  for (const rawRow of rawRows) {
    const name = getCaseInsensitiveValue(rawRow, 'name');
    const email = getCaseInsensitiveValue(rawRow, 'email').toLowerCase();

    if (!name && !email) {
      continue;
    }

    if (!name || !email || !isValidEmail(email)) {
      invalidRows += 1;
      continue;
    }

    if (seenEmails.has(email)) {
      invalidRows += 1;
      continue;
    }

    seenEmails.add(email);
    rows.push({ name, email });
  }

  if (rows.length === 0) {
    throw new InvitationServiceError('No valid rows found. Ensure each row has valid name and email values.');
  }

  return { rows, invalidRows };
}

function validateInvitationLifecycle(details: InvitationDetails, requireStarted: boolean): void {
  const now = new Date();

  if (!details.test.isActive) {
    throw new InvitationServiceError('This test is not currently active.', 400);
  }

  if (requireStarted && now < details.test.startTime) {
    throw new InvitationServiceError('This test has not started yet.', 400);
  }

  if (details.test.endTime && now > details.test.endTime) {
    throw new InvitationServiceError('This invitation has expired because the test has ended.', 400);
  }
}

async function fetchInvitationByToken(token: string): Promise<InvitationDetails> {
  const invitation = await prisma.testInvitation.findUnique({
    where: { token },
    select: {
      id: true,
      name: true,
      email: true,
      accessCode: true,
      consumedAt: true,
      test: {
        select: {
          id: true,
          testCode: true,
          name: true,
          description: true,
          duration: true,
          startTime: true,
          endTime: true,
          isActive: true,
          proctorEnabled: true,
          assessmentMode: true,
        }
      }
    }
  });

  if (!invitation) {
    throw new InvitationServiceError('Invalid invitation token.', 404);
  }

  if (invitation.consumedAt) {
    throw new InvitationServiceError('This invitation link has already been used.', 400, invitation.name);
  }

  return {
    invitation: {
      id: invitation.id,
      name: invitation.name,
      email: invitation.email,
      accessCode: invitation.accessCode
    },
    test: invitation.test
  };
}

// Resolves a manually-typed short access code (paired with the candidate's email, since
// a short code alone has less entropy than the invite-link token) to that invitation's
// underlying token, so the rest of the login flow can proceed exactly as it does for
// a clicked invite link.
export async function resolveInvitationTokenFromAccessCode(accessCode: string, email: string): Promise<string> {
  const normalizedCode = accessCode.trim().toUpperCase();
  const normalizedEmail = email.trim().toLowerCase();

  const invitation = await prisma.testInvitation.findFirst({
    where: {
      accessCode: normalizedCode,
      email: { equals: normalizedEmail, mode: 'insensitive' }
    },
    select: { token: true, consumedAt: true }
  });

  if (!invitation) {
    throw new InvitationServiceError('Invalid access code or email.', 404);
  }

  if (invitation.consumedAt) {
    throw new InvitationServiceError('This invitation has already been used.', 400);
  }

  return invitation.token;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

type InvitationEmailArgs = Parameters<typeof sendInvitationEmail>[0];

async function sendInvitationEmailWithRetry(payload: InvitationEmailArgs, email: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= EMAIL_SEND_MAX_ATTEMPTS; attempt += 1) {
    try {
      await sendInvitationEmail(payload);
      return;
    } catch (error) {
      lastError = error;

      if (attempt < EMAIL_SEND_MAX_ATTEMPTS) {
        const delay = EMAIL_SEND_RETRY_DELAY_MS * attempt;
        console.warn('Invitation email attempt failed. Retrying...', {
          email,
          attempt,
          nextAttemptInMs: delay,
          error: extractErrorMessage(error)
        });
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

export async function sendBulkTestInvitations(input: {
  testId: string;
  adminId: string;
  file: Express.Multer.File;
  customMessage?: string;
}): Promise<SendInvitationSummary> {
  const test = await (prisma.test as any).findFirst({
    where: {
      id: input.testId,
      adminId: input.adminId
    },
    select: {
      id: true,
      name: true,
      isActive: true,
      startTime: true,
      endTime: true,
      duration: true,
      inviteEmailSubject: true,
      inviteEmailBody: true,
      normalBrowserInviteEmailSubject: true,
      normalBrowserInviteEmailBody: true,
      assessmentMode: true,
      admin: { select: { company: { select: { name: true } } } }
    }
  });

  if (!test) {
    throw new InvitationServiceError('Test not found.', 404);
  }

  if (!test.isActive) {
    throw new InvitationServiceError('Cannot send invitations for an inactive test.', 400);
  }

  if (test.endTime && new Date() > test.endTime) {
    throw new InvitationServiceError('Cannot send invitations because this test has already ended.', 400);
  }

  const examStart = formatExamDate((test as any).startTime);
  const examEnd = formatExamDate((test as any).endTime);
  const { rows, invalidRows } = await parseInvitationFile(input.file);

  let sent = 0;
  let failed = invalidRows;
  const failureReasons: string[] = [];

  for (let index = 0; index < rows.length; index += EMAIL_BATCH_SIZE) {
    const batch = rows.slice(index, index + EMAIL_BATCH_SIZE);

    const batchResults = await Promise.all(batch.map(async (row): Promise<BatchSendResult> => {
      let invitationId: string | null = null;

      try {
        const token = randomBytes(32).toString('hex');
        const accessCode = await generateUniqueAccessCode();

        const invitation = await prisma.testInvitation.upsert({
          where: {
            testId_email: {
              testId: test.id,
              email: row.email
            }
          },
          create: {
            testId: test.id,
            name: row.name,
            email: row.email,
            token,
            accessCode,
            status: 'PENDING'
          },
          update: {
            name: row.name,
            token,
            accessCode,
            status: 'PENDING',
            sentAt: null,
            error: null,
            consumedAt: null
          }
        });

        invitationId = invitation.id;

        const activeTemplate = activeInvitationTemplate(test);
        await sendInvitationEmailWithRetry({
          to: row.email,
          candidateName: row.name,
          testName: test.name,
          testLink: buildInviteLink(invitation.token),
          accessCode: invitation.accessCode ?? accessCode,
          companyName: (test as any).admin?.company?.name ?? undefined,
          estimatedTime: `${(test as any).duration ?? ''} minutes`,
          examStart,
          examEnd,
          inviteEmailSubject: activeTemplate.subject,
          inviteEmailBody: activeTemplate.body,
          assessmentMode: activeTemplate.assessmentMode,
        }, row.email);

        await prisma.testInvitation.update({
          where: { id: invitation.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            error: null
          }
        });

        return { sent: 1, failed: 0 };
      } catch (error) {
        const failureMessage = extractErrorMessage(error);

        if (invitationId) {
          try {
            await prisma.testInvitation.update({
              where: { id: invitationId },
              data: {
                status: 'FAILED',
                error: failureMessage.slice(0, 500)
              }
            });
          } catch (updateError) {
            console.error('Failed to update invitation status after email failure:', {
              invitationId,
              error: extractErrorMessage(updateError)
            });
          }
        }

        console.error('Invitation send failure:', {
          testId: test.id,
          email: row.email,
          error: failureMessage
        });

        return {
          sent: 0,
          failed: 1,
          failureReason: failureMessage
        };
      }
    }));

    for (const result of batchResults) {
      sent += result.sent;
      failed += result.failed;

      if (result.failureReason && failureReasons.length < 5) {
        failureReasons.push(result.failureReason);
      }
    }

    if (index + EMAIL_BATCH_SIZE < rows.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  if (sent === 0 && rows.length > 0) {
    const firstFailure = failureReasons.length > 0 ? ` First failure: ${failureReasons[0]}` : '';
    throw new InvitationServiceError(
      `No invitation emails were sent. Please check mail provider configuration (SendGrid/SMTP) and server logs.${firstFailure}`,
      502
    );
  }

  return {
    total: rows.length + invalidRows,
    sent,
    failed
  };
}

export async function sendStructuredTestInvitations(input: {
  testId: string;
  candidates: StructuredInvitationCandidate[];
  customMessage?: string;
}): Promise<StructuredInvitationSummary> {
  const test = await (prisma.test as any).findUnique({
    where: { id: input.testId },
    select: {
      id: true,
      name: true,
      isActive: true,
      startTime: true,
      endTime: true,
      duration: true,
      inviteEmailSubject: true,
      inviteEmailBody: true,
      normalBrowserInviteEmailSubject: true,
      normalBrowserInviteEmailBody: true,
      assessmentMode: true,
      admin: { select: { company: { select: { name: true } } } }
    }
  });

  if (!test) {
    throw new InvitationServiceError('Test not found.', 404);
  }

  if (!test.isActive) {
    throw new InvitationServiceError('Cannot send invitations for an inactive test.', 400);
  }

  if (test.endTime && new Date() > test.endTime) {
    throw new InvitationServiceError('Cannot send invitations because this test has already ended.', 400);
  }

  const examStart = formatExamDate((test as any).startTime);
  const examEnd = formatExamDate((test as any).endTime);
  const dedupedCandidates = new Map<string, StructuredInvitationCandidate>();
  for (const candidate of input.candidates) {
    const email = sanitizeInput(candidate.email).toLowerCase().trim();
    const name = sanitizeInput(candidate.name).trim();
    if (!email || !name || !isValidEmail(email)) {
      continue;
    }

    const phone = candidate.phone ? sanitizeInput(candidate.phone).trim() : undefined;
    dedupedCandidates.set(email, { email, name, phone });
  }

  const rows = Array.from(dedupedCandidates.values());
  if (rows.length === 0) {
    throw new InvitationServiceError('No valid candidates supplied.', 400);
  }

  const results: StructuredInvitationSummary['results'] = [];
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    let invitationId: string | null = null;
    try {
      const token = randomBytes(32).toString('hex');
      const accessCode = await generateUniqueAccessCode();
      const invitation = await prisma.testInvitation.upsert({
        where: {
          testId_email: {
            testId: test.id,
            email: row.email
          }
        },
        create: {
          testId: test.id,
          name: row.name,
          email: row.email,
          phone: row.phone ?? null,
          token,
          accessCode,
          status: 'PENDING'
        },
        update: {
          name: row.name,
          phone: row.phone ?? null,
          token,
          accessCode,
          status: 'PENDING',
          sentAt: null,
          error: null,
          consumedAt: null
        }
      });

      invitationId = invitation.id;

      const activeTemplate = activeInvitationTemplate(test);
      await sendInvitationEmailWithRetry({
        to: row.email,
        candidateName: row.name,
        testName: test.name,
        testLink: buildInviteLink(invitation.token),
        accessCode: invitation.accessCode ?? accessCode,
        companyName: (test as any).admin?.company?.name ?? undefined,
        estimatedTime: `${(test as any).duration ?? ''} minutes`,
        examStart,
        examEnd,
        inviteEmailSubject: activeTemplate.subject,
        inviteEmailBody: activeTemplate.body,
        assessmentMode: activeTemplate.assessmentMode,
      }, row.email);

      await prisma.testInvitation.update({
        where: { id: invitation.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          error: null
        }
      });

      sent += 1;
      results.push({ email: row.email, status: 'SENT' });
    } catch (error) {
      const failureMessage = extractErrorMessage(error);
      failed += 1;
      results.push({ email: row.email, status: 'FAILED', reason: failureMessage });

      if (invitationId) {
        try {
          await prisma.testInvitation.update({
            where: { id: invitationId },
            data: {
              status: 'FAILED',
              error: failureMessage.slice(0, 500)
            }
          });
        } catch (updateError) {
          console.error('Failed to update invitation status after structured send failure:', {
            invitationId,
            error: extractErrorMessage(updateError)
          });
        }
      }
    }
  }

  return {
    total: rows.length,
    sent,
    failed,
    results
  };
}

export interface SilentInvitationResult {
  invitationId: string;
  token: string;
  accessCode: string;
  redirectUrl: string;
  isNew: boolean;
  consumed: boolean;
}

// Creates (or reuses) a TestInvitation without sending an email — for recruiter
// platforms that want to redirect a candidate straight into TalentStaq (deep-link
// SSO) rather than have TalentStaq's own invite email be the delivery mechanism.
export async function createSilentInvitationForCandidate(input: {
  testId: string;
  candidate: StructuredInvitationCandidate;
}): Promise<SilentInvitationResult> {
  const test = await prisma.test.findUnique({
    where: { id: input.testId },
    select: { id: true, isActive: true, endTime: true },
  });

  if (!test) {
    throw new InvitationServiceError('Test not found.', 404);
  }
  if (!test.isActive) {
    throw new InvitationServiceError('Cannot create a session for an inactive test.', 400);
  }
  if (test.endTime && new Date() > test.endTime) {
    throw new InvitationServiceError('Cannot create a session because this test has already ended.', 400);
  }

  const email = sanitizeInput(input.candidate.email).toLowerCase().trim();
  const name = sanitizeInput(input.candidate.name).trim();
  if (!email || !name || !isValidEmail(email)) {
    throw new InvitationServiceError('A valid candidate name and email are required.', 400);
  }
  const phone = input.candidate.phone ? sanitizeInput(input.candidate.phone).trim() : undefined;

  const existing = await prisma.testInvitation.findUnique({
    where: { testId_email: { testId: test.id, email } },
  });

  if (existing) {
    return {
      invitationId: existing.id,
      token: existing.token,
      accessCode: existing.accessCode ?? '',
      redirectUrl: buildInviteLink(existing.token),
      isNew: false,
      consumed: !!existing.consumedAt,
    };
  }

  const token = randomBytes(32).toString('hex');
  const accessCode = await generateUniqueAccessCode();

  const invitation = await prisma.testInvitation.create({
    data: {
      testId: test.id,
      name,
      email,
      phone: phone ?? null,
      token,
      accessCode,
      status: 'PENDING',
    },
  });

  return {
    invitationId: invitation.id,
    token: invitation.token,
    accessCode: invitation.accessCode ?? accessCode,
    redirectUrl: buildInviteLink(invitation.token),
    isNew: true,
    consumed: false,
  };
}

// Wipes an attempt's answers/logs/proctoring/analytics and resets it to a blank permission
// state, so the same TestAttempt row (schema enforces one per test+candidate) can be reused
// for a genuine retake — either a candidate re-logging in on a test with allowMultipleAttempts,
// or an admin resending an invitation to a candidate whose earlier attempt needs to be undone
// (e.g. wrongly auto-submitted). Deliberately leaves TestAttemptQuestion alone so a retake
// keeps the same assigned question set rather than reshuffling.
export async function resetAttemptForRetake(attemptId: string): Promise<void> {
  await prisma.$transaction([
    prisma.mCQAnswer.deleteMany({ where: { attemptId } }),
    prisma.codingAnswer.deleteMany({ where: { attemptId } }),
    prisma.behavioralAnswer.deleteMany({ where: { attemptId } }),
    prisma.communicationAnswer.deleteMany({ where: { attemptId } }),
    prisma.activityLog.deleteMany({ where: { attemptId } }),
    prisma.proctorSession.deleteMany({ where: { attemptId } }),
    prisma.performanceAnalytics.deleteMany({ where: { attemptId } }),
    prisma.testAttempt.update({
      where: { id: attemptId },
      data: {
        startTime: new Date(),
        endTime: null,
        submittedAt: null,
        status: 'permission',
        score: null,
        violations: 0,
        isFlagged: false,
        flagReason: null,
        lastSeenAt: null,
      },
    }),
  ]);
}

export interface ResendInvitationResult {
  email: string;
  name: string;
  attemptReset: boolean;
}

// Admin-triggered: regenerates a candidate's invitation token/access code and re-emails it,
// resetting any existing attempt first so the new link leads to a clean retake rather than
// landing back on a stale result (e.g. a candidate wrongly auto-submitted by the expiry sweep
// before ever answering a question).
export async function resendInvitationForCandidate(input: {
  testId: string;
  adminId: string;
  invitationId: string;
}): Promise<ResendInvitationResult> {
  const test = await (prisma.test as any).findFirst({
    where: { id: input.testId, adminId: input.adminId },
    select: {
      id: true,
      name: true,
      isActive: true,
      startTime: true,
      endTime: true,
      duration: true,
      inviteEmailSubject: true,
      inviteEmailBody: true,
      normalBrowserInviteEmailSubject: true,
      normalBrowserInviteEmailBody: true,
      assessmentMode: true,
      admin: { select: { company: { select: { name: true } } } }
    }
  });

  if (!test) {
    throw new InvitationServiceError('Test not found.', 404);
  }
  if (!test.isActive) {
    throw new InvitationServiceError('Cannot resend invitations for an inactive test.', 400);
  }
  if (test.endTime && new Date() > test.endTime) {
    throw new InvitationServiceError('Cannot resend invitations because this test has already ended.', 400);
  }

  const invitation = await prisma.testInvitation.findFirst({
    where: { id: input.invitationId, testId: test.id }
  });
  if (!invitation) {
    throw new InvitationServiceError('Invitation not found.', 404);
  }

  const candidate = await prisma.candidate.findUnique({ where: { email: invitation.email } });
  let attemptReset = false;
  if (candidate) {
    const existingAttempt = await prisma.testAttempt.findUnique({
      where: { testId_candidateId: { testId: test.id, candidateId: candidate.id } }
    });
    if (existingAttempt) {
      await resetAttemptForRetake(existingAttempt.id);
      attemptReset = true;
    }
  }

  const token = randomBytes(32).toString('hex');
  const accessCode = await generateUniqueAccessCode();
  const updated = await prisma.testInvitation.update({
    where: { id: invitation.id },
    data: { token, accessCode, status: 'PENDING', sentAt: null, error: null, consumedAt: null }
  });

  const examStart = formatExamDate((test as any).startTime);
  const examEnd = formatExamDate((test as any).endTime);

  try {
    const activeTemplate = activeInvitationTemplate(test);
    await sendInvitationEmailWithRetry({
      to: updated.email,
      candidateName: updated.name,
      testName: test.name,
      testLink: buildInviteLink(updated.token),
      accessCode: updated.accessCode ?? accessCode,
      companyName: (test as any).admin?.company?.name ?? undefined,
      estimatedTime: `${(test as any).duration ?? ''} minutes`,
      examStart,
      examEnd,
      inviteEmailSubject: activeTemplate.subject,
      inviteEmailBody: activeTemplate.body,
      assessmentMode: activeTemplate.assessmentMode,
    }, updated.email);

    await prisma.testInvitation.update({
      where: { id: updated.id },
      data: { status: 'SENT', sentAt: new Date(), error: null }
    });
  } catch (error) {
    const failureMessage = extractErrorMessage(error);
    await prisma.testInvitation.update({
      where: { id: updated.id },
      data: { status: 'FAILED', error: failureMessage.slice(0, 500) }
    });
    throw new InvitationServiceError(`Failed to send invitation email: ${failureMessage}`, 502);
  }

  return { email: updated.email, name: updated.name, attemptReset };
}

export async function getPublicInvitationDetails(token: string): Promise<InvitationDetails> {
  const details = await fetchInvitationByToken(token);
  validateInvitationLifecycle(details, false);
  return details;
}

export async function getInvitationContextForLogin(token: string): Promise<InvitationDetails> {
  const details = await fetchInvitationByToken(token);
  validateInvitationLifecycle(details, true);
  return details;
}

export async function consumeInvitation(invitationId: string, testId: string): Promise<void> {
  const invitation = await prisma.testInvitation.findUnique({
    where: { id: invitationId },
    select: {
      id: true,
      testId: true,
      consumedAt: true,
      test: {
        select: {
          id: true,
          startTime: true,
          endTime: true,
          isActive: true
        }
      }
    }
  });

  if (!invitation || invitation.testId !== testId) {
    throw new InvitationServiceError('Invalid invitation context.', 400);
  }

  // Idempotent: the caller (startTest) is guarded by the candidate's own in_progress
  // attempt, so a repeat call here (page refresh, retried request after a dropped
  // connection) is the same candidate resuming, not a second person reusing the link.
  if (invitation.consumedAt) {
    return;
  }

  const lifecycleDetails: InvitationDetails = {
    invitation: {
      id: invitation.id,
      name: '',
      email: ''
    },
    test: {
      id: invitation.test.id,
      testCode: '',
      name: '',
      description: null,
      duration: 0,
      startTime: invitation.test.startTime,
      endTime: invitation.test.endTime,
      isActive: invitation.test.isActive,
      proctorEnabled: false,
      assessmentMode: 'SEB'
    }
  };

  validateInvitationLifecycle(lifecycleDetails, true);

  const updateResult = await prisma.testInvitation.updateMany({
    where: {
      id: invitationId,
      testId,
      consumedAt: null
    },
    data: {
      consumedAt: new Date()
    }
  });

  if (updateResult.count === 0) {
    throw new InvitationServiceError('This invitation link has already been used.', 400);
  }
}
