import { Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { sanitizeInput } from '../utils/sanitize.js';
import prisma from '../utils/db.js';

const TEST_SCOPED_TAG_MARKER = '"__test_scoped__"';

interface TestCaseInput {
  input: string;
  expectedOutput: string;
  isHidden?: boolean;
  marks?: number;
}

export async function createCodingQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const {
      title,
      description,
      inputFormat,
      outputFormat,
      constraints,
      sampleInput,
      sampleOutput,
      marks,
      timeLimit,
      memoryLimit,
      supportedLanguages,
      codeTemplates,
      partialScoring,
      testCases,
      difficulty,
      topic,
      tags
    } = req.body;

    // Validate difficulty if provided
    if (difficulty && !['easy', 'medium', 'hard'].includes(difficulty)) {
      res.status(400).json({ error: 'Invalid difficulty level. Use: easy, medium, or hard' });
      return;
    }

    const question = await prisma.codingQuestion.create({
      data: {
        title: sanitizeInput(title),
        description: sanitizeInput(description),
        inputFormat: sanitizeInput(inputFormat),
        outputFormat: sanitizeInput(outputFormat),
        constraints: constraints ? sanitizeInput(constraints) : null,
        sampleInput: sampleInput,
        sampleOutput: sampleOutput,
        marks: parseInt(marks),
        timeLimit: timeLimit || 2000,
        memoryLimit: memoryLimit || 256,
        supportedLanguages: JSON.stringify(supportedLanguages),
        codeTemplates: codeTemplates ? JSON.stringify(codeTemplates) : null,
        partialScoring: partialScoring || false,
        difficulty: difficulty || 'medium',
        topic: topic ? sanitizeInput(topic) : null,
        tags: tags ? JSON.stringify(tags) : null,
        adminId: req.admin!.id,
        testCases: {
          create: testCases.map((tc: TestCaseInput) => ({
            input: tc.input,
            expectedOutput: tc.expectedOutput,
            isHidden: tc.isHidden || false,
            marks: tc.marks || 0
          }))
        }
      },
      include: {
        testCases: true
      }
    });

    res.status(201).json({
      message: 'Coding question created successfully',
      question: {
        ...question,
        supportedLanguages: JSON.parse(question.supportedLanguages),
        codeTemplates: question.codeTemplates ? JSON.parse(question.codeTemplates) : null,
        tags: question.tags ? JSON.parse(question.tags) : []
      }
    });
  } catch (error) {
    console.error('Create coding question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getCodingQuestions(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search as string;

    const where = {
      OR: [{ adminId: req.admin!.id }, { adminId: null }],
      ...(search ? { title: { contains: search } } : {}),
      NOT: { tags: { contains: TEST_SCOPED_TAG_MARKER } }
    };

    const [questions, total] = await Promise.all([
      prisma.codingQuestion.findMany({
        where,
        include: {
          _count: { select: { testCases: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.codingQuestion.count({ where })
    ]);

    res.json({
      questions: questions.map((q: typeof questions[number]) => ({
        ...q,
        supportedLanguages: JSON.parse(q.supportedLanguages),
        codeTemplates: q.codeTemplates ? JSON.parse(q.codeTemplates) : null,
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
    console.error('Get coding questions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getCodingQuestionById(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { questionId } = req.params;

    const question = await prisma.codingQuestion.findFirst({
      where: { id: questionId, OR: [{ adminId: req.admin!.id }, { adminId: null }] },
      include: {
        testCases: true
      }
    });

    if (!question) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    res.json({
      question: {
        ...question,
        supportedLanguages: JSON.parse(question.supportedLanguages),
        codeTemplates: question.codeTemplates ? JSON.parse(question.codeTemplates) : null,
        tags: question.tags ? JSON.parse(question.tags) : []
      }
    });
  } catch (error) {
    console.error('Get coding question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateCodingQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { questionId } = req.params;
    const updates = req.body;

    const question = await prisma.codingQuestion.findFirst({
      where: { id: questionId, OR: [{ adminId: req.admin!.id }, { adminId: null }] }
    });

    if (!question) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const updateData: Record<string, unknown> = {};

    if (updates.title) updateData.title = sanitizeInput(updates.title);
    if (updates.description) updateData.description = sanitizeInput(updates.description);
    if (updates.inputFormat) updateData.inputFormat = sanitizeInput(updates.inputFormat);
    if (updates.outputFormat) updateData.outputFormat = sanitizeInput(updates.outputFormat);
    if (updates.constraints !== undefined) updateData.constraints = updates.constraints ? sanitizeInput(updates.constraints) : null;
    if (updates.sampleInput !== undefined) updateData.sampleInput = updates.sampleInput;
    if (updates.sampleOutput !== undefined) updateData.sampleOutput = updates.sampleOutput;
    if (updates.marks) updateData.marks = parseInt(updates.marks);
    if (updates.timeLimit) updateData.timeLimit = parseInt(updates.timeLimit);
    if (updates.memoryLimit) updateData.memoryLimit = parseInt(updates.memoryLimit);
    if (updates.supportedLanguages) updateData.supportedLanguages = JSON.stringify(updates.supportedLanguages);
    if (updates.codeTemplates !== undefined) updateData.codeTemplates = updates.codeTemplates ? JSON.stringify(updates.codeTemplates) : null;
    if (updates.partialScoring !== undefined) updateData.partialScoring = updates.partialScoring;

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

    const updatedQuestion = await prisma.codingQuestion.update({
      where: { id: questionId },
      data: updateData,
      include: { testCases: true }
    });

    res.json({
      message: 'Question updated successfully',
      question: {
        ...updatedQuestion,
        supportedLanguages: JSON.parse(updatedQuestion.supportedLanguages),
        codeTemplates: updatedQuestion.codeTemplates ? JSON.parse(updatedQuestion.codeTemplates) : null,
        tags: updatedQuestion.tags ? JSON.parse(updatedQuestion.tags) : []
      }
    });
  } catch (error) {
    console.error('Update coding question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteCodingQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { questionId } = req.params;

    const question = await prisma.codingQuestion.findFirst({
      where: { id: questionId, OR: [{ adminId: req.admin!.id }, { adminId: null }] }
    });

    if (!question) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    // Check if question is used in any test
    const testQuestion = await prisma.testQuestion.findFirst({
      where: { codingQuestionId: questionId }
    });

    if (testQuestion) {
      res.status(400).json({ error: 'Question is used in a test and cannot be deleted' });
      return;
    }

    await prisma.codingQuestion.delete({
      where: { id: questionId }
    });

    res.json({ message: 'Question deleted successfully' });
  } catch (error) {
    console.error('Delete coding question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function addTestCase(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { questionId } = req.params;
    const { input, expectedOutput, isHidden, marks } = req.body;

    const question = await prisma.codingQuestion.findFirst({
      where: { id: questionId, OR: [{ adminId: req.admin!.id }, { adminId: null }] }
    });

    if (!question) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const testCase = await prisma.testCase.create({
      data: {
        questionId,
        input,
        expectedOutput,
        isHidden: isHidden || false,
        marks: marks || 0
      }
    });

    res.status(201).json({
      message: 'Test case added successfully',
      testCase
    });
  } catch (error) {
    console.error('Add test case error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateTestCase(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testCaseId } = req.params;
    const updates = req.body;

    const testCase = await prisma.testCase.findUnique({
      where: { id: testCaseId },
      include: {
        question: {
          select: { adminId: true }
        }
      }
    });

    if (!testCase || (testCase.question.adminId && testCase.question.adminId !== req.admin!.id)) {
      res.status(404).json({ error: 'Test case not found' });
      return;
    }

    const updatedTestCase = await prisma.testCase.update({
      where: { id: testCaseId },
      data: {
        input: updates.input ?? testCase.input,
        expectedOutput: updates.expectedOutput ?? testCase.expectedOutput,
        isHidden: updates.isHidden ?? testCase.isHidden,
        marks: updates.marks ?? testCase.marks
      }
    });

    res.json({
      message: 'Test case updated successfully',
      testCase: updatedTestCase
    });
  } catch (error) {
    console.error('Update test case error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteTestCase(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testCaseId } = req.params;

    const testCase = await prisma.testCase.findUnique({
      where: { id: testCaseId },
      include: {
        question: {
          select: { adminId: true }
        }
      }
    });

    if (!testCase || (testCase.question.adminId && testCase.question.adminId !== req.admin!.id)) {
      res.status(404).json({ error: 'Test case not found' });
      return;
    }

    await prisma.testCase.delete({
      where: { id: testCaseId }
    });

    res.json({ message: 'Test case deleted successfully' });
  } catch (error) {
    console.error('Delete test case error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
