import { Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import prisma from '../utils/db.js';

const TEST_SCOPED_TAG_MARKER = '"__test_scoped__"';

function parseTags(tags: string | null): string[] {
  if (!tags) {
    return [];
  }

  try {
    const parsed = JSON.parse(tags) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export async function getBehavioralQuestions(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const page = Number.parseInt(req.query.page as string, 10) || 1;
    const limit = Number.parseInt(req.query.limit as string, 10) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search as string | undefined;

    const where = search
      ? {
          OR: [
            { title: { contains: search } },
            { description: { contains: search } },
            { expectedAnswer: { contains: search } }
          ],
          NOT: { tags: { contains: TEST_SCOPED_TAG_MARKER } }
        }
      : {
          NOT: { tags: { contains: TEST_SCOPED_TAG_MARKER } }
        };

    const [questions, total] = await Promise.all([
      prisma.behavioralQuestion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.behavioralQuestion.count({ where })
    ]);

    res.json({
      questions: questions.map((question: typeof questions[number]) => ({
        ...question,
        tags: parseTags(question.tags)
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get behavioral questions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
