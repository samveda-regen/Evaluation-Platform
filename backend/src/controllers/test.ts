import { Response } from 'express';
import { Prisma, QuestionRepositoryCategory, QuestionSource } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { AuthenticatedRequest } from '../types/index.js';
import { sanitizeInput } from '../utils/sanitize.js';
import prisma from '../utils/db.js';
import { generateCandidateToken } from '../utils/jwt.js';
import {
  DEFAULT_INVITE_SUBJECT,
  DEFAULT_INVITE_BODY,
  DEFAULT_CONFIRM_SUBJECT,
  DEFAULT_CONFIRM_BODY,
  DEFAULT_REMINDER_SUBJECT,
  DEFAULT_REMINDER_BODY,
  DEFAULT_NORMAL_BROWSER_INVITE_SUBJECT,
  DEFAULT_NORMAL_BROWSER_INVITE_BODY,
  DEFAULT_NORMAL_BROWSER_CONFIRM_SUBJECT,
  DEFAULT_NORMAL_BROWSER_CONFIRM_BODY,
  DEFAULT_NORMAL_BROWSER_REMINDER_SUBJECT,
  DEFAULT_NORMAL_BROWSER_REMINDER_BODY,
} from '../services/emailService.js';
import {
  DEFAULT_CUSTOM_AI_VIOLATION_EVENTS,
  normalizeCustomAIViolationEvents,
  parseStoredCustomAIViolationEvents,
} from '../utils/proctoringConfig.js';
import { buildCreateData as buildCommunicationCreateData, VALID_SUB_TYPES as VALID_COMMUNICATION_SUB_TYPES, serializeCommunicationQuestion } from './communicationQuestion.js';

const TEST_SCOPED_TAG = '__test_scoped__';
const MAX_TEST_VIOLATIONS = 150;
const TEST_PREFERENCE_KEYS = [
  'category',
  'language',
  'requireInvitationLink',
  'allowAccessCode',
  'showTimer',
  'autoSubmitOnTimeout',
  'gradingMode',
  'showScoreToCandidate',
  'sendResultEmail',
  'includeAnswerReview',
] as const;

function generateTestCode(): string {
  return uuidv4().substring(0, 8).toUpperCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Tests are shared across every admin in the same company; admins without a
// company (or on a stale token issued before company assignment) only see
// their own tests.
function testOwnershipWhere(req: AuthenticatedRequest, testId: string): { id: string; companyId: string } | { id: string; adminId: string } {
  const companyId = req.admin!.companyId;
  return companyId
    ? { id: testId, companyId }
    : { id: testId, adminId: req.admin!.id };
}

function testListWhere(req: AuthenticatedRequest): { companyId: string } | { adminId: string } {
  const companyId = req.admin!.companyId;
  return companyId ? { companyId } : { adminId: req.admin!.id };
}

function collectTestPreferences(source: Record<string, unknown>): Record<string, unknown> {
  return TEST_PREFERENCE_KEYS.reduce<Record<string, unknown>>((prefs, key) => {
    const value = source[key];
    if (value === undefined) return prefs;

    if (typeof value === 'string') {
      prefs[key] = sanitizeInput(value);
    } else if (typeof value === 'boolean') {
      prefs[key] = value;
    }

    return prefs;
  }, {});
}

function parseRawJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toTestOwnerTag(testId: string): string {
  return `__test:${testId}`;
}

function parseIncomingTags(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => sanitizeInput(item).trim().toLowerCase())
      .filter((item) => item.length > 0);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === 'string')
          .map((item) => sanitizeInput(item).trim().toLowerCase())
          .filter((item) => item.length > 0);
      }
    } catch {
      // Treat as CSV.
    }

    return trimmed
      .split(',')
      .map((item) => sanitizeInput(item).trim().toLowerCase())
      .filter((item) => item.length > 0);
  }

  return [];
}

function toTestScopedTagJson(testId: string, userTags: unknown): string {
  const ownerTag = toTestOwnerTag(testId);
  const merged = new Set<string>([TEST_SCOPED_TAG, ownerTag, ...parseIncomingTags(userTags)]);
  return JSON.stringify(Array.from(merged));
}

function toOptionalSanitizedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? sanitizeInput(trimmed) : null;
}

function parseDateValue(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function parsePassingMarks(rawPassingMarks: unknown, totalMarks: number): number | null {
  if (rawPassingMarks === undefined || rawPassingMarks === null || String(rawPassingMarks).trim() === '') {
    return null;
  }
  const parsed = Number.parseInt(String(rawPassingMarks), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(parsed, 0), Math.max(totalMarks, 0));
}

function parseMaxViolations(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? '3'), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_TEST_VIOLATIONS) {
    throw new Error(`Max violations must be between 1 and ${MAX_TEST_VIOLATIONS}`);
  }
  return parsed;
}

function mapTestWithCustomAI<T extends { customAIViolations?: string | null }>(test: T): Omit<T, 'customAIViolations'> & { customAIViolations: string[] } {
  return {
    ...test,
    customAIViolations: parseStoredCustomAIViolationEvents(test.customAIViolations ?? null),
  };
}

// MCQ/coding/behavioral questions store `tags` (and MCQ `options`) as
// JSON-encoded string columns. Every other controller (mcqQuestion.ts,
// codingQuestion.ts, candidate.ts) parses them before sending to the
// frontend, which expects `tags: string[]` / `options: string[]` — do the
// same here for questions embedded inside a test, otherwise the frontend
// crashes calling array methods on a raw string (or, for `options.length`,
// silently reports the JSON string's character count instead of the
// option count).
function parseJsonArrayField(value: unknown): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

interface QuestionWithTags { tags?: unknown; options?: unknown; [key: string]: unknown }
interface TestQuestionLike {
  mcqQuestion?: QuestionWithTags | null;
  codingQuestion?: QuestionWithTags | null;
  behavioralQuestion?: QuestionWithTags | null;
  communicationQuestion?: QuestionWithTags | null;
  [key: string]: unknown;
}

function withParsedQuestionTags<T extends TestQuestionLike>(testQuestion: T): T {
  return {
    ...testQuestion,
    mcqQuestion: testQuestion.mcqQuestion
      ? { ...testQuestion.mcqQuestion, tags: parseJsonArrayField(testQuestion.mcqQuestion.tags), options: parseJsonArrayField(testQuestion.mcqQuestion.options) }
      : testQuestion.mcqQuestion,
    codingQuestion: testQuestion.codingQuestion ? { ...testQuestion.codingQuestion, tags: parseJsonArrayField(testQuestion.codingQuestion.tags) } : testQuestion.codingQuestion,
    behavioralQuestion: testQuestion.behavioralQuestion ? { ...testQuestion.behavioralQuestion, tags: parseJsonArrayField(testQuestion.behavioralQuestion.tags) } : testQuestion.behavioralQuestion,
    communicationQuestion: testQuestion.communicationQuestion
      ? { ...testQuestion.communicationQuestion, tags: parseJsonArrayField(testQuestion.communicationQuestion.tags), options: parseJsonArrayField(testQuestion.communicationQuestion.options) }
      : testQuestion.communicationQuestion,
  };
}

