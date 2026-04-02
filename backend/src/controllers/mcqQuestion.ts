import { Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { sanitizeInput } from '../utils/sanitize.js';
import prisma from '../utils/db.js';

const TEST_SCOPED_TAG_MARKER = '"__test_scoped__"';

export async function createMCQQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const {
      questionText,
      options,
      correctAnswers,
      marks,
      isMultipleChoice,
      explanation,
      difficulty,
      topic,
      tags
    } = req.body;

    // Validate options are unique
    const uniqueOptions = new Set(options.map((o: string) => o.toLowerCase().trim()));
    if (uniqueOptions.size !== options.length) {
      res.status(400).json({ error: 'Options must be unique' });
      return;
    }

    // Validate correct answers are valid indices
    const validIndices = correctAnswers.every(
      (idx: number) => idx >= 0 && idx < options.length
    );
    if (!validIndices) {
      res.status(400).json({ error: 'Invalid correct answer indices' });
      return;
    }

    // Validate difficulty if provided
    if (difficulty && !['easy', 'medium', 'hard'].includes(difficulty)) {
      res.status(400).json({ error: 'Invalid difficulty level. Use: easy, medium, or hard' });
      return;
    }

    const question = await prisma.mCQQuestion.create({
      data: {
        questionText: sanitizeInput(questionText),
        options: JSON.stringify(options.map((o: string) => sanitizeInput(o))),
        correctAnswers: JSON.stringify(correctAnswers),
        marks: parseInt(marks),
        isMultipleChoice: isMultipleChoice || correctAnswers.length > 1,
        explanation: explanation ? sanitizeInput(explanation) : null,
        difficulty: difficulty || 'medium',
        topic: topic ? sanitizeInput(topic) : null,
        tags: tags ? JSON.stringify(tags) : null,
        adminId: req.admin!.id
      }
    });

    res.status(201).json({
      message: 'MCQ question created successfully',
      question: {
        ...question,
        options: JSON.parse(question.options),
        correctAnswers: JSON.parse(question.correctAnswers),
        tags: question.tags ? JSON.parse(question.tags) : []
      }
    });
  } catch (error) {
    console.error('Create MCQ question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getMCQQuestions(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search as string;

    const where = {
      OR: [{ adminId: req.admin!.id }, { adminId: null }],
      ...(search ? { questionText: { contains: search } } : {}),
      NOT: { tags: { contains: TEST_SCOPED_TAG_MARKER } }
    };

    const [questions, total] = await Promise.all([
      prisma.mCQQuestion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          mediaAssets: true
        }
      }),
      prisma.mCQQuestion.count({ where })
    ]);

    res.json({
      questions: questions.map((q: typeof questions[number]) => ({
        ...q,
        options: JSON.parse(q.options),
        correctAnswers: JSON.parse(q.correctAnswers),
        tags: q.tags ? JSON.parse(q.tags) : []
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get MCQ questions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getMCQQuestionById(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { questionId } = req.params;

    const question = await prisma.mCQQuestion.findFirst({
      where: { id: questionId, OR: [{ adminId: req.admin!.id }, { adminId: null }] },
      include: {
        mediaAssets: true
      }
    });

    if (!question) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    res.json({
      question: {
        ...question,
        options: JSON.parse(question.options),
        correctAnswers: JSON.parse(question.correctAnswers),
        tags: question.tags ? JSON.parse(question.tags) : []
      }
    });
  } catch (error) {
    console.error('Get MCQ question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateMCQQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { questionId } = req.params;
    const updates = req.body;

    const question = await prisma.mCQQuestion.findFirst({
      where: { id: questionId, OR: [{ adminId: req.admin!.id }, { adminId: null }] }
    });

    if (!question) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const updateData: Record<string, unknown> = {};

    if (updates.questionText) {
      updateData.questionText = sanitizeInput(updates.questionText);
    }

    if (updates.options) {
      const uniqueOptions = new Set(updates.options.map((o: string) => o.toLowerCase().trim()));
      if (uniqueOptions.size !== updates.options.length) {
        res.status(400).json({ error: 'Options must be unique' });
        return;
      }
      updateData.options = JSON.stringify(updates.options.map((o: string) => sanitizeInput(o)));
    }

    if (updates.correctAnswers) {
      const options = updates.options || JSON.parse(question.options);
      const validIndices = updates.correctAnswers.every(
        (idx: number) => idx >= 0 && idx < options.length
      );
      if (!validIndices) {
        res.status(400).json({ error: 'Invalid correct answer indices' });
        return;
      }
      updateData.correctAnswers = JSON.stringify(updates.correctAnswers);
      updateData.isMultipleChoice = updates.isMultipleChoice ?? updates.correctAnswers.length > 1;
    }

    if (updates.marks) {
      updateData.marks = parseInt(updates.marks);
    }

    if (updates.explanation !== undefined) {
      updateData.explanation = updates.explanation ? sanitizeInput(updates.explanation) : null;
    }

    if (updates.difficulty !== undefined) {
      if (updates.difficulty && !['easy', 'medium', 'hard'].includes(updates.difficulty)) {
        res.status(400).json({ error: 'Invalid difficulty level. Use: easy, medium, or hard' });
        return;
      }
      updateData.difficulty = updates.difficulty || 'medium';
    }

    if (updates.topic !== undefined) {
      updateData.topic = updates.topic ? sanitizeInput(updates.topic) : null;
    }

    if (updates.tags !== undefined) {
      updateData.tags = updates.tags ? JSON.stringify(updates.tags) : null;
    }

    const updatedQuestion = await prisma.mCQQuestion.update({
      where: { id: questionId },
      data: updateData
    });

    res.json({
      message: 'Question updated successfully',
      question: {
        ...updatedQuestion,
        options: JSON.parse(updatedQuestion.options),
        correctAnswers: JSON.parse(updatedQuestion.correctAnswers),
        tags: updatedQuestion.tags ? JSON.parse(updatedQuestion.tags) : []
      }
    });
  } catch (error) {
    console.error('Update MCQ question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteMCQQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { questionId } = req.params;

    const question = await prisma.mCQQuestion.findFirst({
      where: { id: questionId, OR: [{ adminId: req.admin!.id }, { adminId: null }] }
    });

    if (!question) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    // Check if question is used in any test
    const testQuestion = await prisma.testQuestion.findFirst({
      where: { mcqQuestionId: questionId }
    });

    if (testQuestion) {
      res.status(400).json({ error: 'Question is used in a test and cannot be deleted' });
      return;
    }

    await prisma.mCQQuestion.delete({
      where: { id: questionId }
    });

    res.json({ message: 'Question deleted successfully' });
  } catch (error) {
    console.error('Delete MCQ question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
