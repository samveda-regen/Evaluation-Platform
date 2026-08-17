import { Response } from 'express';
import { CommunicationSubType, QuestionSource, WrittenStimulusType } from '@prisma/client';
import { AuthenticatedRequest } from '../types/index.js';
import { sanitizeInput } from '../utils/sanitize.js';
import prisma from '../utils/db.js';

const TEST_SCOPED_TAG_MARKER = '"__test_scoped__"';
const VALID_SUB_TYPES: CommunicationSubType[] = ['WRITTEN', 'LISTENING', 'READING', 'SPEAKING'];
const VALID_STIMULUS_TYPES: WrittenStimulusType[] = ['NONE', 'IMAGE', 'AUDIO'];

function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function parseOptionsArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
    .map(o => sanitizeInput(o));
}

function parseCorrectAnswers(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((n): n is number => typeof n === 'number' && Number.isInteger(n));
}

export function serializeCommunicationQuestion<T extends {
  options: string | null;
  correctAnswers: string | null;
  tags: string | null;
}>(question: T) {
  return {
    ...question,
    options: question.options ? (JSON.parse(question.options) as string[]) : [],
    correctAnswers: question.correctAnswers ? (JSON.parse(question.correctAnswers) as number[]) : [],
    tags: parseTags(question.tags)
  };
}

// Validates and normalizes the subType-specific fields, returning either the ready-to-persist
// Prisma create data or a client-facing error message — kept as a single switch so every subType's
// required-field rules live in one place instead of scattered validation checks.
async function buildCreateData(
  req: AuthenticatedRequest,
  subType: CommunicationSubType
): Promise<{ data: Record<string, unknown> } | { error: string }> {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  const topic = typeof req.body.topic === 'string' ? req.body.topic.trim() : null;
  const difficulty = ['easy', 'medium', 'hard'].includes(req.body.difficulty) ? req.body.difficulty : 'medium';
  const tags: string[] = Array.isArray(req.body.tags)
    ? req.body.tags.filter((t: unknown): t is string => typeof t === 'string').map((t: string) => sanitizeInput(t))
    : [];
  const marks = Number.parseInt(String(req.body.marks ?? ''), 10);

  if (!Number.isFinite(marks) || marks < 1) {
    return { error: 'Marks must be a positive integer.' };
  }
  if (!title) {
    return { error: 'Title is required.' };
  }

  const shared = {
    subType,
    title: sanitizeInput(title),
    marks,
    difficulty,
    topic: topic ? sanitizeInput(topic) : null,
    tags: tags.length ? JSON.stringify(tags) : null
  };

  if (subType === 'WRITTEN') {
    if (!description) {
      return { error: 'Description/prompt is required for Written questions — it is the reference the AI uses to evaluate the candidate\'s answer.' };
    }
    const stimulusType: WrittenStimulusType = VALID_STIMULUS_TYPES.includes(req.body.stimulusType) ? req.body.stimulusType : 'NONE';
    const evaluationNotes = typeof req.body.evaluationNotes === 'string' ? req.body.evaluationNotes.trim() : '';
    return {
      data: {
        ...shared,
        description: sanitizeInput(description),
        stimulusType,
        evaluationNotes: evaluationNotes ? sanitizeInput(evaluationNotes) : null
      }
    };
  }

  if (subType === 'LISTENING' || subType === 'READING') {
    const options = parseOptionsArray(req.body.options);
    const correctAnswers = parseCorrectAnswers(req.body.correctAnswers);
    if (!options || options.length < 2) {
      return { error: 'At least 2 options are required.' };
    }
    const uniqueOptions = new Set(options.map(o => o.toLowerCase().trim()));
    if (uniqueOptions.size !== options.length) {
      return { error: 'Options must be unique.' };
    }
    if (!correctAnswers || correctAnswers.length === 0) {
      return { error: 'At least one correct answer is required.' };
    }
    if (!correctAnswers.every(idx => idx >= 0 && idx < options.length)) {
      return { error: 'Invalid correct answer indices.' };
    }
    const explanation = typeof req.body.explanation === 'string' ? req.body.explanation.trim() : '';
    const isMultipleChoice = Boolean(req.body.isMultipleChoice) || correctAnswers.length > 1;

    if (subType === 'READING') {
      const passageId = typeof req.body.passageId === 'string' ? req.body.passageId.trim() : '';
      if (!passageId) {
        return { error: 'A reading passage must be selected.' };
      }
      const passage = await prisma.readingPassage.findUnique({ where: { id: passageId } });
      if (!passage) {
        return { error: 'Reading passage not found.' };
      }
      return {
        data: {
          ...shared,
          description: description ? sanitizeInput(description) : null,
          options: JSON.stringify(options),
          correctAnswers: JSON.stringify(correctAnswers),
          explanation: explanation ? sanitizeInput(explanation) : null,
          isMultipleChoice,
          passageId
        }
      };
    }

    // LISTENING
    const replayLimit = Number.isFinite(Number(req.body.replayLimit)) ? Math.max(1, Math.floor(Number(req.body.replayLimit))) : 1;
    const allowRewind = req.body.allowRewind !== undefined ? Boolean(req.body.allowRewind) : true;
    const allowSpeedChange = req.body.allowSpeedChange !== undefined ? Boolean(req.body.allowSpeedChange) : true;
    const fixedPlaybackSpeed = Number.isFinite(Number(req.body.fixedPlaybackSpeed)) ? Number(req.body.fixedPlaybackSpeed) : 1.0;
    return {
      data: {
        ...shared,
        description: description ? sanitizeInput(description) : null,
        options: JSON.stringify(options),
        correctAnswers: JSON.stringify(correctAnswers),
        explanation: explanation ? sanitizeInput(explanation) : null,
        isMultipleChoice,
        replayLimit,
        allowRewind,
        allowSpeedChange,
        fixedPlaybackSpeed
      }
    };
  }

  // SPEAKING
  const recordingTimeLimit = Number.isFinite(Number(req.body.recordingTimeLimit)) ? Math.max(10, Math.floor(Number(req.body.recordingTimeLimit))) : 120;
  const speakingEvaluationNotes = typeof req.body.evaluationNotes === 'string' ? req.body.evaluationNotes.trim() : '';
  return {
    data: {
      ...shared,
      description: description ? sanitizeInput(description) : null,
      evaluationNotes: speakingEvaluationNotes ? sanitizeInput(speakingEvaluationNotes) : null,
      recordingTimeLimit
    }
  };
}

