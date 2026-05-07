import { Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';

import type { AuthenticatedRequest } from '../types/index.js';
import prisma from '../utils/db.js';
import { sanitizeInput } from '../utils/sanitize.js';
import { generateIntegrationToken } from '../utils/jwt.js';
import { InvitationServiceError, sendStructuredTestInvitations } from '../services/invitationService.js';
import { generateTestFromJobProfile, createTestFromSelection } from '../services/testAgentService.js';

type RecruiterClaims = {
  sub: string;
  email: string;
  name?: string;
  role?: string;
  companyId?: string;
  company_id: string;
  company_name?: string;
  iss?: string;
  aud?: string | string[];
};

const RECRUITER_JWT_SECRET = process.env.RECRUITER_JWT_SECRET || '';
const RECRUITER_JWT_ISSUER = process.env.RECRUITER_JWT_ISSUER || '';
const RECRUITER_JWT_AUDIENCE = process.env.RECRUITER_JWT_AUDIENCE || '';
const INTEGRATION_PROVIDER = process.env.INTEGRATION_PROVIDER || 'recruit_portal';
const REFRESH_TOKEN_EXPIRY_DAYS = Number.parseInt(process.env.INTEGRATION_REFRESH_TOKEN_EXPIRY_DAYS || '30', 10);

function hashRefreshToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function issueRefreshExpiry(): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
  return expiry;
}

function parseIntegrationScopes(role: string | undefined): string[] {
  const normalizedRole = (role || '').trim().toLowerCase();
  if (normalizedRole === 'recruiter_user') {
    return ['tests:read', 'results:read'];
  }

  return ['tests:read', 'invites:write', 'results:read'];
}

function parseStoredScopes(scopes: string): string[] {
  try {
    const parsed = JSON.parse(scopes) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((scope): scope is string => typeof scope === 'string');
  } catch {
    return [];
  }
}

function verifyRecruiterJwt(token: string): RecruiterClaims {
  if (!RECRUITER_JWT_SECRET) {
    throw new Error('RECRUITER_JWT_SECRET is not configured');
  }

  const payload = jwt.verify(token, RECRUITER_JWT_SECRET, {
    issuer: RECRUITER_JWT_ISSUER || undefined,
    audience: RECRUITER_JWT_AUDIENCE || undefined,
  }) as RecruiterClaims;

  const companyClaim = typeof payload.companyId === 'string' ? payload.companyId.trim() : payload.company_id;
  if (!payload.sub || !payload.email || !companyClaim) {
    throw new Error('Recruiter JWT missing required claims (sub, email, companyId/company_id)');
  }

  payload.company_id = companyClaim;
  return payload;
}

async function upsertIntegrationAdmin(claims: RecruiterClaims) {
  const externalUserId = sanitizeInput(claims.sub.trim());
  const sanitizedEmail = sanitizeInput(claims.email).toLowerCase();
  const sanitizedName = claims.name ? sanitizeInput(claims.name) : sanitizedEmail;
  const externalCompanyId = sanitizeInput(claims.company_id.trim());
  const companyName = claims.company_name
    ? sanitizeInput(claims.company_name)
    : `Company ${externalCompanyId}`;

  const company = await prisma.company.upsert({
    where: { externalCompanyId },
    create: {
      externalCompanyId,
      name: companyName,
    },
    update: {
      name: companyName,
    },
  });

  const adminByExternal = await prisma.admin.findUnique({
    where: {
      externalProvider_externalUserId: {
        externalProvider: INTEGRATION_PROVIDER,
        externalUserId,
      },
    },
  });

  if (adminByExternal) {
    const admin = await prisma.admin.update({
      where: { id: adminByExternal.id },
      data: {
        email: sanitizedEmail,
        name: sanitizedName,
        companyId: company.id,
      },
    });

    return { admin, company };
  }

  const adminByEmail = await prisma.admin.findUnique({
    where: { email: sanitizedEmail },
  });

  if (adminByEmail) {
    const admin = await prisma.admin.update({
      where: { id: adminByEmail.id },
      data: {
        name: sanitizedName,
        companyId: company.id,
        externalProvider: INTEGRATION_PROVIDER,
        externalUserId,
      },
    });

    return { admin, company };
  }

  const generatedPassword = randomBytes(24).toString('hex');
  const passwordHash = await bcrypt.hash(generatedPassword, 12);

  const admin = await prisma.admin.create({
    data: {
      email: sanitizedEmail,
      name: sanitizedName,
      password: passwordHash,
      companyId: company.id,
      externalProvider: INTEGRATION_PROVIDER,
      externalUserId,
    },
  });

  return { admin, company };
}

