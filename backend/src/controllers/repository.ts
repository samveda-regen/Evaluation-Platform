import { Prisma, QuestionRepositoryCategory, QuestionSource } from '@prisma/client';
import { Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import prisma from '../utils/db.js';
import { sanitizeInput } from '../utils/sanitize.js';
import { createMCQQuestion } from './mcqQuestion.js';
import { createCodingQuestion } from './codingQuestion.js';

type RepositoryCategory = 'MCQ' | 'CODING' | 'BEHAVIORAL';
type Difficulty = 'easy' | 'medium' | 'hard';

const VALID_CATEGORIES: RepositoryCategory[] = ['MCQ', 'CODING', 'BEHAVIORAL'];
const VALID_DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const TEST_SCOPED_TAG_MARKER = '"__test_scoped__"';

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
      res.status(400).json({ error: 'Invalid category. Use MCQ, CODING, or BEHAVIORAL.' });
      return;
    }

    switch (category) {
      case 'MCQ': {
        const where: Prisma.MCQQuestionWhereInput = {
          source,
          AND: [
            {
              NOT: {
                tags: { contains: TEST_SCOPED_TAG_MARKER }
              }
            }
          ]
        };
        if (difficulty) where.difficulty = difficulty;
        if (topic) where.topic = { contains: topic, mode: 'insensitive' };
        if (tag) where.tags = { contains: tag, mode: 'insensitive' };
        if (enabled !== undefined) where.isEnabled = enabled;
        if (search) where.questionText = { contains: search, mode: 'insensitive' };

        const [questions, total] = await Promise.all([
          prisma.mCQQuestion.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' }
          }),
          prisma.mCQQuestion.count({ where })
        ]);

        res.json({
          questions: questions.map(serializeMCQQuestion),
          pagination: buildPagination(page, limit, total)
        });
        return;
      }

      case 'CODING': {
        const where: Prisma.CodingQuestionWhereInput = {
          source,
          AND: [
            {
              NOT: {
                tags: { contains: TEST_SCOPED_TAG_MARKER }
              }
            }
          ]
        };
        if (difficulty) where.difficulty = difficulty;
        if (topic) where.topic = { contains: topic, mode: 'insensitive' };
        if (tag) where.tags = { contains: tag, mode: 'insensitive' };
        if (enabled !== undefined) where.isEnabled = enabled;
        if (search) {
          where.OR = [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } }
          ];
        }

        const [questions, total] = await Promise.all([
          prisma.codingQuestion.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' }
          }),
          prisma.codingQuestion.count({ where })
        ]);

        res.json({
          questions: questions.map(serializeCodingQuestion),
          pagination: buildPagination(page, limit, total)
        });
        return;
      }

      case 'BEHAVIORAL': {
        const where: Prisma.BehavioralQuestionWhereInput = {
          source,
          AND: [
            {
              NOT: {
                tags: { contains: TEST_SCOPED_TAG_MARKER }
              }
            }
          ]
        };
        if (difficulty) where.difficulty = difficulty;
        if (topic) where.topic = { contains: topic, mode: 'insensitive' };
        if (tag) where.tags = { contains: tag, mode: 'insensitive' };
        if (enabled !== undefined) where.isEnabled = enabled;
        if (search) {
          where.OR = [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { expectedAnswer: { contains: search, mode: 'insensitive' } }
          ];
        }

        const [questions, total] = await Promise.all([
          prisma.behavioralQuestion.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' }
          }),
          prisma.behavioralQuestion.count({ where })
        ]);

        res.json({
          questions: questions.map(serializeBehavioralQuestion),
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
      res.status(400).json({ error: 'Invalid category. Use MCQ, CODING, or BEHAVIORAL.' });
      return;
    }

    switch (category) {
      case 'MCQ': {
        const existing = await prisma.mCQQuestion.findUnique({ where: { id: questionId } });
        if (!existing) {
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
        if (!existing) {
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
        if (!existing) {
          res.status(404).json({ error: 'Question not found' });
          return;
        }

        await prisma.behavioralQuestion.update({
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
      res.status(400).json({ error: 'Invalid category. Use MCQ, CODING, or BEHAVIORAL.' });
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

        const inTest = await prisma.testQuestion.findFirst({
          where: { behavioralQuestionId: questionId }
        });
        if (inTest) {
          res.status(400).json({ error: 'Question is used in a test and cannot be deleted.' });
          return;
        }

        await prisma.behavioralQuestion.delete({ where: { id: questionId } });
      }
    }

    res.json({ message: 'Question deleted successfully' });
  } catch (error) {
    console.error('Delete repository question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
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
        isEnabled: true
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
