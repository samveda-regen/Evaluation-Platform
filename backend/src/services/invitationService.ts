import { randomBytes } from 'crypto';
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
  };
}

export interface SendInvitationSummary {
  total: number;
  sent: number;
  failed: number;
}

export class InvitationServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'InvitationServiceError';
    this.statusCode = statusCode;
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

function buildInviteLink(token: string): string {
  return `${normalizeBaseUrl(getFrontendInviteBaseUrl())}${CANDIDATE_LOGIN_PATH}?token=${encodeURIComponent(token)}`;
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
          isActive: true
        }
      }
    }
  });

  if (!invitation) {
    throw new InvitationServiceError('Invalid invitation token.', 404);
  }

  if (invitation.consumedAt) {
    throw new InvitationServiceError('This invitation link has already been used.', 400);
  }

  return {
    invitation: {
      id: invitation.id,
      name: invitation.name,
      email: invitation.email
    },
    test: invitation.test
  };
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
  const test = await prisma.test.findFirst({
    where: {
      id: input.testId,
      adminId: input.adminId
    },
    select: {
      id: true,
      name: true,
      testCode: true,
      isActive: true,
      endTime: true,
      invitationEmailSubject: true,
      invitationEmailBody: true
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

  const { rows, invalidRows } = await parseInvitationFile(input.file);
  const sanitizedCustomMessage = input.customMessage ? sanitizeInput(input.customMessage.trim()) : undefined;

  let sent = 0;
  let failed = invalidRows;
  const failureReasons: string[] = [];

  for (let index = 0; index < rows.length; index += EMAIL_BATCH_SIZE) {
    const batch = rows.slice(index, index + EMAIL_BATCH_SIZE);

    const batchResults = await Promise.all(batch.map(async (row): Promise<BatchSendResult> => {
      let invitationId: string | null = null;

      try {
        const token = randomBytes(32).toString('hex');

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
            status: 'PENDING'
          },
          update: {
            name: row.name,
            token,
            status: 'PENDING',
            sentAt: null,
            error: null,
            consumedAt: null
          }
        });

        invitationId = invitation.id;

        await sendInvitationEmailWithRetry({
          to: row.email,
          candidateName: row.name,
          testName: test.name,
          testCode: test.testCode,
          testLink: buildInviteLink(invitation.token),
          customMessage: sanitizedCustomMessage,
          subjectTemplate: test.invitationEmailSubject || undefined,
          bodyTemplate: test.invitationEmailBody || undefined
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
      `No invitation emails were sent. Please check SMTP mail configuration and server logs.${firstFailure}`,
      502
    );
  }

  return {
    total: rows.length + invalidRows,
    sent,
    failed
  };
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

  if (invitation.consumedAt) {
    throw new InvitationServiceError('This invitation link has already been used.', 400);
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
      isActive: invitation.test.isActive
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

export async function sendInvitationPreviewEmail(input: {
  testId: string;
  adminId: string;
  email: string;
  candidateName?: string;
}): Promise<void> {
  const test = await prisma.test.findFirst({
    where: {
      id: input.testId,
      adminId: input.adminId
    },
    select: {
      id: true,
      name: true,
      testCode: true,
      invitationEmailSubject: true,
      invitationEmailBody: true
    }
  });

  if (!test) {
    throw new InvitationServiceError('Test not found.', 404);
  }

  const token = `preview-${randomBytes(16).toString('hex')}`;
  const candidateName = input.candidateName?.trim() || 'Preview Candidate';
  const previewNote = 'Preview only. This link will not start a real test.';

  await sendInvitationEmail({
    to: input.email,
    candidateName,
    testName: test.name,
    testCode: test.testCode,
    testLink: buildInviteLink(token),
    customMessage: previewNote,
    subjectTemplate: test.invitationEmailSubject || undefined,
    bodyTemplate: test.invitationEmailBody || undefined
  });
}