async function findCompanyScopedTest(testId: string, companyId: string) {
  return prisma.test.findFirst({
    where: {
      id: testId,
      companyId,
    },
    select: {
      id: true,
      name: true,
      isActive: true,
      startTime: true,
      endTime: true,
      companyId: true,
    },
  });
}

async function resolveInternalCompanyId(claimCompanyId: string): Promise<string | null> {
  const normalizedClaim = claimCompanyId.trim();
  if (!normalizedClaim) {
    return null;
  }

  const company = await prisma.company.findFirst({
    where: {
      OR: [
        { id: normalizedClaim },
        { externalCompanyId: normalizedClaim },
      ],
    },
    select: { id: true },
  });

  return company?.id ?? null;
}

export async function exchangeRecruiterToken(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const recruiterJwt = typeof req.body.recruiterJwt === 'string'
      ? req.body.recruiterJwt.trim()
      : '';

    if (!recruiterJwt) {
      res.status(400).json({ error: 'recruiterJwt is required' });
      return;
    }

    const claims = verifyRecruiterJwt(recruiterJwt);
    const scopes = parseIntegrationScopes(claims.role);
    const { admin, company } = await upsertIntegrationAdmin(claims);

    const accessToken = generateIntegrationToken({
      id: admin.id,
      email: admin.email,
      role: 'integration_admin',
      companyId: company.id,
      scopes,
    });

    const refreshToken = randomBytes(48).toString('hex');
    await prisma.authSession.create({
      data: {
        adminId: admin.id,
        refreshTokenHash: hashRefreshToken(refreshToken),
        scopes: JSON.stringify(scopes),
        userAgent: req.headers['user-agent'] ?? null,
        ipAddress: req.ip,
        expiresAt: issueRefreshExpiry(),
      },
    });

    res.json({
      token_type: 'Bearer',
      access_token: accessToken,
      expires_in: 900,
      refresh_token: refreshToken,
      refresh_expires_in: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
      scopes,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
      },
      company: {
        id: company.id,
        external_company_id: company.externalCompanyId,
        name: company.name,
      },
    });
  } catch (error) {
    console.error('Integration token exchange error:', error);
    res.status(401).json({ error: 'Failed to verify recruiter token' });
  }
}

