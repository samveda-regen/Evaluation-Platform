import { Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import {
  generateTestFromJobProfile,
  createTestFromSelection,
  analyzeJobRequirements,
  suggestQuestionTags
} from '../services/testAgentService.js';

// POST /admin/agent/analyze-job
export const analyzeJob = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { jobTitle, jobDescription } = req.body;

    if (!jobTitle) {
      return res.status(400).json({ error: 'Job title is required' });
    }

    const analysis = await analyzeJobRequirements(jobTitle, jobDescription);

    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    console.error('Error analyzing job:', error);
    res.status(500).json({
      error: 'Failed to analyze job requirements',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// POST /admin/agent/generate-test
export const generateTest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminId = req.admin?.id;
    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      jobProfile,
      skills,
      difficulty,
      mcqCount,
      codingCount,
      duration
    } = req.body;

    // Validation
    if (!jobProfile?.title) {
      return res.status(400).json({ error: 'Job profile with title is required' });
    }
    if (!skills || !Array.isArray(skills) || skills.length === 0) {
      return res.status(400).json({ error: 'At least one skill is required' });
    }
    if (!difficulty || !['easy', 'medium', 'hard', 'mixed'].includes(difficulty)) {
      return res.status(400).json({ error: 'Valid difficulty level is required (easy, medium, hard, mixed)' });
    }
    if (typeof mcqCount !== 'number' || mcqCount < 0) {
      return res.status(400).json({ error: 'Valid MCQ count is required' });
    }
    if (typeof codingCount !== 'number' || codingCount < 0) {
      return res.status(400).json({ error: 'Valid coding question count is required' });
    }
    if (mcqCount === 0 && codingCount === 0) {
      return res.status(400).json({ error: 'At least one question is required' });
    }

    const selection = await generateTestFromJobProfile(
      {
        jobProfile,
        skills,
        difficulty,
        mcqCount,
        codingCount,
        duration
      },
      adminId
    );

    res.json({
      success: true,
      data: selection
    });
  } catch (error) {
    console.error('Error generating test:', error);
    res.status(500).json({
      error: 'Failed to generate test',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// POST /admin/agent/create-test
export const createTestFromAgent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminId = req.admin?.id;
    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      selection,
      testSettings
    } = req.body;

    // Validation
    if (!selection) {
      return res.status(400).json({ error: 'Question selection is required' });
    }
    if (!selection.mcqQuestionIds && !selection.codingQuestionIds) {
      return res.status(400).json({ error: 'At least one question must be selected' });
    }
    if (!testSettings?.startTime) {
      return res.status(400).json({ error: 'Test start time is required' });
    }

    const result = await createTestFromSelection(
      adminId,
      {
        mcqQuestionIds: selection.mcqQuestionIds || [],
        codingQuestionIds: selection.codingQuestionIds || [],
        reasoning: selection.reasoning || '',
        suggestedDuration: selection.suggestedDuration || 60,
        suggestedTestName: selection.suggestedTestName || 'AI Generated Test',
        suggestedDescription: selection.suggestedDescription || ''
      },
      {
        name: testSettings.name,
        description: testSettings.description,
        duration: testSettings.duration,
        startTime: new Date(testSettings.startTime),
        endTime: testSettings.endTime ? new Date(testSettings.endTime) : undefined,
        passingMarks: testSettings.passingMarks,
        negativeMarking: testSettings.negativeMarking,
        shuffleQuestions: testSettings.shuffleQuestions,
        shuffleOptions: testSettings.shuffleOptions,
        maxViolations: testSettings.maxViolations
      }
    );

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error creating test from agent:', error);
    res.status(500).json({
      error: 'Failed to create test',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// POST /admin/agent/suggest-tags
export const suggestTags = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { questionText, questionType } = req.body;

    if (!questionText) {
      return res.status(400).json({ error: 'Question text is required' });
    }
    if (!questionType || !['mcq', 'coding'].includes(questionType)) {
      return res.status(400).json({ error: 'Valid question type is required (mcq or coding)' });
    }

    const suggestions = await suggestQuestionTags(questionText, questionType);

    res.json({
      success: true,
      data: suggestions
    });
  } catch (error) {
    console.error('Error suggesting tags:', error);
    res.status(500).json({
      error: 'Failed to suggest tags',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
