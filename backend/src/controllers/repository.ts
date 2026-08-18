import { Prisma, QuestionRepositoryCategory, QuestionSource } from '@prisma/client';
import { Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import prisma from '../utils/db.js';
import { sanitizeInput } from '../utils/sanitize.js';
import { createMCQQuestion } from './mcqQuestion.js';
import { createCodingQuestion } from './codingQuestion.js';
import { createCommunicationQuestion, serializeCommunicationQuestion, MAX_RECORDING_TIME_LIMIT_SEC } from './communicationQuestion.js';

type RepositoryCategory = 'MCQ' | 'CODING' | 'BEHAVIORAL' | 'COMMUNICATION';
type Difficulty = 'easy' | 'medium' | 'hard';

const VALID_CATEGORIES: RepositoryCategory[] = ['MCQ', 'CODING', 'BEHAVIORAL', 'COMMUNICATION'];
const VALID_DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseCategory(value: unknown): RepositoryCategory | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.toUpperCase() as RepositoryCategory;
  return VALID_CATEGORIES.includes(normalized) ? normalized : null;
}

function parseSource(value: unknown): QuestionSource | null {
  if (value === QuestionSource.CUSTOM || value === QuestionSource.QUESTION_BANK) {
    return value;
  }
  return null;
}

function parseDifficulty(value: unknown): Difficulty | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.toLowerCase() as Difficulty;
  return VALID_DIFFICULTIES.includes(normalized) ? normalized : undefined;
}

function parsePagination(query: AuthenticatedRequest['query']) {
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
  const limit = Math.max(1, Math.min(100, Number.parseInt(String(query.limit ?? '20'), 10) || 20));
  return {
    page,
    limit,
    skip: (page - 1) * limit
  };
}

function parseEnabled(value: unknown): boolean | undefined {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}

function parseJsonArray<T>(value: string | null): T[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonObject<T extends object>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as T;
    }
    return null;
  } catch {
    return null;
  }
}

function parseTagsInput(tags: unknown): string[] | null {
  if (tags === undefined) {
    return null;
  }

  if (tags === null) {
    return [];
  }

  if (Array.isArray(tags)) {
    return tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => sanitizeInput(tag).trim().toLowerCase())
      .filter((tag) => tag.length > 0);
  }

  if (typeof tags === 'string') {
    const trimmed = tags.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => sanitizeInput(tag).trim().toLowerCase())
          .filter((tag) => tag.length > 0);
      }
    } catch {
      // Not JSON; treat as CSV.
    }

    return trimmed
      .split(',')
      .map((tag) => sanitizeInput(tag).trim().toLowerCase())
      .filter((tag) => tag.length > 0);
  }

  return [];
}

function isOwnedByRequester(
  question: { source: QuestionSource; adminId?: string | null },
  requesterId: string
): boolean {
  // QUESTION_BANK items are a shared library with no owner; CUSTOM items
  // belong to the admin who created them and must stay isolated per-account.
  return question.source !== QuestionSource.CUSTOM || question.adminId === requesterId;
}

function buildPagination(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit))
  };
}

function serializeMCQQuestion(question: {
  options: string;
  correctAnswers: string;
  tags: string | null;
}) {
  return {
    ...question,
    options: parseJsonArray<string>(question.options),
    correctAnswers: parseJsonArray<number>(question.correctAnswers),
    tags: parseJsonArray<string>(question.tags)
  };
}

function serializeCodingQuestion(question: {
  supportedLanguages: string;
  codeTemplates: string | null;
  tags: string | null;
}) {
  return {
    ...question,
    supportedLanguages: parseJsonArray<string>(question.supportedLanguages),
    codeTemplates: parseJsonObject<Record<string, string>>(question.codeTemplates),
    tags: parseJsonArray<string>(question.tags)
  };
}

function serializeBehavioralQuestion(question: { tags: string | null }) {
  return {
    ...question,
    tags: parseJsonArray<string>(question.tags)
  };
}