export async function refreshIntegrationToken(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const refreshToken = typeof req.body.refreshToken === 'string'
      ? req.body.refreshToken.trim()
      : '';

    if (!refreshToken) {
      res.status(400).json({ error: 'refreshToken is required' });
      return;
    }

    const refreshTokenHash = hashRefreshToken(refreshToken);
    const session = await prisma.authSession.findUnique({
      where: { refreshTokenHash },
      include: {
        admin: {
          include: {
            company: true,
          },
        },
      },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }

    if (!session.admin.companyId || !session.admin.company) {
      res.status(400).json({ error: 'Admin is not mapped to a company' });
      return;
    }

    const scopes = parseStoredScopes(session.scopes);

    if (scopes.length === 0) {
      res.status(401).json({ error: 'Invalid refresh token scope state' });
      return;
    }

    const accessToken = generateIntegrationToken({
      id: session.admin.id,
      email: session.admin.email,
      role: 'integration_admin',
      companyId: session.admin.companyId,
      scopes,
    });

    const newRefreshToken = randomBytes(48).toString('hex');

    await prisma.$transaction([
      prisma.authSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      }),
      prisma.authSession.create({
        data: {
          adminId: session.admin.id,
          refreshTokenHash: hashRefreshToken(newRefreshToken),
          scopes: session.scopes,
          userAgent: req.headers['user-agent'] ?? null,
          ipAddress: req.ip,
          expiresAt: issueRefreshExpiry(),
        },
      }),
    ]);

    res.json({
      token_type: 'Bearer',
      access_token: accessToken,
      expires_in: 900,
      refresh_token: newRefreshToken,
      refresh_expires_in: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
      scopes,
    });
  } catch (error) {
    console.error('Integration token refresh error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getCompanyTests(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const companyId = await resolveInternalCompanyId(req.integration!.companyId);
    if (!companyId) {
      res.status(403).json({
        error: 'forbidden_company_scope',
        message: 'Unknown company scope',
      });
      return;
    }
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const skip = (page - 1) * limit;
    const status = typeof req.query.status === 'string' ? req.query.status.toLowerCase() : 'all';

    const where: {
      companyId: string;
      isActive?: boolean;
    } = { companyId };

    if (status === 'active') {
      where.isActive = true;
    }

    if (status === 'inactive') {
      where.isActive = false;
    }

    const [tests, total] = await Promise.all([
      prisma.test.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          testCode: true,
          name: true,
          isActive: true,
          startTime: true,
          endTime: true,
          duration: true,
          totalMarks: true,
          _count: {
            select: {
              invitations: true,
              attempts: true,
            },
          },
        },
      }),
      prisma.test.count({ where }),
    ]);

    res.json({
      tests: tests.map((test) => ({
        id: test.id,
        testCode: test.testCode,
        name: test.name,
        isActive: test.isActive,
        startTime: test.startTime,
        endTime: test.endTime,
        duration: test.duration,
        totalMarks: test.totalMarks,
        invitedCount: test._count.invitations,
        attemptCount: test._count.attempts,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get company tests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function inviteCandidatesFromIntegration(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId } = req.params;
    const companyId = await resolveInternalCompanyId(req.integration!.companyId);
    if (!companyId) {
      res.status(403).json({
        error: 'forbidden_company_scope',
        message: 'Unknown company scope',
      });
      return;
    }

    const scopedTest = await findCompanyScopedTest(testId, companyId);
    if (!scopedTest) {
      res.status(403).json({
        error: 'forbidden_company_scope',
        message: 'You cannot access this test',
      });
      return;
    }

    const candidatesInput: unknown[] = Array.isArray(req.body.candidates) ? req.body.candidates : [];
    if (candidatesInput.length === 0) {
      res.status(400).json({ error: 'candidates array is required' });
      return;
    }

    const candidates: { name: string; email: string; phone?: string }[] = [];
    for (const entry of candidatesInput) {
      if (!entry || typeof entry !== 'object') continue;
      const payload = entry as { name?: unknown; email?: unknown; phone?: unknown };
      const name = typeof payload.name === 'string' ? sanitizeInput(payload.name).trim() : '';
      const email = typeof payload.email === 'string' ? sanitizeInput(payload.email).toLowerCase().trim() : '';
      if (!name || !email) continue;
      const phone = typeof payload.phone === 'string' ? sanitizeInput(payload.phone).trim() : undefined;
      candidates.push({ name, email, ...(phone ? { phone } : {}) });
    }

    if (candidates.length === 0) {
      res.status(400).json({ error: 'No valid candidates supplied' });
      return;
    }

    const customMessage = typeof req.body.customMessage === 'string'
      ? sanitizeInput(req.body.customMessage)
      : undefined;

    const summary = await sendStructuredTestInvitations({
      testId,
      candidates,
      customMessage,
    });

    res.json({
      testId,
      ...summary,
    });
  } catch (error) {
    if (error instanceof InvitationServiceError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    console.error('Integration invite candidates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getTestCandidateResultsForIntegration(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId } = req.params;
    const companyId = await resolveInternalCompanyId(req.integration!.companyId);
    if (!companyId) {
      res.status(403).json({
        error: 'forbidden_company_scope',
        message: 'Unknown company scope',
      });
      return;
    }

    const scopedTest = await findCompanyScopedTest(testId, companyId);
    if (!scopedTest) {
      res.status(403).json({
        error: 'forbidden_company_scope',
        message: 'You cannot access this test',
      });
      return;
    }

    const invitations = await prisma.testInvitation.findMany({
      where: { testId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        sentAt: true,
        consumedAt: true,
        createdAt: true,
      },
    });

    const emails = invitations.map((invitation) => invitation.email.toLowerCase());
    const attempts = emails.length === 0
      ? []
      : await prisma.testAttempt.findMany({
        where: {
          testId,
          candidate: { email: { in: emails } },
        },
        select: {
          id: true,
          status: true,
          score: true,
          startTime: true,
          endTime: true,
          submittedAt: true,
          violations: true,
          candidate: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

    const attemptsByEmail = new Map(
      attempts.map((attempt) => [attempt.candidate.email.toLowerCase(), attempt])
    );

    const rows = invitations.map((invitation) => {
      const attempt = attemptsByEmail.get(invitation.email.toLowerCase());
      return {
        invitationId: invitation.id,
        candidate: {
          id: attempt?.candidate.id ?? null,
          name: attempt?.candidate.name ?? invitation.name,
          email: invitation.email,
          phone: invitation.phone ?? null,
        },
        invitationStatus: invitation.status,
        invitationSentAt: invitation.sentAt,
        invitationConsumedAt: invitation.consumedAt,
        attempt: attempt
          ? {
              id: attempt.id,
              status: attempt.status,
              score: attempt.score,
              startTime: attempt.startTime,
              endTime: attempt.endTime,
              submittedAt: attempt.submittedAt,
              violations: attempt.violations,
            }
          : null,
        createdAt: invitation.createdAt,
      };
    });

    const completed = rows.filter((row) => row.attempt?.status === 'submitted' || row.attempt?.status === 'auto_submitted').length;
    const started = rows.filter((row) => row.attempt?.status === 'in_progress').length;

    res.json({
      test: {
        id: scopedTest.id,
        name: scopedTest.name,
        isActive: scopedTest.isActive,
        startTime: scopedTest.startTime,
        endTime: scopedTest.endTime,
      },
      summary: {
        invited: rows.length,
        started,
        completed,
        notStarted: rows.length - started - completed,
      },
      results: rows,
    });
  } catch (error) {
    console.error('Integration test results error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createTestWithAIAndInvite(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const adminId = req.integration!.id;
    const companyId = await resolveInternalCompanyId(req.integration!.companyId);
    if (!companyId) {
      res.status(403).json({ error: 'forbidden_company_scope', message: 'Unknown company scope' });
      return;
    }

    // Validate jobProfile
    const jobProfileRaw = req.body.jobProfile;
    if (!jobProfileRaw || typeof jobProfileRaw !== 'object') {
      res.status(400).json({ error: 'jobProfile is required' });
      return;
    }
    const jobTitle = typeof jobProfileRaw.title === 'string' ? sanitizeInput(jobProfileRaw.title).trim() : '';
    if (!jobTitle) {
      res.status(400).json({ error: 'jobProfile.title is required' });
      return;
    }
    const jobProfile = {
      title: jobTitle,
      experience: typeof jobProfileRaw.experience === 'string' ? jobProfileRaw.experience.trim() : '0-2 years',
      description: typeof jobProfileRaw.description === 'string' ? jobProfileRaw.description.trim() : undefined,
    };

    // Validate skills
    const skillsRaw: unknown[] = Array.isArray(req.body.skills) ? req.body.skills : [];
    const skills = skillsRaw.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim());
    if (skills.length === 0) {
      res.status(400).json({ error: 'skills array with at least one skill is required' });
      return;
    }

    // Validate difficulty
    const difficultyRaw = typeof req.body.difficulty === 'string' ? req.body.difficulty.toLowerCase() : '';
    const validDifficulties = ['easy', 'medium', 'hard', 'mixed'] as const;
    type Difficulty = typeof validDifficulties[number];
    const difficulty: Difficulty = (validDifficulties as readonly string[]).includes(difficultyRaw)
      ? (difficultyRaw as Difficulty)
      : 'medium';

    // Validate question counts
    const mcqCount = Math.max(0, Number.parseInt(String(req.body.mcqCount ?? '0'), 10) || 0);
    const codingCount = Math.max(0, Number.parseInt(String(req.body.codingCount ?? '0'), 10) || 0);
    if (mcqCount === 0 && codingCount === 0) {
      res.status(400).json({ error: 'At least one of mcqCount or codingCount must be greater than 0' });
      return;
    }

    // Validate testSettings
    const settingsRaw = req.body.testSettings && typeof req.body.testSettings === 'object' ? req.body.testSettings : {};
    const startTimeRaw = typeof settingsRaw.startTime === 'string' ? settingsRaw.startTime : '';
    if (!startTimeRaw) {
      res.status(400).json({ error: 'testSettings.startTime is required' });
      return;
    }
    const startTime = new Date(startTimeRaw);
    if (Number.isNaN(startTime.getTime())) {
      res.status(400).json({ error: 'testSettings.startTime is not a valid date' });
      return;
    }
    const endTime = typeof settingsRaw.endTime === 'string' ? new Date(settingsRaw.endTime) : undefined;
    const testSettings = {
      startTime,
      endTime: endTime && !Number.isNaN(endTime.getTime()) ? endTime : undefined,
      duration: typeof settingsRaw.duration === 'number' ? settingsRaw.duration : undefined,
      passingMarks: typeof settingsRaw.passingMarks === 'number' ? settingsRaw.passingMarks : undefined,
      negativeMarking: typeof settingsRaw.negativeMarking === 'number' ? settingsRaw.negativeMarking : undefined,
      shuffleQuestions: typeof settingsRaw.shuffleQuestions === 'boolean' ? settingsRaw.shuffleQuestions : true,
      shuffleOptions: typeof settingsRaw.shuffleOptions === 'boolean' ? settingsRaw.shuffleOptions : true,
      maxViolations: typeof settingsRaw.maxViolations === 'number' ? settingsRaw.maxViolations : undefined,
    };

    // Parse candidates (optional — invitations are sent only if provided)
    const candidatesInput: unknown[] = Array.isArray(req.body.candidates) ? req.body.candidates : [];
    const candidates: { name: string; email: string; phone?: string }[] = [];
    for (const entry of candidatesInput) {
      if (!entry || typeof entry !== 'object') continue;
      const p = entry as { name?: unknown; email?: unknown; phone?: unknown };
      const name = typeof p.name === 'string' ? sanitizeInput(p.name).trim() : '';
      const email = typeof p.email === 'string' ? sanitizeInput(p.email).toLowerCase().trim() : '';
      if (!name || !email) continue;
      const phone = typeof p.phone === 'string' ? sanitizeInput(p.phone).trim() : undefined;
      candidates.push({ name, email, ...(phone ? { phone } : {}) });
    }

    // Step 1: AI selects questions
    const selection = await generateTestFromJobProfile(
      { jobProfile, skills, difficulty, mcqCount, codingCount },
      adminId
    );

    // Step 2: Create the test
    const { testId, testCode } = await createTestFromSelection(adminId, selection, testSettings);

    // Link test to integration company
    await prisma.test.update({ where: { id: testId }, data: { companyId } });

    // Step 3: Send invitations if candidates were provided
    let invitationSummary = null;
    if (candidates.length > 0) {
      const customMessage = typeof req.body.customMessage === 'string'
        ? sanitizeInput(req.body.customMessage)
        : undefined;
      invitationSummary = await sendStructuredTestInvitations({ testId, candidates, customMessage });
    }

    res.status(201).json({
      testId,
      testCode,
      testName: selection.suggestedTestName,
      duration: testSettings.duration ?? selection.suggestedDuration,
      reasoning: selection.reasoning,
      invitations: invitationSummary
        ? { total: invitationSummary.total, sent: invitationSummary.sent, failed: invitationSummary.failed }
        : null,
    });
  } catch (error) {
    if (error instanceof InvitationServiceError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('Integration create test with AI error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