export async function createCommunicationQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const subType = VALID_SUB_TYPES.includes(req.body.subType) ? req.body.subType as CommunicationSubType : null;
    if (!subType) {
      res.status(400).json({ error: 'Valid subType is required (WRITTEN, LISTENING, READING, or SPEAKING).' });
      return;
    }

    const result = await buildCreateData(req, subType);
    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }

    const source: QuestionSource = req.body.source === QuestionSource.QUESTION_BANK ? QuestionSource.QUESTION_BANK : QuestionSource.CUSTOM;

    const question = await prisma.communicationQuestion.create({
      data: {
        ...result.data,
        source,
        adminId: req.admin!.id
      } as Parameters<typeof prisma.communicationQuestion.create>[0]['data']
    });

    res.status(201).json({
      message: 'Communication question created successfully',
      question: serializeCommunicationQuestion(question)
    });
  } catch (error) {
    console.error('Create communication question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getCommunicationQuestions(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const page = Number.parseInt(req.query.page as string, 10) || 1;
    const limit = Number.parseInt(req.query.limit as string, 10) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search as string | undefined;
    const subType = VALID_SUB_TYPES.includes(req.query.subType as CommunicationSubType) ? (req.query.subType as CommunicationSubType) : undefined;

    const ownershipFilter = { OR: [{ adminId: req.admin!.id }, { adminId: null }] };
    const where = {
      ...ownershipFilter,
      ...(subType ? { subType } : {}),
      ...(search ? { OR: [{ title: { contains: search } }, { description: { contains: search } }] } : {}),
      NOT: { tags: { contains: TEST_SCOPED_TAG_MARKER } }
    };

    const [questions, total] = await Promise.all([
      prisma.communicationQuestion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { passage: true }
      }),
      prisma.communicationQuestion.count({ where })
    ]);

    res.json({
      questions: questions.map(q => serializeCommunicationQuestion(q)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Get communication questions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getCommunicationQuestionById(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { questionId } = req.params;
    const question = await prisma.communicationQuestion.findFirst({
      where: { id: questionId, OR: [{ adminId: req.admin!.id }, { adminId: null }] },
      include: { mediaAssets: true, passage: true }
    });
    if (!question) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }
    res.json({ question: serializeCommunicationQuestion(question) });
  } catch (error) {
    console.error('Get communication question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteCommunicationQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { questionId } = req.params;
    const question = await prisma.communicationQuestion.findFirst({
      where: { id: questionId, OR: [{ adminId: req.admin!.id }, { adminId: null }] }
    });
    if (!question) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const inTest = await prisma.testQuestion.findFirst({ where: { communicationQuestionId: questionId } });
    if (inTest) {
      res.status(400).json({ error: 'Question is used in a test and cannot be deleted.' });
      return;
    }

    await prisma.communicationQuestion.delete({ where: { id: questionId } });
    res.json({ message: 'Question deleted successfully' });
  } catch (error) {
    console.error('Delete communication question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ==================== READING PASSAGES ====================

export async function createReadingPassage(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const passageText = typeof req.body.passageText === 'string' ? req.body.passageText.trim() : '';
    if (!title || !passageText) {
      res.status(400).json({ error: 'Title and passage text are required.' });
      return;
    }

    const passage = await prisma.readingPassage.create({
      data: {
        title: sanitizeInput(title),
        passageText: sanitizeInput(passageText),
        adminId: req.admin!.id
      }
    });

    res.status(201).json({ message: 'Reading passage created successfully', passage });
  } catch (error) {
    console.error('Create reading passage error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getReadingPassages(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const search = req.query.search as string | undefined;
    const where = {
      OR: [{ adminId: req.admin!.id }, { adminId: null }],
      ...(search ? { title: { contains: search } } : {})
    };
    const passages = await prisma.readingPassage.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
    res.json({ passages });
  } catch (error) {
    console.error('Get reading passages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