export async function createTest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const {
      name,
      description,
      instructions,
      duration,
      startTime,
      endTime,
      totalMarks,
      passingMarks,
      negativeMarking,
      shuffleQuestions,
      shuffleOptions,
      allowMultipleAttempts,
      maxViolations,
      proctorEnabled,
      requireCamera,
      requireMicrophone,
      requireScreenShare,
      requireIdVerification,
      customAIViolations,
    } = req.body;

    const parsedStartTime = parseDateValue(startTime);
    const parsedEndTime = parseDateValue(endTime);
    const requestedDuration = Number.parseInt(String(duration), 10);

    if (!parsedStartTime) {
      res.status(400).json({ error: 'Valid start time is required' });
      return;
    }

    if (!Number.isFinite(requestedDuration) || requestedDuration < 1) {
      res.status(400).json({ error: 'Duration must be a positive integer (minutes)' });
      return;
    }

    if (endTime !== undefined && endTime !== null && endTime !== '' && !parsedEndTime) {
      res.status(400).json({ error: 'End time must be valid ISO8601' });
      return;
    }

    if (parsedEndTime && parsedEndTime <= parsedStartTime) {
      res.status(400).json({ error: 'End time must be after start time' });
      return;
    }

    let requestedMaxViolations: number;
    try {
      requestedMaxViolations = parseMaxViolations(maxViolations);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid max violations' });
      return;
    }

    const enabledAIViolations =
      customAIViolations === undefined
        ? [...DEFAULT_CUSTOM_AI_VIOLATION_EVENTS]
        : normalizeCustomAIViolationEvents(customAIViolations);

    const adminRecord = await prisma.admin.findUnique({
      where: { id: req.admin!.id },
      select: {
        id: true,
        email: true,
        name: true,
        companyId: true
      }
    });

    if (!adminRecord) {
      res.status(404).json({ error: 'Admin not found' });
      return;
    }

    const testCode = generateTestCode();

    const test = await prisma.test.create({
      data: {
        testCode,
        name: sanitizeInput(name),
        description: description ? sanitizeInput(description) : null,
        instructions: instructions ? sanitizeInput(instructions) : null,
        duration: requestedDuration,
        startTime: parsedStartTime,
        endTime: parsedEndTime,
        totalMarks: parseInt(totalMarks),
        passingMarks: parsePassingMarks(passingMarks, parseInt(totalMarks)),
        negativeMarking: negativeMarking ? parseFloat(negativeMarking) : 0,
        shuffleQuestions: shuffleQuestions || false,
        shuffleOptions: shuffleOptions || false,
        allowMultipleAttempts: allowMultipleAttempts || false,
        maxViolations: requestedMaxViolations,
        proctorEnabled: proctorEnabled || false,
        requireCamera: requireCamera || false,
        requireMicrophone: requireMicrophone || false,
        requireScreenShare: requireScreenShare || false,
        requireIdVerification: requireIdVerification || false,
        customAIViolations: JSON.stringify(enabledAIViolations),
        assessmentMode: req.body.assessmentMode === 'NORMAL_BROWSER' ? 'NORMAL_BROWSER' : 'SEB',
        adminId: req.admin!.id,
        ...(adminRecord.companyId ? { companyId: adminRecord.companyId } : {})
      }
    });

    const testPreferences = collectTestPreferences(req.body as Record<string, unknown>);
    if (Object.keys(testPreferences).length > 0) {
      try {
        await prisma.$executeRaw`
          UPDATE "Test"
          SET "proctoringSettings" = ${JSON.stringify(testPreferences)}
          WHERE id = ${test.id}
        `;
      } catch {
        // Optional JSON settings columns may not exist in older local databases.
      }
    }

    res.status(201).json({
      message: 'Test created successfully',
      test: {
        ...mapTestWithCustomAI(test),
        testCode
      }
    });
  } catch (error) {
    console.error('Create test error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getTests(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const skip = (page - 1) * limit;
    const where = {
      ...testListWhere(req),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { description: { contains: search, mode: 'insensitive' as const } },
              { testCode: { contains: search, mode: 'insensitive' as const } }
            ]
          }
        : {})
    };

    const [tests, total] = await Promise.all([
      prisma.test.findMany({
        where,
        include: {
          _count: {
            select: {
              questions: true,
              attempts: true
            }
          },
          admin: {
            select: { name: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.test.count({ where })
    ]);

    res.json({
      tests: tests.map(({ admin, ...test }) => ({
        ...mapTestWithCustomAI(test),
        createdByName: admin?.name ?? null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get tests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getTestById(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId } = req.params;

    const test = await prisma.test.findFirst({
      where: {
        ...testOwnershipWhere(req, testId)
      },
      include: {
        questions: {
          include: {
            mcqQuestion: true,
            codingQuestion: {
              include: {
                testCases: true
              }
            },
            behavioralQuestion: true,
            communicationQuestion: true
          },
          orderBy: { orderIndex: 'asc' }
        },
        sections: {
          include: {
            questions: {
              include: {
                mcqQuestion: true,
                codingQuestion: {
                  include: {
                    testCases: true
                  }
                },
                behavioralQuestion: true,
                communicationQuestion: true
              },
              orderBy: { orderIndex: 'asc' }
            }
          },
          orderBy: { orderIndex: 'asc' }
        },
        _count: {
          select: { attempts: true }
        }
      }
    });

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    // Also fetch the raw JSON columns not yet in the generated Prisma client
    let proctoringSettingsRaw: string | null = null;
    let violationPopupSettingsRaw: string | null = null;
    try {
      const rows = await prisma.$queryRaw<Array<{ proctoringSettings: string | null; violationPopupSettings: string | null }>>`
        SELECT "proctoringSettings", "violationPopupSettings" FROM "Test" WHERE id = ${testId}
      `;
      if (rows.length > 0) {
        proctoringSettingsRaw = rows[0].proctoringSettings;
        violationPopupSettingsRaw = rows[0].violationPopupSettings;
      }
    } catch { /* columns not yet added — safe to ignore */ }

    res.json({
      test: {
        ...mapTestWithCustomAI(test),
        questions: test.questions.map(withParsedQuestionTags),
        sections: test.sections.map(section => ({
          ...section,
          questions: section.questions.map(withParsedQuestionTags),
        })),
        proctoringSettings: proctoringSettingsRaw ? JSON.parse(proctoringSettingsRaw) : undefined,
        violationPopupSettings: violationPopupSettingsRaw ? JSON.parse(violationPopupSettingsRaw) : undefined,
      },
    });
  } catch (error) {
    console.error('Get test error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createTestSection(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId } = req.params;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const rawOrderIndex = req.body.orderIndex;

    if (!name) {
      res.status(400).json({ error: 'Section name is required.' });
      return;
    }

    const test = await prisma.test.findFirst({
      where: {
        ...testOwnershipWhere(req, testId)
      }
    });

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    let orderIndex: number;
    if (rawOrderIndex === undefined) {
      const maxOrder = await prisma.testSection.findFirst({
        where: { testId },
        orderBy: { orderIndex: 'desc' }
      });
      orderIndex = (maxOrder?.orderIndex ?? -1) + 1;
    } else {
      const parsedOrder = Number.parseInt(String(rawOrderIndex), 10);
      if (!Number.isFinite(parsedOrder) || parsedOrder < 0) {
        res.status(400).json({ error: 'orderIndex must be a non-negative integer.' });
        return;
      }
      orderIndex = parsedOrder;
    }

    let questionsPerCandidate = 1;
    if (req.body.questionsPerCandidate !== undefined) {
      const parsedPickCount = Number.parseInt(String(req.body.questionsPerCandidate), 10);
      if (!Number.isFinite(parsedPickCount) || parsedPickCount !== 1) {
        res.status(400).json({ error: 'Each section must pick exactly 1 question per candidate.' });
        return;
      }
      questionsPerCandidate = parsedPickCount;
    }

    const section = await prisma.testSection.create({
      data: {
        testId,
        name: sanitizeInput(name),
        orderIndex,
        questionsPerCandidate
      }
    });

    res.status(201).json({
      message: 'Section created successfully',
      section
    });
  } catch (error) {
    console.error('Create test section error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteTestSection(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId, sectionId } = req.params;

    const test = await prisma.test.findFirst({
      where: {
        ...testOwnershipWhere(req, testId)
      }
    });

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const section = await prisma.testSection.findFirst({
      where: {
        id: sectionId,
        testId
      }
    });

    if (!section) {
      res.status(404).json({ error: 'Section not found' });
      return;
    }

    await prisma.testSection.delete({
      where: { id: sectionId }
    });

    res.json({ message: 'Section deleted successfully' });
  } catch (error) {
    console.error('Delete test section error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateTest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId } = req.params;
    const updates = req.body;

    const test = await prisma.test.findFirst({
      where: {
        ...testOwnershipWhere(req, testId)
      }
    });

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const sanitizedUpdates: Record<string, unknown> = {};
    const hasStartTimeUpdate = updates.startTime !== undefined;
    const hasEndTimeUpdate = updates.endTime !== undefined;
    const hasDurationUpdate = updates.duration !== undefined;

    if (updates.name) sanitizedUpdates.name = sanitizeInput(updates.name);
    if (updates.description !== undefined) sanitizedUpdates.description = updates.description ? sanitizeInput(updates.description) : null;
    if (updates.instructions !== undefined) sanitizedUpdates.instructions = updates.instructions ? sanitizeInput(updates.instructions) : null;
    if (hasDurationUpdate) {
      const parsedDuration = Number.parseInt(String(updates.duration), 10);
      if (!Number.isFinite(parsedDuration) || parsedDuration < 1) {
        res.status(400).json({ error: 'Duration must be a positive integer (minutes)' });
        return;
      }
      sanitizedUpdates.duration = parsedDuration;
    }

    let resolvedStartTime = test.startTime;
    if (hasStartTimeUpdate) {
      const parsedStartTime = parseDateValue(updates.startTime);
      if (!parsedStartTime) {
        res.status(400).json({ error: 'Valid start time is required' });
        return;
      }
      resolvedStartTime = parsedStartTime;
      sanitizedUpdates.startTime = parsedStartTime;
    }

    let resolvedEndTime = test.endTime;
    if (hasEndTimeUpdate) {
      if (updates.endTime === null || updates.endTime === '') {
        resolvedEndTime = null;
        sanitizedUpdates.endTime = null;
      } else {
        const parsedEndTime = parseDateValue(updates.endTime);
        if (!parsedEndTime) {
          res.status(400).json({ error: 'End time must be valid ISO8601' });
          return;
        }
        resolvedEndTime = parsedEndTime;
        sanitizedUpdates.endTime = parsedEndTime;
      }
    }

    if (resolvedEndTime && resolvedEndTime <= resolvedStartTime) {
      res.status(400).json({ error: 'End time must be after start time' });
      return;
    }

    if (updates.customAIViolations !== undefined) {
      const parsedCustomAIViolations = normalizeCustomAIViolationEvents(updates.customAIViolations);
      sanitizedUpdates.customAIViolations = JSON.stringify(parsedCustomAIViolations);
    }
    if (updates.assessmentMode !== undefined) {
      sanitizedUpdates.assessmentMode = updates.assessmentMode === 'NORMAL_BROWSER'
        ? 'NORMAL_BROWSER'
        : 'SEB';
    }

    if (updates.totalMarks) sanitizedUpdates.totalMarks = parseInt(updates.totalMarks);
    if (updates.passingMarks !== undefined) {
      const effectiveTotalMarks = typeof sanitizedUpdates.totalMarks === 'number'
        ? sanitizedUpdates.totalMarks
        : test.totalMarks;
      sanitizedUpdates.passingMarks = parsePassingMarks(updates.passingMarks, effectiveTotalMarks);
    }
    if (updates.negativeMarking !== undefined) sanitizedUpdates.negativeMarking = parseFloat(updates.negativeMarking) || 0;
    if (updates.isActive !== undefined) sanitizedUpdates.isActive = updates.isActive;
    if (updates.shuffleQuestions !== undefined) sanitizedUpdates.shuffleQuestions = updates.shuffleQuestions;
    if (updates.shuffleOptions !== undefined) sanitizedUpdates.shuffleOptions = updates.shuffleOptions;
    if (updates.allowMultipleAttempts !== undefined) sanitizedUpdates.allowMultipleAttempts = updates.allowMultipleAttempts;
    if (updates.maxViolations !== undefined) {
      try {
        sanitizedUpdates.maxViolations = parseMaxViolations(updates.maxViolations);
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid max violations' });
        return;
      }
    }
    if (updates.proctorEnabled !== undefined) sanitizedUpdates.proctorEnabled = updates.proctorEnabled;
    if (updates.requireCamera !== undefined) sanitizedUpdates.requireCamera = updates.requireCamera;
    if (updates.requireMicrophone !== undefined) sanitizedUpdates.requireMicrophone = updates.requireMicrophone;
    if (updates.requireScreenShare !== undefined) sanitizedUpdates.requireScreenShare = updates.requireScreenShare;
    if (updates.requireIdVerification !== undefined) sanitizedUpdates.requireIdVerification = updates.requireIdVerification;
    if (updates.autoApproveId !== undefined) sanitizedUpdates.autoApproveId = updates.autoApproveId;
    if (updates.idVerificationAutoApproveThreshold !== undefined) {
      const parsedThreshold = Number(updates.idVerificationAutoApproveThreshold);
      sanitizedUpdates.idVerificationAutoApproveThreshold = Number.isFinite(parsedThreshold)
        ? Math.min(100, Math.max(0, parsedThreshold))
        : null;
    }

    // When proctoringSettings is sent (from the AI Proctoring tab), extract the
    // device-require flags so they're reflected on the candidate instructions page.
    if (updates.proctoringSettings && typeof updates.proctoringSettings === 'object') {
      const ps = updates.proctoringSettings as Record<string, unknown>;
      if (typeof ps.webcamOn === 'boolean') sanitizedUpdates.requireCamera = ps.webcamOn;
      if (typeof ps.micOn === 'boolean') sanitizedUpdates.requireMicrophone = ps.micOn;
      if (typeof ps.screenOn === 'boolean') sanitizedUpdates.requireScreenShare = ps.screenOn;
    }

    // If the master proctoring switch is explicitly turned OFF, clear all device requirements
    // so the candidate instructions page correctly shows "Not required".
    if (updates.proctorEnabled === false) {
      sanitizedUpdates.requireCamera = false;
      sanitizedUpdates.requireMicrophone = false;
      sanitizedUpdates.requireScreenShare = false;
    }

    const updatedTest = await prisma.test.update({
      where: { id: testId },
      data: sanitizedUpdates
    });

    // Persist proctoringSettings and violationPopupSettings via raw SQL
    // (these columns are not in the generated Prisma schema yet)
    try {
      const rawPreferenceUpdates = collectTestPreferences(updates as Record<string, unknown>);
      const incomingProctoringSettings = isRecord(updates.proctoringSettings)
        ? updates.proctoringSettings as Record<string, unknown>
        : null;
      let psJson: string | null = null;

      if (incomingProctoringSettings || Object.keys(rawPreferenceUpdates).length > 0) {
        let existingSettings: Record<string, unknown> = {};
        try {
          const rows = await prisma.$queryRaw<Array<{ proctoringSettings: string | null }>>`
            SELECT "proctoringSettings" FROM "Test" WHERE id = ${testId}
          `;
          existingSettings = parseRawJsonObject(rows[0]?.proctoringSettings ?? null);
        } catch {
          existingSettings = {};
        }

        psJson = JSON.stringify({
          ...existingSettings,
          ...(incomingProctoringSettings ?? {}),
          ...rawPreferenceUpdates,
        });
      }

      const vpJson = updates.violationPopupSettings !== undefined
        ? JSON.stringify(updates.violationPopupSettings)
        : null;
      if (psJson !== null || vpJson !== null) {
        if (psJson !== null && vpJson !== null) {
          await prisma.$executeRaw`
            UPDATE "Test"
            SET "proctoringSettings" = ${psJson}, "violationPopupSettings" = ${vpJson}
            WHERE id = ${testId}
          `;
        } else if (psJson !== null) {
          await prisma.$executeRaw`UPDATE "Test" SET "proctoringSettings" = ${psJson} WHERE id = ${testId}`;
        } else if (vpJson !== null) {
          await prisma.$executeRaw`UPDATE "Test" SET "violationPopupSettings" = ${vpJson} WHERE id = ${testId}`;
        }
      }
    } catch {
      // columns not yet created — safe to ignore (settings still work via requireCamera etc.)
    }

    // Re-fetch with the raw JSON columns included in the response
    let proctoringSettingsRaw: string | null = null;
    let violationPopupSettingsRaw: string | null = null;
    try {
      const rows = await prisma.$queryRaw<Array<{ proctoringSettings: string | null; violationPopupSettings: string | null }>>`
        SELECT "proctoringSettings", "violationPopupSettings" FROM "Test" WHERE id = ${testId}
      `;
      if (rows.length > 0) {
        proctoringSettingsRaw = rows[0].proctoringSettings;
        violationPopupSettingsRaw = rows[0].violationPopupSettings;
      }
    } catch { /* ignore */ }

    res.json({
      message: 'Test updated successfully',
      test: {
        ...mapTestWithCustomAI(updatedTest),
        proctoringSettings: proctoringSettingsRaw ? JSON.parse(proctoringSettingsRaw) : undefined,
        violationPopupSettings: violationPopupSettingsRaw ? JSON.parse(violationPopupSettingsRaw) : undefined,
      },
    });
  } catch (error) {
    console.error('Update test error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Deletes a Test and everything under it. Extracted from the single-test
// delete flow so the same, already-battle-tested cascade order can also be
// used by the Superadmin Observer's admin-account deletion (which needs to
// wipe every test an admin owns, not just one) — see
// superAdminAccounts.ts::deleteAdminAccount. Must be called inside an
// existing transaction (`tx`), since required FKs on Test/MCQQuestion/etc.
// default to Restrict, not Cascade, and Postgres enforces child-before-
// parent deletion order.
export async function cascadeDeleteTestTx(tx: Prisma.TransactionClient, testId: string): Promise<void> {
  const attempts = await tx.testAttempt.findMany({ where: { testId }, select: { id: true } });
  const attemptIds = attempts.map((a) => a.id);

  if (attemptIds.length > 0) {
    await tx.performanceAnalytics.deleteMany({ where: { attemptId: { in: attemptIds } } });
    await tx.proctorEvent.deleteMany({ where: { session: { attemptId: { in: attemptIds } } } });
    await tx.proctorRecording.deleteMany({ where: { session: { attemptId: { in: attemptIds } } } });
    await tx.faceSnapshot.deleteMany({ where: { session: { attemptId: { in: attemptIds } } } });
    await tx.proctorSession.deleteMany({ where: { attemptId: { in: attemptIds } } });
    await tx.mCQAnswer.deleteMany({ where: { attemptId: { in: attemptIds } } });
    await tx.codingAnswer.deleteMany({ where: { attemptId: { in: attemptIds } } });
    await tx.activityLog.deleteMany({ where: { attemptId: { in: attemptIds } } });
    await tx.testAttempt.deleteMany({ where: { testId } });
  }

  await tx.testAnalytics.deleteMany({ where: { testId } });
  await tx.testQuestion.deleteMany({ where: { testId } });
  await tx.test.delete({ where: { id: testId } });
}

export async function deleteTest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId } = req.params;

    const test = await prisma.test.findFirst({
      where: {
        ...testOwnershipWhere(req, testId)
      },
      include: {
        attempts: true
      }
    });

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await cascadeDeleteTestTx(tx, testId);
    });

    res.json({ message: 'Test deleted successfully' });
  } catch (error) {
    console.error('Delete test error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createAdminPreviewAttempt(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const { testId } = req.params;
    const adminId = req.admin!.id;
    const adminEmail = req.admin!.email;

    const test = await prisma.test.findFirst({
      where: {
        id: testId,
        adminId,
      },
      select: {
        id: true,
        name: true,
        requireIdVerification: true,
      },
    });

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const previewEmail = `preview+${adminId.slice(0, 8)}+${testId.slice(0, 8)}@regen.local`;
    const previewNameBase = adminEmail.split('@')[0] || 'Admin';
    const previewName = `${previewNameBase} (Preview)`;

    const candidate = await prisma.candidate.upsert({
      where: { email: previewEmail },
      create: {
        email: previewEmail,
        name: previewName,
      },
      update: {
        name: previewName,
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    const attempt = await prisma.$transaction(async (tx) => {
      // Preview attempts are throwaway (not a real candidate), so we keep the
      // delete-and-recreate behavior rather than accumulating attempt history.
      await tx.testAttempt.deleteMany({
        where: { testId, candidateId: candidate.id },
      });

      const createdAttempt = await tx.testAttempt.create({
        data: {
          testId,
          candidateId: candidate.id,
          status: 'in_progress',
          startTime: new Date(),
          endTime: null,
          submittedAt: null,
          score: null,
          violations: 0,
          isFlagged: false,
          flagReason: null,
        },
        select: {
          id: true,
        },
      });

      if (test.requireIdVerification) {
        await tx.candidateIdentity.upsert({
          where: { candidateId: candidate.id },
          create: {
            candidateId: candidate.id,
            verificationStatus: 'verified',
            verifiedAt: new Date(),
            verifiedBy: 'admin_preview',
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          },
          update: {
            verificationStatus: 'verified',
            verifiedAt: new Date(),
            verifiedBy: 'admin_preview',
            rejectionReason: null,
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          },
        });
      }

      return createdAttempt;
    });

    const token = generateCandidateToken({
      id: candidate.id,
      email: candidate.email,
      testId,
      attemptId: attempt.id,
      role: 'candidate',
    });

    res.json({
      message: 'Preview session ready',
      token,
      candidate,
      attempt: {
        id: attempt.id,
      },
      test: {
        id: test.id,
        name: test.name,
      },
    });
  } catch (error) {
    console.error('Create admin preview attempt error:', error);
    res.status(500).json({ error: 'Failed to create preview session' });
  }
}

export async function addQuestionToTest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId } = req.params;
    const { questionId, orderIndex } = req.body;
    const sectionId = typeof req.body.sectionId === 'string' ? req.body.sectionId : undefined;
    const questionType = typeof req.body.questionType === 'string'
      ? req.body.questionType.toLowerCase()
      : '';

    const test = await prisma.test.findFirst({
      where: {
        ...testOwnershipWhere(req, testId)
      }
    });

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    if (sectionId) {
      const section = await prisma.testSection.findFirst({
        where: {
          id: sectionId,
          testId
        }
      });

      if (!section) {
        res.status(404).json({ error: 'Section not found for this test' });
        return;
      }
    }

    // Validate question exists
    if (questionType === 'mcq') {
      const mcq = await prisma.mCQQuestion.findFirst({
        where: {
          id: questionId,
          OR: [{ adminId: req.admin!.id }, { adminId: null }]
        }
      });
      if (!mcq) {
        res.status(404).json({ error: 'MCQ question not found' });
        return;
      }
    } else if (questionType === 'coding') {
      const coding = await prisma.codingQuestion.findFirst({
        where: {
          id: questionId,
          OR: [{ adminId: req.admin!.id }, { adminId: null }]
        }
      });
      if (!coding) {
        res.status(404).json({ error: 'Coding question not found' });
        return;
      }
    } else if (questionType === 'behavioral') {
      const behavioral = await prisma.behavioralQuestion.findFirst({
        where: {
          id: questionId,
          OR: [{ adminId: req.admin!.id }, { adminId: null }]
        }
      });
      if (!behavioral) {
        res.status(404).json({ error: 'Behavioral question not found' });
        return;
      }
    } else if (questionType === 'communication') {
      const communication = await prisma.communicationQuestion.findFirst({
        where: {
          id: questionId,
          OR: [{ adminId: req.admin!.id }, { adminId: null }]
        }
      });
      if (!communication) {
        res.status(404).json({ error: 'Communication question not found' });
        return;
      }
    } else {
      res.status(400).json({ error: 'Invalid question type' });
      return;
    }

    const existingQuestion = await prisma.testQuestion.findFirst({
      where: {
        testId,
        ...(questionType === 'mcq'
          ? { mcqQuestionId: questionId }
          : questionType === 'coding'
            ? { codingQuestionId: questionId }
            : questionType === 'behavioral'
              ? { behavioralQuestionId: questionId }
              : { communicationQuestionId: questionId })
      },
      include: {
        mcqQuestion: true,
        codingQuestion: true,
        behavioralQuestion: true,
        communicationQuestion: true
      }
    });

    if (existingQuestion) {
      res.status(200).json({
        message: 'Question already exists in test',
        testQuestion: existingQuestion,
        alreadyAdded: true
      });
      return;
    }

    // Get max order index if not provided
    let order: number;
    if (orderIndex === undefined) {
      const maxOrder = await prisma.testQuestion.findFirst({
        where: { testId },
        orderBy: { orderIndex: 'desc' }
      });
      order = (maxOrder?.orderIndex ?? -1) + 1;
    } else {
      const parsedOrder = Number.parseInt(String(orderIndex), 10);
      if (!Number.isFinite(parsedOrder) || parsedOrder < 0) {
        res.status(400).json({ error: 'orderIndex must be a non-negative integer.' });
        return;
      }
      order = parsedOrder;
    }

    const testQuestion = await prisma.testQuestion.create({
      data: {
        testId,
        questionType,
        mcqQuestionId: questionType === 'mcq' ? questionId : null,
        codingQuestionId: questionType === 'coding' ? questionId : null,
        behavioralQuestionId: questionType === 'behavioral' ? questionId : null,
        communicationQuestionId: questionType === 'communication' ? questionId : null,
        orderIndex: order,
        sectionId: sectionId ?? null
      },
      include: {
        mcqQuestion: true,
        codingQuestion: true,
        behavioralQuestion: true,
        communicationQuestion: true
      }
    });

    res.status(201).json({
      message: 'Question added to test',
      testQuestion
    });
  } catch (error) {
    console.error('Add question to test error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function addCustomQuestionToTest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId } = req.params;
    const questionType = typeof req.body.questionType === 'string'
      ? req.body.questionType.toLowerCase()
      : '';
    const { orderIndex } = req.body;
    const sectionId = typeof req.body.sectionId === 'string' ? req.body.sectionId : undefined;

    const test = await prisma.test.findFirst({
      where: {
        ...testOwnershipWhere(req, testId)
      }
    });

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    if (sectionId) {
      const section = await prisma.testSection.findFirst({
        where: {
          id: sectionId,
          testId
        }
      });

      if (!section) {
        res.status(404).json({ error: 'Section not found for this test' });
        return;
      }
    }

    let resolvedOrder: number;
    if (orderIndex === undefined) {
      const maxOrder = await prisma.testQuestion.findFirst({
        where: { testId },
        orderBy: { orderIndex: 'desc' }
      });
      resolvedOrder = (maxOrder?.orderIndex ?? -1) + 1;
    } else {
      const parsedOrder = Number.parseInt(String(orderIndex), 10);
      if (!Number.isFinite(parsedOrder) || parsedOrder < 0) {
        res.status(400).json({ error: 'orderIndex must be a non-negative integer.' });
        return;
      }
      resolvedOrder = parsedOrder;
    }

    if (questionType === 'mcq') {
      const questionText = typeof req.body.questionText === 'string' ? req.body.questionText.trim() : '';
      const options = Array.isArray(req.body.options)
        ? req.body.options.filter((option: unknown): option is string => typeof option === 'string')
        : [];
      const correctAnswers = Array.isArray(req.body.correctAnswers)
        ? req.body.correctAnswers.map((idx: unknown) => Number.parseInt(String(idx), 10))
        : [];
      const marks = Number.parseInt(String(req.body.marks), 10);
      const difficulty = typeof req.body.difficulty === 'string' ? req.body.difficulty : 'medium';

      if (!questionText) {
        res.status(400).json({ error: 'Question text is required.' });
        return;
      }

      if (options.length < 2 || options.length > 6) {
        res.status(400).json({ error: 'MCQ options must contain between 2 and 6 items.' });
        return;
      }

      const normalizedOptions = options.map((option: string) => sanitizeInput(option).trim());
      if (normalizedOptions.some((option: string) => option.length === 0)) {
        res.status(400).json({ error: 'Each option must be non-empty.' });
        return;
      }

      if (!Number.isFinite(marks) || marks < 1) {
        res.status(400).json({ error: 'Marks must be a positive integer.' });
        return;
      }

      if (!['easy', 'medium', 'hard'].includes(difficulty)) {
        res.status(400).json({ error: 'Invalid difficulty. Use easy, medium, or hard.' });
        return;
      }

      if (correctAnswers.length < 1 || correctAnswers.some((idx: number) => !Number.isInteger(idx) || idx < 0 || idx >= normalizedOptions.length)) {
        res.status(400).json({ error: 'At least one valid correct answer index is required.' });
        return;
      }

      const uniqueOptions = new Set(normalizedOptions.map((option: string) => option.toLowerCase()));
      if (uniqueOptions.size !== normalizedOptions.length) {
        res.status(400).json({ error: 'MCQ options must be unique.' });
        return;
      }

      const isMultipleChoice =
        typeof req.body.isMultipleChoice === 'boolean'
          ? req.body.isMultipleChoice
          : correctAnswers.length > 1;

      const [question, testQuestion] = await prisma.$transaction(async (tx) => {
        const createdQuestion = await tx.mCQQuestion.create({
          data: {
            questionText: sanitizeInput(questionText),
            options: JSON.stringify(normalizedOptions),
            correctAnswers: JSON.stringify(correctAnswers),
            marks,
            isMultipleChoice,
            explanation: toOptionalSanitizedString(req.body.explanation),
            difficulty,
            topic: toOptionalSanitizedString(req.body.topic),
            tags: toTestScopedTagJson(testId, req.body.tags),
            source: QuestionSource.CUSTOM,
            repositoryCategory: QuestionRepositoryCategory.MCQ,
            isEnabled: true,
            adminId: req.admin!.id
          }
        });

        const createdTestQuestion = await tx.testQuestion.create({
          data: {
            testId,
            questionType: 'mcq',
            mcqQuestionId: createdQuestion.id,
            orderIndex: resolvedOrder,
            sectionId: sectionId ?? null
          },
          include: {
            mcqQuestion: true,
            codingQuestion: true,
            behavioralQuestion: true
          }
        });

        return [createdQuestion, createdTestQuestion];
      });

      res.status(201).json({
        message: 'Custom MCQ question created and added to test.',
        testQuestion,
        question: {
          ...question,
          options: JSON.parse(question.options),
          correctAnswers: JSON.parse(question.correctAnswers)
        }
      });
      return;
    }

    if (questionType === 'coding') {
      const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
      const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
      const inputFormat = typeof req.body.inputFormat === 'string' ? req.body.inputFormat.trim() : '';
      const outputFormat = typeof req.body.outputFormat === 'string' ? req.body.outputFormat.trim() : '';
      const sampleInput = typeof req.body.sampleInput === 'string' ? req.body.sampleInput : '';
      const sampleOutput = typeof req.body.sampleOutput === 'string' ? req.body.sampleOutput : '';
      const marks = Number.parseInt(String(req.body.marks), 10);
      const timeLimit = Number.parseInt(String(req.body.timeLimit ?? '2000'), 10);
      const memoryLimit = Number.parseInt(String(req.body.memoryLimit ?? '256'), 10);
      const supportedLanguages = Array.isArray(req.body.supportedLanguages)
        ? req.body.supportedLanguages.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
      const difficulty = typeof req.body.difficulty === 'string' ? req.body.difficulty : 'medium';

      const rawTestCases = Array.isArray(req.body.testCases) ? req.body.testCases : [];
      const testCases = rawTestCases
        .map((tc: unknown) => {
          const value = tc as {
            input?: unknown;
            expectedOutput?: unknown;
            isHidden?: unknown;
            marks?: unknown;
          };
          return {
            input: typeof value.input === 'string' ? value.input : '',
            expectedOutput: typeof value.expectedOutput === 'string' ? value.expectedOutput : '',
            isHidden: Boolean(value.isHidden),
            marks: Number.parseInt(String(value.marks ?? '0'), 10) || 0
          };
        })
        .filter((tc: { input: string; expectedOutput: string }) => tc.input.length > 0 && tc.expectedOutput.length > 0);

      if (!title || !description || !inputFormat || !outputFormat) {
        res.status(400).json({ error: 'Title, description, input format, and output format are required.' });
        return;
      }

      if (!Number.isFinite(marks) || marks < 1) {
        res.status(400).json({ error: 'Marks must be a positive integer.' });
        return;
      }

      if (!Number.isFinite(timeLimit) || timeLimit < 1) {
        res.status(400).json({ error: 'timeLimit must be a positive integer.' });
        return;
      }

      if (!Number.isFinite(memoryLimit) || memoryLimit < 1) {
        res.status(400).json({ error: 'memoryLimit must be a positive integer.' });
        return;
      }

      if (supportedLanguages.length < 1) {
        res.status(400).json({ error: 'At least one supported language is required.' });
        return;
      }

      if (testCases.length < 1) {
        res.status(400).json({ error: 'At least one valid test case is required.' });
        return;
      }

      if (!['easy', 'medium', 'hard'].includes(difficulty)) {
        res.status(400).json({ error: 'Invalid difficulty. Use easy, medium, or hard.' });
        return;
      }

      const codeTemplates =
        typeof req.body.codeTemplates === 'object' &&
        req.body.codeTemplates !== null &&
        !Array.isArray(req.body.codeTemplates)
          ? req.body.codeTemplates as Record<string, string>
          : null;

      const partialScoring = Boolean(req.body.partialScoring);
      const autoEvaluate = req.body.autoEvaluate === undefined ? true : Boolean(req.body.autoEvaluate);

      const [question, testQuestion] = await prisma.$transaction(async (tx) => {
        const createdQuestion = await tx.codingQuestion.create({
          data: {
            title: sanitizeInput(title),
            description: sanitizeInput(description),
            inputFormat: sanitizeInput(inputFormat),
            outputFormat: sanitizeInput(outputFormat),
            constraints: toOptionalSanitizedString(req.body.constraints),
            sampleInput,
            sampleOutput,
            marks,
            timeLimit,
            memoryLimit,
            supportedLanguages: JSON.stringify(supportedLanguages),
            codeTemplates: codeTemplates ? JSON.stringify(codeTemplates) : null,
            partialScoring,
            difficulty,
            topic: toOptionalSanitizedString(req.body.topic),
            tags: toTestScopedTagJson(testId, req.body.tags),
            autoEvaluate,
            source: QuestionSource.CUSTOM,
            repositoryCategory: QuestionRepositoryCategory.CODING,
            isEnabled: true,
            adminId: req.admin!.id,
            testCases: {
              create: testCases.map((tc: { input: string; expectedOutput: string; isHidden: boolean; marks: number }) => ({
                input: tc.input,
                expectedOutput: tc.expectedOutput,
                isHidden: tc.isHidden,
                marks: tc.marks
              }))
            }
          }
        });

        const createdTestQuestion = await tx.testQuestion.create({
          data: {
            testId,
            questionType: 'coding',
            codingQuestionId: createdQuestion.id,
            orderIndex: resolvedOrder,
            sectionId: sectionId ?? null
          },
          include: {
            mcqQuestion: true,
            codingQuestion: true,
            behavioralQuestion: true
          }
        });

        return [createdQuestion, createdTestQuestion];
      });

      res.status(201).json({
        message: 'Custom coding question created and added to test.',
        testQuestion,
        question: {
          ...question,
          supportedLanguages: JSON.parse(question.supportedLanguages),
          codeTemplates: question.codeTemplates ? JSON.parse(question.codeTemplates) : null
        }
      });
      return;
    }

    if (questionType === 'behavioral') {
      const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
      const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
      const marks = Number.parseInt(String(req.body.marks), 10);
      const difficulty = typeof req.body.difficulty === 'string' ? req.body.difficulty : 'medium';

      if (!title) {
        res.status(400).json({ error: 'Title is required.' });
        return;
      }

      if (!description) {
        res.status(400).json({ error: 'Description is required.' });
        return;
      }

      if (!Number.isFinite(marks) || marks < 1) {
        res.status(400).json({ error: 'Marks must be a positive integer.' });
        return;
      }

      if (!['easy', 'medium', 'hard'].includes(difficulty)) {
        res.status(400).json({ error: 'Invalid difficulty. Use easy, medium, or hard.' });
        return;
      }

      const [question, testQuestion] = await prisma.$transaction(async (tx) => {
        const createdQuestion = await tx.behavioralQuestion.create({
          data: {
            title: sanitizeInput(title),
            description: sanitizeInput(description),
            expectedAnswer: toOptionalSanitizedString(req.body.expectedAnswer),
            marks,
            difficulty,
            topic: toOptionalSanitizedString(req.body.topic),
            tags: toTestScopedTagJson(testId, req.body.tags),
            source: QuestionSource.CUSTOM,
            repositoryCategory: QuestionRepositoryCategory.BEHAVIORAL,
            isEnabled: true,
            adminId: req.admin!.id
          }
        });

        const createdTestQuestion = await tx.testQuestion.create({
          data: {
            testId,
            questionType: 'behavioral',
            behavioralQuestionId: createdQuestion.id,
            orderIndex: resolvedOrder,
            sectionId: sectionId ?? null
          },
          include: {
            mcqQuestion: true,
            codingQuestion: true,
            behavioralQuestion: true
          }
        });

        return [createdQuestion, createdTestQuestion];
      });

      res.status(201).json({
        message: 'Custom behavioral question created and added to test.',
        testQuestion,
        question
      });
      return;
    }

    if (questionType === 'communication') {
      const subType = VALID_COMMUNICATION_SUB_TYPES.includes(req.body.subType) ? req.body.subType : null;
      if (!subType) {
        res.status(400).json({ error: 'Valid subType is required (WRITTEN, LISTENING, READING, or SPEAKING).' });
        return;
      }

      const result = await buildCommunicationCreateData(req, subType);
      if ('error' in result) {
        res.status(400).json({ error: result.error });
        return;
      }

      // Test-scoped custom questions use the same "__test_scoped__" tag marker as the mcq/coding/
      // behavioral branches above (toTestScopedTagJson) so they don't clutter the general library
      // search — this intentionally overrides buildCommunicationCreateData's own plain tag handling.
      const data = { ...result.data, tags: toTestScopedTagJson(testId, req.body.tags) };

      const [question, testQuestion] = await prisma.$transaction(async (tx) => {
        const createdQuestion = await tx.communicationQuestion.create({
          data: {
            ...data,
            source: QuestionSource.CUSTOM,
            repositoryCategory: QuestionRepositoryCategory.COMMUNICATION,
            isEnabled: true,
            adminId: req.admin!.id
          } as Parameters<typeof tx.communicationQuestion.create>[0]['data']
        });

        const createdTestQuestion = await tx.testQuestion.create({
          data: {
            testId,
            questionType: 'communication',
            communicationQuestionId: createdQuestion.id,
            orderIndex: resolvedOrder,
            sectionId: sectionId ?? null
          },
          include: {
            mcqQuestion: true,
            codingQuestion: true,
            behavioralQuestion: true,
            communicationQuestion: true
          }
        });

        return [createdQuestion, createdTestQuestion];
      });

      res.status(201).json({
        message: 'Custom communication question created and added to test.',
        testQuestion,
        question: serializeCommunicationQuestion(question)
      });
      return;
    }

    res.status(400).json({ error: 'Invalid questionType. Use mcq, coding, behavioral, or communication.' });
  } catch (error) {
    console.error('Add custom question to test error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function removeQuestionFromTest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId, questionId } = req.params;

    const test = await prisma.test.findFirst({
      where: {
        ...testOwnershipWhere(req, testId)
      }
    });

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const testQuestion = await prisma.testQuestion.findFirst({
      where: {
        id: questionId,
        testId
      }
    });

    if (!testQuestion) {
      res.status(404).json({ error: 'Question not found in test' });
      return;
    }

    await prisma.testQuestion.delete({
      where: { id: questionId }
    });

    res.json({ message: 'Question removed from test' });
  } catch (error) {
    console.error('Remove question from test error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function reorderTestQuestions(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId } = req.params;
    const { questionOrders } = req.body; // Array of { questionId, orderIndex }

    const test = await prisma.test.findFirst({
      where: {
        ...testOwnershipWhere(req, testId)
      }
    });

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    // Update each question's order
    await Promise.all(
      questionOrders.map(({ questionId, orderIndex }: { questionId: string; orderIndex: number }) =>
        prisma.testQuestion.update({
          where: { id: questionId },
          data: { orderIndex }
        })
      )
    );

    res.json({ message: 'Questions reordered successfully' });
  } catch (error) {
    console.error('Reorder questions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}


type EmailTemplateRow = {
  assessmentMode: string;
  inviteEmailSubject: string | null;
  inviteEmailBody: string | null;
  confirmEmailSubject: string | null;
  confirmEmailBody: string | null;
  reminderEmailSubject: string | null;
  reminderEmailBody: string | null;
  normalBrowserInviteEmailSubject: string | null;
  normalBrowserInviteEmailBody: string | null;
  normalBrowserConfirmEmailSubject: string | null;
  normalBrowserConfirmEmailBody: string | null;
  normalBrowserReminderEmailSubject: string | null;
  normalBrowserReminderEmailBody: string | null;
  reminderHoursBeforeClose: number;
};

export async function getEmailTemplates(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId } = req.params;
    // cast needed until `prisma generate` is re-run after schema migration
    const test = await (prisma.test as any).findFirst({
      where: testOwnershipWhere(req, testId),
      select: {
        assessmentMode: true,
        inviteEmailSubject: true,
        inviteEmailBody: true,
        confirmEmailSubject: true,
        confirmEmailBody: true,
        reminderEmailSubject: true,
        reminderEmailBody: true,
        normalBrowserInviteEmailSubject: true,
        normalBrowserInviteEmailBody: true,
        normalBrowserConfirmEmailSubject: true,
        normalBrowserConfirmEmailBody: true,
        normalBrowserReminderEmailSubject: true,
        normalBrowserReminderEmailBody: true,
        reminderHoursBeforeClose: true,
      }
    }) as EmailTemplateRow | null;

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const sebTemplates = {
      inviteEmailSubject: test.inviteEmailSubject ?? DEFAULT_INVITE_SUBJECT,
      inviteEmailBody: test.inviteEmailBody ?? DEFAULT_INVITE_BODY,
      confirmEmailSubject: test.confirmEmailSubject ?? DEFAULT_CONFIRM_SUBJECT,
      confirmEmailBody: test.confirmEmailBody ?? DEFAULT_CONFIRM_BODY,
      reminderEmailSubject: test.reminderEmailSubject ?? DEFAULT_REMINDER_SUBJECT,
      reminderEmailBody: test.reminderEmailBody ?? DEFAULT_REMINDER_BODY,
    };
    const normalBrowserTemplates = {
      inviteEmailSubject: test.normalBrowserInviteEmailSubject ?? DEFAULT_NORMAL_BROWSER_INVITE_SUBJECT,
      inviteEmailBody: test.normalBrowserInviteEmailBody ?? DEFAULT_NORMAL_BROWSER_INVITE_BODY,
      confirmEmailSubject: test.normalBrowserConfirmEmailSubject ?? DEFAULT_NORMAL_BROWSER_CONFIRM_SUBJECT,
      confirmEmailBody: test.normalBrowserConfirmEmailBody ?? DEFAULT_NORMAL_BROWSER_CONFIRM_BODY,
      reminderEmailSubject: test.normalBrowserReminderEmailSubject ?? DEFAULT_NORMAL_BROWSER_REMINDER_SUBJECT,
      reminderEmailBody: test.normalBrowserReminderEmailBody ?? DEFAULT_NORMAL_BROWSER_REMINDER_BODY,
    };
    const activeTemplates = test.assessmentMode === 'NORMAL_BROWSER' ? normalBrowserTemplates : sebTemplates;

    res.json({
      ...activeTemplates,
      assessmentMode: test.assessmentMode === 'NORMAL_BROWSER' ? 'NORMAL_BROWSER' : 'SEB',
      templates: {
        SEB: sebTemplates,
        NORMAL_BROWSER: normalBrowserTemplates,
      },
      reminderHoursBeforeClose: test.reminderHoursBeforeClose,
    });
  } catch (error) {
    console.error('Get email templates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateEmailTemplates(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId } = req.params;
    const {
      inviteEmailSubject, inviteEmailBody,
      confirmEmailSubject, confirmEmailBody,
      reminderEmailSubject, reminderEmailBody,
      reminderHoursBeforeClose,
      templateMode,
    } = req.body as {
      inviteEmailSubject?: string;
      inviteEmailBody?: string;
      confirmEmailSubject?: string;
      confirmEmailBody?: string;
      reminderEmailSubject?: string;
      reminderEmailBody?: string;
      reminderHoursBeforeClose?: number;
      templateMode?: 'SEB' | 'NORMAL_BROWSER';
    };

    if (templateMode !== undefined && templateMode !== 'SEB' && templateMode !== 'NORMAL_BROWSER') {
      res.status(400).json({ error: 'templateMode must be SEB or NORMAL_BROWSER' });
      return;
    }

    if (reminderHoursBeforeClose !== undefined
      && (!Number.isFinite(reminderHoursBeforeClose) || reminderHoursBeforeClose <= 0)) {
      res.status(400).json({ error: 'reminderHoursBeforeClose must be a positive number' });
      return;
    }

    const exists = await prisma.test.findFirst({
      where: testOwnershipWhere(req, testId),
      select: { id: true }
    });

    if (!exists) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const data: Record<string, string | number> = {};
    const normalBrowser = templateMode === 'NORMAL_BROWSER';
    if (inviteEmailSubject !== undefined) {
      data[normalBrowser ? 'normalBrowserInviteEmailSubject' : 'inviteEmailSubject'] = sanitizeInput(inviteEmailSubject);
    }
    if (inviteEmailBody !== undefined) {
      data[normalBrowser ? 'normalBrowserInviteEmailBody' : 'inviteEmailBody'] = sanitizeInput(inviteEmailBody);
    }
    if (confirmEmailSubject !== undefined) {
      data[normalBrowser ? 'normalBrowserConfirmEmailSubject' : 'confirmEmailSubject'] = sanitizeInput(confirmEmailSubject);
    }
    if (confirmEmailBody !== undefined) {
      data[normalBrowser ? 'normalBrowserConfirmEmailBody' : 'confirmEmailBody'] = sanitizeInput(confirmEmailBody);
    }
    if (reminderEmailSubject !== undefined) {
      data[normalBrowser ? 'normalBrowserReminderEmailSubject' : 'reminderEmailSubject'] = sanitizeInput(reminderEmailSubject);
    }
    if (reminderEmailBody !== undefined) {
      data[normalBrowser ? 'normalBrowserReminderEmailBody' : 'reminderEmailBody'] = sanitizeInput(reminderEmailBody);
    }
    if (reminderHoursBeforeClose !== undefined) data.reminderHoursBeforeClose = Math.round(reminderHoursBeforeClose);

    await (prisma.test as any).update({ where: { id: testId }, data });

    res.json({ message: 'Email templates saved' });
  } catch (error) {
    console.error('Update email templates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
