import { Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import {
  generateTestFromJobProfile,
  createTestFromSelection,
  analyzeJobRequirements,
  suggestQuestionTags,
  suggestNewQuestions,
  getLibrarySkillTags,
  getQuestionDetailsForReview
} from '../services/testAgentService.js';
import prisma from '../utils/db.js';

// GET /admin/agent/library-skills
export const getLibrarySkills = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const skills = await getLibrarySkillTags();
    res.json({ success: true, data: { skills } });
  } catch (error) {
    console.error('Error fetching library skills:', error);
    res.status(500).json({
      error: 'Failed to fetch library skills',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// POST /admin/agent/analyze-job
export const analyzeJob = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { jobTitle, jobDescription, experience } = req.body;

    if (!jobTitle) {
      return res.status(400).json({ error: 'Job title is required' });
    }

    const analysis = await analyzeJobRequirements(jobTitle, jobDescription, experience);

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
      behavioralCount,
      writtenCount,
      readingCount,
      speakingCount,
      duration
    } = req.body;

    const resolvedBehavioralCount = typeof behavioralCount === 'number' ? behavioralCount : 0;
    const resolvedWrittenCount = typeof writtenCount === 'number' ? writtenCount : 0;
    const resolvedReadingCount = typeof readingCount === 'number' ? readingCount : 0;
    const resolvedSpeakingCount = typeof speakingCount === 'number' ? speakingCount : 0;

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
    if (resolvedBehavioralCount < 0) {
      return res.status(400).json({ error: 'Valid behavioral question count is required' });
    }
    if (resolvedWrittenCount < 0 || resolvedReadingCount < 0 || resolvedSpeakingCount < 0) {
      return res.status(400).json({ error: 'Valid Communication question counts are required' });
    }
    if (mcqCount === 0 && codingCount === 0 && resolvedBehavioralCount === 0
      && resolvedWrittenCount === 0 && resolvedReadingCount === 0 && resolvedSpeakingCount === 0) {
      return res.status(400).json({ error: 'At least one question is required' });
    }

    const selection = await generateTestFromJobProfile(
      {
        jobProfile,
        skills,
        difficulty,
        mcqCount,
        codingCount,
        behavioralCount: resolvedBehavioralCount,
        writtenCount: resolvedWrittenCount,
        readingCount: resolvedReadingCount,
        speakingCount: resolvedSpeakingCount,
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
    if (!selection.mcqQuestionIds && !selection.codingQuestionIds && !selection.behavioralQuestionIds
      && !selection.writtenQuestionIds && !selection.readingQuestionIds && !selection.speakingQuestionIds) {
      return res.status(400).json({ error: 'At least one question must be selected' });
    }
    if (!testSettings?.startTime) {
      return res.status(400).json({ error: 'Test start time is required' });
    }

    const adminRecord = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { companyId: true }
    });

    const result = await createTestFromSelection(
      adminId,
      {
        mcqQuestionIds: selection.mcqQuestionIds || [],
        codingQuestionIds: selection.codingQuestionIds || [],
        behavioralQuestionIds: selection.behavioralQuestionIds || [],
        writtenQuestionIds: selection.writtenQuestionIds || [],
        readingQuestionIds: selection.readingQuestionIds || [],
        speakingQuestionIds: selection.speakingQuestionIds || [],
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
        passingScorePercent: testSettings.passingScorePercent,
        negativeMarking: testSettings.negativeMarking,
        shuffleQuestions: testSettings.shuffleQuestions,
        shuffleOptions: testSettings.shuffleOptions,
        maxViolations: testSettings.maxViolations,
        companyId: adminRecord?.companyId ?? undefined
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

// POST /admin/agent/suggest-questions
export const suggestQuestions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { jobProfile, skills, difficulty, mcqCount, codingCount, behavioralCount, writtenCount, readingCount, speakingCount } = req.body;

    if (!jobProfile?.title) {
      return res.status(400).json({ error: 'Job profile with title is required' });
    }
    if (!skills || !Array.isArray(skills) || skills.length === 0) {
      return res.status(400).json({ error: 'At least one skill is required' });
    }
    if (!difficulty || !['easy', 'medium', 'hard', 'mixed'].includes(difficulty)) {
      return res.status(400).json({ error: 'Valid difficulty level is required (easy, medium, hard, mixed)' });
    }

    const resolvedMcqCount = typeof mcqCount === 'number' && mcqCount >= 0 ? mcqCount : 5;
    const resolvedCodingCount = typeof codingCount === 'number' && codingCount >= 0 ? codingCount : 2;
    const resolvedBehavioralCount = typeof behavioralCount === 'number' && behavioralCount >= 0 ? behavioralCount : 2;
    const resolvedWrittenCount = typeof writtenCount === 'number' && writtenCount >= 0 ? writtenCount : 0;
    const resolvedReadingCount = typeof readingCount === 'number' && readingCount >= 0 ? readingCount : 0;
    const resolvedSpeakingCount = typeof speakingCount === 'number' && speakingCount >= 0 ? speakingCount : 0;

    if (resolvedMcqCount === 0 && resolvedCodingCount === 0 && resolvedBehavioralCount === 0
      && resolvedWrittenCount === 0 && resolvedReadingCount === 0 && resolvedSpeakingCount === 0) {
      return res.status(400).json({ error: 'At least one question is required' });
    }

    const suggestions = await suggestNewQuestions(jobProfile, skills, difficulty, {
      mcqCount: resolvedMcqCount,
      codingCount: resolvedCodingCount,
      behavioralCount: resolvedBehavioralCount,
      writtenCount: resolvedWrittenCount,
      readingQuestionCount: resolvedReadingCount,
      speakingCount: resolvedSpeakingCount
    });

    res.json({
      success: true,
      data: suggestions
    });
  } catch (error) {
    console.error('Error suggesting new questions:', error);
    res.status(500).json({
      error: 'Failed to suggest new questions',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// POST /admin/agent/review-details — full details (options, test cases, expected answers, etc.)
// for a final set of selected question ids, for the read-only pre-creation review step.
export const getReviewDetails = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mcqQuestionIds, codingQuestionIds, behavioralQuestionIds, writtenQuestionIds, readingQuestionIds, speakingQuestionIds } = req.body;

    const communicationQuestionIds = [
      ...(Array.isArray(writtenQuestionIds) ? writtenQuestionIds : []),
      ...(Array.isArray(readingQuestionIds) ? readingQuestionIds : []),
      ...(Array.isArray(speakingQuestionIds) ? speakingQuestionIds : [])
    ];

    const details = await getQuestionDetailsForReview(
      Array.isArray(mcqQuestionIds) ? mcqQuestionIds : [],
      Array.isArray(codingQuestionIds) ? codingQuestionIds : [],
      Array.isArray(behavioralQuestionIds) ? behavioralQuestionIds : [],
      communicationQuestionIds
    );

    res.json({
      success: true,
      data: details
    });
  } catch (error) {
    console.error('Error fetching review details:', error);
    res.status(500).json({
      error: 'Failed to fetch review details',
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
