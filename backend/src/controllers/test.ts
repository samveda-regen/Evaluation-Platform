import { Response } from 'express';
import { QuestionRepositoryCategory, QuestionSource } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { AuthenticatedRequest } from '../types/index.js';
import { sanitizeInput } from '../utils/sanitize.js';
import prisma from '../utils/db.js';

const TEST_SCOPED_TAG = '__test_scoped__';

function generateTestCode(): string {
  return uuidv4().substring(0, 8).toUpperCase();
}

function toTestOwnerTag(testId: string): string {
  return `__test:${testId}`;
}

function parseJsonTags(tags: string | null): string[] {
  if (!tags) {
    return [];
  }

  try {
    const parsed = JSON.parse(tags) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
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

function isTestScopedForAnotherTest(tags: string | null, testId: string): boolean {
  const parsedTags = parseJsonTags(tags);
  const hasScopedTag = parsedTags.includes(TEST_SCOPED_TAG);
  if (!hasScopedTag) {
    return false;
  }

  return !parsedTags.includes(toTestOwnerTag(testId));
}

function toOptionalSanitizedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? sanitizeInput(trimmed) : null;
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
      requireIdVerification
    } = req.body;

    const testCode = generateTestCode();

    const test = await prisma.test.create({
      data: {
        testCode,
        name: sanitizeInput(name),
        description: description ? sanitizeInput(description) : null,
        instructions: instructions ? sanitizeInput(instructions) : null,
        duration: parseInt(duration),
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : null,
        totalMarks: parseInt(totalMarks),
        passingMarks: passingMarks ? parseInt(passingMarks) : null,
        negativeMarking: negativeMarking ? parseFloat(negativeMarking) : 0,
        shuffleQuestions: shuffleQuestions || false,
        shuffleOptions: shuffleOptions || false,
        allowMultipleAttempts: allowMultipleAttempts || false,
        maxViolations: maxViolations || 3,
        proctorEnabled: proctorEnabled || false,
        requireCamera: requireCamera || false,
        requireMicrophone: requireMicrophone || false,
        requireScreenShare: requireScreenShare || false,
        requireIdVerification: requireIdVerification || false,
        adminId: req.admin!.id
      }
    });

    res.status(201).json({
      message: 'Test created successfully',
      test: {
        ...test,
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
    const skip = (page - 1) * limit;

    const [tests, total] = await Promise.all([
      prisma.test.findMany({
        where: { adminId: req.admin!.id },
        include: {
          _count: {
            select: {
              questions: true,
              attempts: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.test.count({ where: { adminId: req.admin!.id } })
    ]);

    res.json({
      tests,
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
        id: testId,
        adminId: req.admin!.id
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
            behavioralQuestion: true
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
                behavioralQuestion: true
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

    res.json({ test });
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
        id: testId,
        adminId: req.admin!.id
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
        id: testId,
        adminId: req.admin!.id
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
        id: testId,
        adminId: req.admin!.id
      }
    });

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const sanitizedUpdates: Record<string, unknown> = {};

    if (updates.name) sanitizedUpdates.name = sanitizeInput(updates.name);
    if (updates.description !== undefined) sanitizedUpdates.description = updates.description ? sanitizeInput(updates.description) : null;
    if (updates.instructions !== undefined) sanitizedUpdates.instructions = updates.instructions ? sanitizeInput(updates.instructions) : null;
    if (updates.duration) sanitizedUpdates.duration = parseInt(updates.duration);
    if (updates.startTime) sanitizedUpdates.startTime = new Date(updates.startTime);
    if (updates.endTime !== undefined) sanitizedUpdates.endTime = updates.endTime ? new Date(updates.endTime) : null;
    if (updates.totalMarks) sanitizedUpdates.totalMarks = parseInt(updates.totalMarks);
    if (updates.passingMarks !== undefined) sanitizedUpdates.passingMarks = updates.passingMarks ? parseInt(updates.passingMarks) : null;
    if (updates.negativeMarking !== undefined) sanitizedUpdates.negativeMarking = parseFloat(updates.negativeMarking) || 0;
    if (updates.isActive !== undefined) sanitizedUpdates.isActive = updates.isActive;
    if (updates.shuffleQuestions !== undefined) sanitizedUpdates.shuffleQuestions = updates.shuffleQuestions;
    if (updates.shuffleOptions !== undefined) sanitizedUpdates.shuffleOptions = updates.shuffleOptions;
    if (updates.allowMultipleAttempts !== undefined) sanitizedUpdates.allowMultipleAttempts = updates.allowMultipleAttempts;
    if (updates.maxViolations !== undefined) sanitizedUpdates.maxViolations = parseInt(updates.maxViolations);
    if (updates.proctorEnabled !== undefined) sanitizedUpdates.proctorEnabled = updates.proctorEnabled;
    if (updates.requireCamera !== undefined) sanitizedUpdates.requireCamera = updates.requireCamera;
    if (updates.requireMicrophone !== undefined) sanitizedUpdates.requireMicrophone = updates.requireMicrophone;
    if (updates.requireScreenShare !== undefined) sanitizedUpdates.requireScreenShare = updates.requireScreenShare;
    if (updates.requireIdVerification !== undefined) sanitizedUpdates.requireIdVerification = updates.requireIdVerification;

    const updatedTest = await prisma.test.update({
      where: { id: testId },
      data: sanitizedUpdates
    });

    res.json({
      message: 'Test updated successfully',
      test: updatedTest
    });
  } catch (error) {
    console.error('Update test error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteTest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId } = req.params;

    const test = await prisma.test.findFirst({
      where: {
        id: testId,
        adminId: req.admin!.id
      },
      include: {
        attempts: true
      }
    });

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    // Delete all related data in a transaction
    await prisma.$transaction(async (tx) => {
      // Get all attempt IDs for this test
      const attemptIds = test.attempts.map(a => a.id);

      if (attemptIds.length > 0) {
        // Delete all attempt-related data
        await tx.performanceAnalytics.deleteMany({
          where: { attemptId: { in: attemptIds } }
        });

        await tx.proctorEvent.deleteMany({
          where: { session: { attemptId: { in: attemptIds } } }
        });

        await tx.proctorRecording.deleteMany({
          where: { session: { attemptId: { in: attemptIds } } }
        });

        await tx.faceSnapshot.deleteMany({
          where: { session: { attemptId: { in: attemptIds } } }
        });

        await tx.proctorSession.deleteMany({
          where: { attemptId: { in: attemptIds } }
        });

        await tx.mCQAnswer.deleteMany({
          where: { attemptId: { in: attemptIds } }
        });

        await tx.codingAnswer.deleteMany({
          where: { attemptId: { in: attemptIds } }
        });

        await tx.activityLog.deleteMany({
          where: { attemptId: { in: attemptIds } }
        });

        // Delete test attempts
        await tx.testAttempt.deleteMany({
          where: { testId }
        });
      }

      // Delete test analytics
      await tx.testAnalytics.deleteMany({
        where: { testId }
      });

      // Delete test questions
      await tx.testQuestion.deleteMany({
        where: { testId }
      });

      // Finally, delete the test
      await tx.test.delete({
        where: { id: testId }
      });
    });

    res.json({ message: 'Test deleted successfully' });
  } catch (error) {
    console.error('Delete test error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
        id: testId,
        adminId: req.admin!.id
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
      if (isTestScopedForAnotherTest(mcq.tags, testId)) {
        res.status(400).json({ error: 'This question is scoped to another test and cannot be reused.' });
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
      if (isTestScopedForAnotherTest(coding.tags, testId)) {
        res.status(400).json({ error: 'This question is scoped to another test and cannot be reused.' });
        return;
      }
    } else if (questionType === 'behavioral') {
      const behavioral = await prisma.behavioralQuestion.findUnique({ where: { id: questionId } });
      if (!behavioral) {
        res.status(404).json({ error: 'Behavioral question not found' });
        return;
      }
      if (isTestScopedForAnotherTest(behavioral.tags, testId)) {
        res.status(400).json({ error: 'This question is scoped to another test and cannot be reused.' });
        return;
      }
    } else {
      res.status(400).json({ error: 'Invalid question type' });
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
        orderIndex: order,
        sectionId: sectionId ?? null
      },
      include: {
        mcqQuestion: true,
        codingQuestion: true,
        behavioralQuestion: true
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
        id: testId,
        adminId: req.admin!.id
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
            isEnabled: true
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
            isEnabled: true
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

    res.status(400).json({ error: 'Invalid questionType. Use mcq, coding, or behavioral.' });
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
        id: testId,
        adminId: req.admin!.id
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
        id: testId,
        adminId: req.admin!.id
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