// ==========================================
// GET REPOSITORY QUESTIONS (Bank / Custom)
// ==========================================
export async function getRepositoryQuestions(req: AuthenticatedRequest, res: Response) {
  try {
    const source = parseSource(req.query.source);
    const category = parseCategory(req.query.category);
    const difficulty = parseDifficulty(req.query.difficulty);
    const search = toStringOrUndefined(req.query.search);
    const topic = toStringOrUndefined(req.query.topic);
    const tag = toStringOrUndefined(req.query.tag);
    const enabled = parseEnabled(req.query.enabled);
    const { page, limit, skip } = parsePagination(req.query);

    if (!source) {
      res.status(400).json({ error: 'Invalid source. Use QUESTION_BANK or CUSTOM.' });
      return;
    }

    if (!category) {
      res.status(400).json({ error: 'Invalid category. Use MCQ, CODING, BEHAVIORAL, or COMMUNICATION.' });
      return;
    }

    switch (category) {
      case 'MCQ': {
        const where: Prisma.MCQQuestionWhereInput = { source };
        if (source === QuestionSource.CUSTOM) where.adminId = req.admin!.id;
        if (difficulty) where.difficulty = difficulty;
        if (topic) where.topic = { contains: topic, mode: 'insensitive' };
        if (tag) where.tags = { contains: tag, mode: 'insensitive' };
        if (enabled !== undefined) where.isEnabled = enabled;
        if (search) {
          where.OR = [
            { questionText: { contains: search, mode: 'insensitive' } },
            { tags: { contains: search, mode: 'insensitive' } }
          ];
        }

        const [questions, total] = await Promise.all([
          prisma.mCQQuestion.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { testQuestions: true } } }
          }),
          prisma.mCQQuestion.count({ where })
        ]);

        res.json({
          questions: questions.map(q => ({ ...serializeMCQQuestion(q), usageCount: q._count.testQuestions })),
          pagination: buildPagination(page, limit, total)
        });
        return;
      }

      case 'CODING': {
        const where: Prisma.CodingQuestionWhereInput = { source };
        if (source === QuestionSource.CUSTOM) where.adminId = req.admin!.id;
        if (difficulty) where.difficulty = difficulty;
        if (topic) where.topic = { contains: topic, mode: 'insensitive' };
        if (tag) where.tags = { contains: tag, mode: 'insensitive' };
        if (enabled !== undefined) where.isEnabled = enabled;
        if (search) {
          where.OR = [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { tags: { contains: search, mode: 'insensitive' } }
          ];
        }

        const [questions, total] = await Promise.all([
          prisma.codingQuestion.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { testQuestions: true } } }
          }),
          prisma.codingQuestion.count({ where })
        ]);

        res.json({
          questions: questions.map(q => ({ ...serializeCodingQuestion(q), usageCount: q._count.testQuestions })),
          pagination: buildPagination(page, limit, total)
        });
        return;
      }

      case 'BEHAVIORAL': {
        const where: Prisma.BehavioralQuestionWhereInput = { source };
        if (source === QuestionSource.CUSTOM) where.adminId = req.admin!.id;
        if (difficulty) where.difficulty = difficulty;
        if (topic) where.topic = { contains: topic, mode: 'insensitive' };
        if (tag) where.tags = { contains: tag, mode: 'insensitive' };
        if (enabled !== undefined) where.isEnabled = enabled;
        if (search) {
          where.OR = [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { expectedAnswer: { contains: search, mode: 'insensitive' } },
            { tags: { contains: search, mode: 'insensitive' } }
          ];
        }

        const [questions, total] = await Promise.all([
          prisma.behavioralQuestion.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { testQuestions: true } } }
          }),
          prisma.behavioralQuestion.count({ where })
        ]);

        res.json({
          questions: questions.map(q => ({ ...serializeBehavioralQuestion(q), usageCount: q._count.testQuestions })),
          pagination: buildPagination(page, limit, total)
        });
        return;
      }

      case 'COMMUNICATION': {
        const where: Prisma.CommunicationQuestionWhereInput = { source };
        if (source === QuestionSource.CUSTOM) where.adminId = req.admin!.id;
        if (difficulty) where.difficulty = difficulty;
        if (topic) where.topic = { contains: topic, mode: 'insensitive' };
        if (tag) where.tags = { contains: tag, mode: 'insensitive' };
        if (enabled !== undefined) where.isEnabled = enabled;
        const subType = toStringOrUndefined(req.query.subType);
        if (subType && ['WRITTEN', 'LISTENING', 'READING', 'SPEAKING'].includes(subType.toUpperCase())) {
          where.subType = subType.toUpperCase() as Prisma.EnumCommunicationSubTypeFilter['equals'];
        }
        if (search) {
          where.OR = [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { tags: { contains: search, mode: 'insensitive' } }
          ];
        }

        const [questions, total] = await Promise.all([
          prisma.communicationQuestion.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { testQuestions: true } }, passage: true }
          }),
          prisma.communicationQuestion.count({ where })
        ]);

        res.json({
          questions: questions.map(q => ({ ...serializeCommunicationQuestion(q), usageCount: q._count.testQuestions })),
          pagination: buildPagination(page, limit, total)
        });
      }
    }
  } catch (error) {
    console.error('Repository fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ==========================================
// ENABLE / DISABLE
// ==========================================
export async function toggleRepositoryQuestion(
  req: AuthenticatedRequest,
  res: Response,
  value: boolean
) {
  try {
    const { questionId } = req.params;
    const category = parseCategory(req.query.category);

    if (!category) {
      res.status(400).json({ error: 'Invalid category. Use MCQ, CODING, BEHAVIORAL, or COMMUNICATION.' });
      return;
    }

    switch (category) {
      case 'MCQ': {
        const existing = await prisma.mCQQuestion.findUnique({ where: { id: questionId } });
        if (!existing || !isOwnedByRequester(existing, req.admin!.id)) {
          res.status(404).json({ error: 'Question not found' });
          return;
        }

        await prisma.mCQQuestion.update({
          where: { id: questionId },
          data: { isEnabled: value }
        });
        break;
      }

      case 'CODING': {
        const existing = await prisma.codingQuestion.findUnique({ where: { id: questionId } });
        if (!existing || !isOwnedByRequester(existing, req.admin!.id)) {
          res.status(404).json({ error: 'Question not found' });
          return;
        }

        await prisma.codingQuestion.update({
          where: { id: questionId },
          data: { isEnabled: value }
        });
        break;
      }

      case 'BEHAVIORAL': {
        const existing = await prisma.behavioralQuestion.findUnique({ where: { id: questionId } });
        if (!existing || !isOwnedByRequester(existing, req.admin!.id)) {
          res.status(404).json({ error: 'Question not found' });
          return;
        }

        await prisma.behavioralQuestion.update({
          where: { id: questionId },
          data: { isEnabled: value }
        });
        break;
      }

      case 'COMMUNICATION': {
        const existing = await prisma.communicationQuestion.findUnique({ where: { id: questionId } });
        if (!existing || !isOwnedByRequester(existing, req.admin!.id)) {
          res.status(404).json({ error: 'Question not found' });
          return;
        }

        await prisma.communicationQuestion.update({
          where: { id: questionId },
          data: { isEnabled: value }
        });
      }
    }

    res.json({ message: `Question ${value ? 'enabled' : 'disabled'} successfully` });
  } catch (error) {
    console.error('Toggle repository error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ==========================================
// DELETE (CUSTOM ONLY)
// ==========================================
export async function deleteRepositoryQuestion(req: AuthenticatedRequest, res: Response) {
  try {
    const { questionId } = req.params;
    const category = parseCategory(req.query.category);

    if (!category) {
      res.status(400).json({ error: 'Invalid category. Use MCQ, CODING, BEHAVIORAL, or COMMUNICATION.' });
      return;
    }

    switch (category) {
      case 'MCQ': {
        const question = await prisma.mCQQuestion.findUnique({ where: { id: questionId } });
        if (!question) {
          res.status(404).json({ error: 'Question not found' });
          return;
        }
        if (question.source !== QuestionSource.CUSTOM) {
          res.status(400).json({ error: 'Only custom questions can be deleted from this endpoint.' });
          return;
        }
        if (question.adminId !== req.admin!.id) {
          res.status(404).json({ error: 'Question not found' });
          return;
        }

        const inTest = await prisma.testQuestion.findFirst({
          where: { mcqQuestionId: questionId }
        });
        if (inTest) {
          res.status(400).json({ error: 'Question is used in a test and cannot be deleted.' });
          return;
        }

        await prisma.mCQQuestion.delete({ where: { id: questionId } });
        break;
      }

      case 'CODING': {
        const question = await prisma.codingQuestion.findUnique({ where: { id: questionId } });
        if (!question) {
          res.status(404).json({ error: 'Question not found' });
          return;
        }
        if (question.source !== QuestionSource.CUSTOM) {
          res.status(400).json({ error: 'Only custom questions can be deleted from this endpoint.' });
          return;
        }
        if (question.adminId !== req.admin!.id) {
          res.status(404).json({ error: 'Question not found' });
          return;
        }

        const inTest = await prisma.testQuestion.findFirst({
          where: { codingQuestionId: questionId }
        });
        if (inTest) {
          res.status(400).json({ error: 'Question is used in a test and cannot be deleted.' });
          return;
        }

        await prisma.codingQuestion.delete({ where: { id: questionId } });
        break;
      }

      case 'BEHAVIORAL': {
        const question = await prisma.behavioralQuestion.findUnique({ where: { id: questionId } });
        if (!question) {
          res.status(404).json({ error: 'Question not found' });
          return;
        }
        if (question.source !== QuestionSource.CUSTOM) {
          res.status(400).json({ error: 'Only custom questions can be deleted from this endpoint.' });
          return;
        }
        if (question.adminId !== req.admin!.id) {
          res.status(404).json({ error: 'Question not found' });
          return;
        }

        const inTest = await prisma.testQuestion.findFirst({
          where: { behavioralQuestionId: questionId }
        });
        if (inTest) {
          res.status(400).json({ error: 'Question is used in a test and cannot be deleted.' });
          return;
        }

        await prisma.behavioralQuestion.delete({ where: { id: questionId } });
        break;
      }

      case 'COMMUNICATION': {
        const question = await prisma.communicationQuestion.findUnique({ where: { id: questionId } });
        if (!question) {
          res.status(404).json({ error: 'Question not found' });
          return;
        }
        if (question.source !== QuestionSource.CUSTOM) {
          res.status(400).json({ error: 'Only custom questions can be deleted from this endpoint.' });
          return;
        }
        if (question.adminId !== req.admin!.id) {
          res.status(404).json({ error: 'Question not found' });
          return;
        }

        const inTest = await prisma.testQuestion.findFirst({
          where: { communicationQuestionId: questionId }
        });
        if (inTest) {
          res.status(400).json({ error: 'Question is used in a test and cannot be deleted.' });
          return;
        }

        await prisma.communicationQuestion.delete({ where: { id: questionId } });
      }
    }

    res.json({ message: 'Question deleted successfully' });
  } catch (error) {
    console.error('Delete repository question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ==========================================
// UPDATE REPOSITORY QUESTIONS
// ==========================================
async function updateMCQBySource(
  req: AuthenticatedRequest,
  res: Response,
  expectedSource: QuestionSource,
  sourceLabel: string
) {
  try {
    const { questionId } = req.params;

    const existing = await prisma.mCQQuestion.findUnique({ where: { id: questionId } });
    if (!existing) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }
    if (existing.source !== expectedSource) {
      res.status(400).json({ error: `Only ${sourceLabel} questions can be edited from this endpoint.` });
      return;
    }
    if (!isOwnedByRequester(existing, req.admin!.id)) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const questionText = toStringOrUndefined(req.body.questionText);
    const explanation = toStringOrUndefined(req.body.explanation);
    const topic = toStringOrUndefined(req.body.topic);
    const difficulty = parseDifficulty(req.body.difficulty);
    const parsedTags = parseTagsInput(req.body.tags);
    const marks = req.body.marks !== undefined ? Number.parseInt(String(req.body.marks), 10) : undefined;
    const isMultipleChoice = req.body.isMultipleChoice !== undefined ? Boolean(req.body.isMultipleChoice) : undefined;

    let options: string | undefined;
    if (Array.isArray(req.body.options)) {
      const filtered = (req.body.options as unknown[])
        .filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
        .map((o) => sanitizeInput(o));
      if (filtered.length < 2) {
        res.status(400).json({ error: 'At least 2 options are required.' });
        return;
      }
      options = JSON.stringify(filtered);
    }

    let correctAnswers: string | undefined;
    if (Array.isArray(req.body.correctAnswers)) {
      correctAnswers = JSON.stringify(req.body.correctAnswers);
    }

    if (marks !== undefined && (!Number.isFinite(marks) || marks < 1)) {
      res.status(400).json({ error: 'Marks must be a positive integer.' });
      return;
    }

    const updated = await prisma.mCQQuestion.update({
      where: { id: questionId },
      data: {
        ...(questionText !== undefined && { questionText: sanitizeInput(questionText) }),
        ...(options !== undefined && { options }),
        ...(correctAnswers !== undefined && { correctAnswers }),
        ...(isMultipleChoice !== undefined && { isMultipleChoice }),
        ...(marks !== undefined && { marks }),
        ...(difficulty !== undefined && { difficulty }),
        ...(topic !== undefined && { topic: sanitizeInput(topic) }),
        ...(parsedTags !== null && { tags: JSON.stringify(parsedTags) }),
        ...(explanation !== undefined && { explanation: sanitizeInput(explanation) })
      }
    });

    res.json({ message: 'MCQ question updated successfully', question: serializeMCQQuestion(updated) });
  } catch (error) {
    console.error(`Update ${sourceLabel} MCQ error:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateCodingBySource(
  req: AuthenticatedRequest,
  res: Response,
  expectedSource: QuestionSource,
  sourceLabel: string
) {
  try {
    const { questionId } = req.params;

    const existing = await prisma.codingQuestion.findUnique({ where: { id: questionId } });
    if (!existing) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }
    if (existing.source !== expectedSource) {
      res.status(400).json({ error: `Only ${sourceLabel} questions can be edited from this endpoint.` });
      return;
    }
    if (!isOwnedByRequester(existing, req.admin!.id)) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const title = toStringOrUndefined(req.body.title);
    const description = toStringOrUndefined(req.body.description);
    const inputFormat = toStringOrUndefined(req.body.inputFormat);
    const outputFormat = toStringOrUndefined(req.body.outputFormat);
    const sampleInput = req.body.sampleInput !== undefined ? String(req.body.sampleInput) : undefined;
    const sampleOutput = req.body.sampleOutput !== undefined ? String(req.body.sampleOutput) : undefined;
    const constraints = req.body.constraints !== undefined
      ? (req.body.constraints ? String(req.body.constraints) : null)
      : undefined;
    const topic = toStringOrUndefined(req.body.topic);
    const difficulty = parseDifficulty(req.body.difficulty);
    const parsedTags = parseTagsInput(req.body.tags);
    const marks = req.body.marks !== undefined ? Number.parseInt(String(req.body.marks), 10) : undefined;
    const timeLimit = req.body.timeLimit !== undefined ? Number.parseInt(String(req.body.timeLimit), 10) : undefined;
    const memoryLimit = req.body.memoryLimit !== undefined ? Number.parseInt(String(req.body.memoryLimit), 10) : undefined;
    const partialScoring = req.body.partialScoring !== undefined ? Boolean(req.body.partialScoring) : undefined;

    if (marks !== undefined && (!Number.isFinite(marks) || marks < 1)) {
      res.status(400).json({ error: 'Marks must be a positive integer.' });
      return;
    }

    let supportedLanguages: string | undefined;
    if (Array.isArray(req.body.supportedLanguages)) {
      supportedLanguages = JSON.stringify(req.body.supportedLanguages);
    }

    let codeTemplates: string | null | undefined;
    if (req.body.codeTemplates !== undefined) {
      codeTemplates = req.body.codeTemplates && Object.keys(req.body.codeTemplates).length > 0
        ? JSON.stringify(req.body.codeTemplates)
        : null;
    }

    const updated = await prisma.codingQuestion.update({
      where: { id: questionId },
      data: {
        ...(title !== undefined && { title: sanitizeInput(title) }),
        ...(description !== undefined && { description: sanitizeInput(description) }),
        ...(inputFormat !== undefined && { inputFormat: sanitizeInput(inputFormat) }),
        ...(outputFormat !== undefined && { outputFormat: sanitizeInput(outputFormat) }),
        ...(sampleInput !== undefined && { sampleInput }),
        ...(sampleOutput !== undefined && { sampleOutput }),
        ...(constraints !== undefined && { constraints }),
        ...(marks !== undefined && { marks }),
        ...(difficulty !== undefined && { difficulty }),
        ...(topic !== undefined && { topic: sanitizeInput(topic) }),
        ...(parsedTags !== null && { tags: JSON.stringify(parsedTags) }),
        ...(supportedLanguages !== undefined && { supportedLanguages }),
        ...(codeTemplates !== undefined && { codeTemplates }),
        ...(timeLimit !== undefined && Number.isFinite(timeLimit) && { timeLimit }),
        ...(memoryLimit !== undefined && Number.isFinite(memoryLimit) && { memoryLimit }),
        ...(partialScoring !== undefined && { partialScoring }),
      }
    });

    res.json({ message: 'Coding question updated successfully', question: serializeCodingQuestion(updated) });
  } catch (error) {
    console.error(`Update ${sourceLabel} coding error:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateBehavioralBySource(
  req: AuthenticatedRequest,
  res: Response,
  expectedSource: QuestionSource,
  sourceLabel: string
) {
  try {
    const { questionId } = req.params;

    const existing = await prisma.behavioralQuestion.findUnique({ where: { id: questionId } });
    if (!existing) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }
    if (existing.source !== expectedSource) {
      res.status(400).json({ error: `Only ${sourceLabel} questions can be edited from this endpoint.` });
      return;
    }
    if (!isOwnedByRequester(existing, req.admin!.id)) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const title = toStringOrUndefined(req.body.title);
    const description = toStringOrUndefined(req.body.description);
    const expectedAnswer = toStringOrUndefined(req.body.expectedAnswer);
    const topic = toStringOrUndefined(req.body.topic);
    const difficulty = parseDifficulty(req.body.difficulty);
    const parsedTags = parseTagsInput(req.body.tags);
    const marks = req.body.marks !== undefined ? Number.parseInt(String(req.body.marks), 10) : undefined;

    if (marks !== undefined && (!Number.isFinite(marks) || marks < 1)) {
      res.status(400).json({ error: 'Marks must be a positive integer.' });
      return;
    }

    const updated = await prisma.behavioralQuestion.update({
      where: { id: questionId },
      data: {
        ...(title !== undefined && { title: sanitizeInput(title) }),
        ...(description !== undefined && { description: sanitizeInput(description) }),
        ...(expectedAnswer !== undefined && { expectedAnswer: sanitizeInput(expectedAnswer) }),
        ...(marks !== undefined && { marks }),
        ...(difficulty !== undefined && { difficulty }),
        ...(topic !== undefined && { topic: sanitizeInput(topic) }),
        ...(parsedTags !== null && { tags: JSON.stringify(parsedTags) })
      }
    });

    res.json({ message: 'Behavioral question updated successfully', question: serializeBehavioralQuestion(updated) });
  } catch (error) {
    console.error(`Update ${sourceLabel} behavioral error:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateCustomMCQ(req: AuthenticatedRequest, res: Response) {
  return updateMCQBySource(req, res, QuestionSource.CUSTOM, 'custom');
}

export async function updateCustomCoding(req: AuthenticatedRequest, res: Response) {
  return updateCodingBySource(req, res, QuestionSource.CUSTOM, 'custom');
}

export async function updateCustomBehavioral(req: AuthenticatedRequest, res: Response) {
  return updateBehavioralBySource(req, res, QuestionSource.CUSTOM, 'custom');
}

export async function updateQuestionBankMCQ(req: AuthenticatedRequest, res: Response) {
  return updateMCQBySource(req, res, QuestionSource.QUESTION_BANK, 'question bank');
}

export async function updateQuestionBankCoding(req: AuthenticatedRequest, res: Response) {
  return updateCodingBySource(req, res, QuestionSource.QUESTION_BANK, 'question bank');
}

export async function updateQuestionBankBehavioral(req: AuthenticatedRequest, res: Response) {
  return updateBehavioralBySource(req, res, QuestionSource.QUESTION_BANK, 'question bank');
}

// ==========================================
// WRAPPERS FOR CUSTOM CREATION
// ==========================================
export async function createCustomMCQ(req: AuthenticatedRequest, res: Response) {
  req.body.source = QuestionSource.CUSTOM;
  return createMCQQuestion(req, res);
}

export async function createCustomCoding(req: AuthenticatedRequest, res: Response) {
  req.body.source = QuestionSource.CUSTOM;
  return createCodingQuestion(req, res);
}

export async function createCustomBehavioral(req: AuthenticatedRequest, res: Response) {
  try {
    const title = toStringOrUndefined(req.body.title);
    const description = toStringOrUndefined(req.body.description);
    const questionText = toStringOrUndefined(req.body.questionText);
    const expectedAnswer = toStringOrUndefined(req.body.expectedAnswer);
    const topic = toStringOrUndefined(req.body.topic);
    const difficulty = parseDifficulty(req.body.difficulty) ?? 'medium';
    const parsedTags = parseTagsInput(req.body.tags);
    const marks = Number.parseInt(String(req.body.marks ?? ''), 10);

    if (!title && !questionText) {
      res.status(400).json({ error: 'Title is required.' });
      return;
    }

    if (!description && !questionText) {
      res.status(400).json({ error: 'Description is required.' });
      return;
    }

    if (!Number.isFinite(marks) || marks < 1) {
      res.status(400).json({ error: 'Marks must be a positive integer.' });
      return;
    }

    const question = await prisma.behavioralQuestion.create({
      data: {
        title: sanitizeInput(title ?? questionText ?? ''),
        description: sanitizeInput(description ?? questionText ?? ''),
        expectedAnswer: expectedAnswer ? sanitizeInput(expectedAnswer) : null,
        marks,
        difficulty,
        topic: topic ? sanitizeInput(topic) : null,
        tags: parsedTags ? JSON.stringify(parsedTags) : null,
        source: QuestionSource.CUSTOM,
        repositoryCategory: QuestionRepositoryCategory.BEHAVIORAL,
        isEnabled: true,
        adminId: req.admin!.id
      }
    });

    res.status(201).json({
      message: 'Behavioral question created successfully',
      question: serializeBehavioralQuestion(question)
    });
  } catch (error) {
    console.error('Create behavioral question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createCustomCommunication(req: AuthenticatedRequest, res: Response) {
  req.body.source = QuestionSource.CUSTOM;
  return createCommunicationQuestion(req, res);
}

// Partial update across whichever fields the request body includes — only the fields relevant to
// the question's own subType are ever read (a Written question's request can't accidentally set
// Listening-only guardrail fields, since those keys are simply never inspected for that subType).
async function updateCommunicationBySource(
  req: AuthenticatedRequest,
  res: Response,
  expectedSource: QuestionSource,
  sourceLabel: string
) {
  try {
    const { questionId } = req.params;

    const existing = await prisma.communicationQuestion.findUnique({ where: { id: questionId } });
    if (!existing) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }
    if (existing.source !== expectedSource) {
      res.status(400).json({ error: `Only ${sourceLabel} questions can be edited from this endpoint.` });
      return;
    }
    if (!isOwnedByRequester(existing, req.admin!.id)) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const title = toStringOrUndefined(req.body.title);
    const description = req.body.description !== undefined ? (req.body.description ? String(req.body.description) : null) : undefined;
    const topic = toStringOrUndefined(req.body.topic);
    const difficulty = parseDifficulty(req.body.difficulty);
    const parsedTags = parseTagsInput(req.body.tags);
    const marks = req.body.marks !== undefined ? Number.parseInt(String(req.body.marks), 10) : undefined;

    if (marks !== undefined && (!Number.isFinite(marks) || marks < 1)) {
      res.status(400).json({ error: 'Marks must be a positive integer.' });
      return;
    }

    const data: Prisma.CommunicationQuestionUpdateInput = {
      ...(title !== undefined && { title: sanitizeInput(title) }),
      ...(description !== undefined && { description: description ? sanitizeInput(description) : null }),
      ...(marks !== undefined && { marks }),
      ...(difficulty !== undefined && { difficulty }),
      ...(topic !== undefined && { topic: sanitizeInput(topic) }),
      ...(parsedTags !== null && { tags: JSON.stringify(parsedTags) })
    };

    if (existing.subType === 'WRITTEN') {
      if (req.body.stimulusType !== undefined && ['NONE', 'IMAGE', 'AUDIO'].includes(req.body.stimulusType)) {
        data.stimulusType = req.body.stimulusType;
      }
      const evaluationNotes = toStringOrUndefined(req.body.evaluationNotes);
      if (evaluationNotes !== undefined) data.evaluationNotes = sanitizeInput(evaluationNotes);
    }

    if (existing.subType === 'LISTENING' || existing.subType === 'READING') {
      if (Array.isArray(req.body.options)) {
        const filtered = (req.body.options as unknown[])
          .filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
          .map(o => sanitizeInput(o));
        if (filtered.length < 2) {
          res.status(400).json({ error: 'At least 2 options are required.' });
          return;
        }
        data.options = JSON.stringify(filtered);
      }
      if (Array.isArray(req.body.correctAnswers)) {
        data.correctAnswers = JSON.stringify(req.body.correctAnswers);
      }
      const explanation = toStringOrUndefined(req.body.explanation);
      if (explanation !== undefined) data.explanation = sanitizeInput(explanation);
      if (req.body.isMultipleChoice !== undefined) data.isMultipleChoice = Boolean(req.body.isMultipleChoice);
    }

    if (existing.subType === 'READING' && typeof req.body.passageId === 'string' && req.body.passageId.trim()) {
      const passage = await prisma.readingPassage.findUnique({ where: { id: req.body.passageId.trim() } });
      if (!passage) {
        res.status(400).json({ error: 'Reading passage not found.' });
        return;
      }
      data.passage = { connect: { id: passage.id } };
    }

    if (existing.subType === 'LISTENING') {
      if (req.body.replayLimit !== undefined && Number.isFinite(Number(req.body.replayLimit))) {
        data.replayLimit = Math.max(1, Math.floor(Number(req.body.replayLimit)));
      }
      if (req.body.allowRewind !== undefined) data.allowRewind = Boolean(req.body.allowRewind);
      if (req.body.allowSpeedChange !== undefined) data.allowSpeedChange = Boolean(req.body.allowSpeedChange);
      if (req.body.fixedPlaybackSpeed !== undefined && Number.isFinite(Number(req.body.fixedPlaybackSpeed))) {
        data.fixedPlaybackSpeed = Number(req.body.fixedPlaybackSpeed);
      }
    }

    if (existing.subType === 'SPEAKING') {
      if (req.body.recordingTimeLimit !== undefined && Number.isFinite(Number(req.body.recordingTimeLimit))) {
        data.recordingTimeLimit = Math.min(MAX_RECORDING_TIME_LIMIT_SEC, Math.max(10, Math.floor(Number(req.body.recordingTimeLimit))));
      }
      if (req.body.retakeLimit !== undefined) {
        data.retakeLimit = req.body.retakeLimit === null || req.body.retakeLimit === ''
          ? null
          : (Number.isFinite(Number(req.body.retakeLimit)) ? Math.max(1, Math.floor(Number(req.body.retakeLimit))) : null);
      }
      const evaluationNotes = toStringOrUndefined(req.body.evaluationNotes);
      if (evaluationNotes !== undefined) data.evaluationNotes = sanitizeInput(evaluationNotes);
    }

    const updated = await prisma.communicationQuestion.update({ where: { id: questionId }, data });

    res.json({ message: 'Communication question updated successfully', question: serializeCommunicationQuestion(updated) });
  } catch (error) {
    console.error(`Update ${sourceLabel} communication error:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateCustomCommunication(req: AuthenticatedRequest, res: Response) {
  return updateCommunicationBySource(req, res, QuestionSource.CUSTOM, 'custom');
}

export async function updateQuestionBankCommunication(req: AuthenticatedRequest, res: Response) {
  return updateCommunicationBySource(req, res, QuestionSource.QUESTION_BANK, 'question bank');
}
