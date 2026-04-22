import { Request, Response } from 'express';
import prisma from '../utils/db';
import {
  generatePerformanceEvaluation,
  generateTestAnalytics,
  getPerformanceComparison,
} from '../services/performanceEvaluationService';
import { getTrustScoresForAttemptIds } from '../services/trustScoreService.js';

/**
 * Get performance analytics for a specific attempt
 */
export const getAttemptAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const { attemptId } = req.params;
    const { regenerate } = req.query;

    // Check if analytics exist and if we should regenerate
    let analytics = await prisma.performanceAnalytics.findUnique({
      where: { attemptId },
    });

    if (!analytics || regenerate === 'true') {
      const metrics = await generatePerformanceEvaluation(attemptId);
      if (!metrics) {
        res.status(404).json({ error: 'Failed to generate analytics' });
        return;
      }

      analytics = await prisma.performanceAnalytics.findUnique({
        where: { attemptId },
      });
    }

    if (!analytics) {
      res.status(404).json({ error: 'Analytics not found' });
      return;
    }

    // Parse JSON fields
    const response = {
      ...analytics,
      topicAnalysis: analytics.topicAnalysis ? JSON.parse(analytics.topicAnalysis) : null,
      skillAnalysis: analytics.skillAnalysis ? JSON.parse(analytics.skillAnalysis) : null,
      strengths: analytics.strengths ? JSON.parse(analytics.strengths) : [],
      weaknesses: analytics.weaknesses ? JSON.parse(analytics.weaknesses) : [],
      recommendations: analytics.recommendations ? JSON.parse(analytics.recommendations) : [],
      proctoringSummary: analytics.proctoringSummary ? JSON.parse(analytics.proctoringSummary) : null,
      codingMetrics: analytics.codingMetrics ? JSON.parse(analytics.codingMetrics) : null,
    };

    res.json({
      success: true,
      analytics: response,
    });
  } catch (error) {
    console.error('Error getting attempt analytics:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
};

/**
 * Get test-level analytics
 */
export const getTestAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const { testId } = req.params;

    await generateTestAnalytics(testId);
    const analytics = await prisma.testAnalytics.findUnique({
      where: { testId },
    });

    if (!analytics) {
      res.status(404).json({ error: 'Analytics not found' });
      return;
    }

    // Parse JSON fields
    const response = {
      ...analytics,
      scoreDistribution: analytics.scoreDistribution ? JSON.parse(analytics.scoreDistribution) : {},
      timeDistribution: analytics.timeDistribution ? JSON.parse(analytics.timeDistribution) : {},
      questionDifficulty: analytics.questionDifficulty ? JSON.parse(analytics.questionDifficulty) : {},
    };

    res.json({
      success: true,
      analytics: response,
    });
  } catch (error) {
    console.error('Error getting test analytics:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
};

/**
 * Get performance comparison across candidates
 */
export const getPerformanceComparisonData = async (req: Request, res: Response): Promise<void> => {
  try {
    const { testId } = req.params;
    const { minScore, maxScore, difficulty, topic, flagged, sortBy, sortOrder } = req.query;

    const filters: any = {};
    if (minScore) filters.minScore = Number(minScore);
    if (maxScore) filters.maxScore = Number(maxScore);
    if (difficulty) filters.difficulty = difficulty as string;
    if (topic) filters.topic = topic as string;
    if (flagged !== undefined) filters.flagged = flagged === 'true';

    let comparison = await getPerformanceComparison(testId, filters);

    // Sort if requested
    if (sortBy) {
      comparison = comparison.sort((a, b) => {
        const aVal = a[sortBy as string] ?? 0;
        const bVal = b[sortBy as string] ?? 0;
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }

    res.json({
      success: true,
      comparison,
      total: comparison.length,
    });
  } catch (error) {
    console.error('Error getting performance comparison:', error);
    res.status(500).json({ error: 'Failed to get comparison' });
  }
};

/**
 * Get difficulty-based analysis for a test
 */
export const getDifficultyAnalysis = async (req: Request, res: Response): Promise<void> => {
  try {
    const { testId } = req.params;

    const analytics = await prisma.performanceAnalytics.findMany({
      where: {
        attempt: { testId },
      },
      select: {
        easyCorrect: true,
        easyTotal: true,
        easyAccuracy: true,
        mediumCorrect: true,
        mediumTotal: true,
        mediumAccuracy: true,
        hardCorrect: true,
        hardTotal: true,
        hardAccuracy: true,
      },
    });

    if (analytics.length === 0) {
      res.json({
        success: true,
        analysis: null,
        message: 'No analytics data available',
      });
      return;
    }

    // Aggregate difficulty data
    const totals = {
      easy: { correct: 0, total: 0, avgAccuracy: 0 },
      medium: { correct: 0, total: 0, avgAccuracy: 0 },
      hard: { correct: 0, total: 0, avgAccuracy: 0 },
    };

    for (const a of analytics) {
      totals.easy.correct += a.easyCorrect;
      totals.easy.total += a.easyTotal;
      totals.easy.avgAccuracy += a.easyAccuracy || 0;
      totals.medium.correct += a.mediumCorrect;
      totals.medium.total += a.mediumTotal;
      totals.medium.avgAccuracy += a.mediumAccuracy || 0;
      totals.hard.correct += a.hardCorrect;
      totals.hard.total += a.hardTotal;
      totals.hard.avgAccuracy += a.hardAccuracy || 0;
    }

    const count = analytics.length;
    const analysis = {
      easy: {
        totalCorrect: totals.easy.correct,
        totalQuestions: totals.easy.total,
        avgAccuracy: totals.easy.avgAccuracy / count,
      },
      medium: {
        totalCorrect: totals.medium.correct,
        totalQuestions: totals.medium.total,
        avgAccuracy: totals.medium.avgAccuracy / count,
      },
      hard: {
        totalCorrect: totals.hard.correct,
        totalQuestions: totals.hard.total,
        avgAccuracy: totals.hard.avgAccuracy / count,
      },
      totalAttempts: count,
    };

    res.json({
      success: true,
      analysis,
    });
  } catch (error) {
    console.error('Error getting difficulty analysis:', error);
    res.status(500).json({ error: 'Failed to get analysis' });
  }
};

/**
 * Get topic-wise analysis for a test
 */
export const getTopicAnalysis = async (req: Request, res: Response): Promise<void> => {
  try {
    const { testId } = req.params;

    const analytics = await prisma.performanceAnalytics.findMany({
      where: {
        attempt: { testId },
      },
      select: {
        topicAnalysis: true,
      },
    });

    if (analytics.length === 0) {
      res.json({
        success: true,
        topics: [],
        message: 'No analytics data available',
      });
      return;
    }

    // Aggregate topic data
    const topicMap: Record<string, { correct: number; total: number; count: number }> = {};

    for (const a of analytics) {
      if (a.topicAnalysis) {
        const topics = JSON.parse(a.topicAnalysis);
        for (const topic of topics) {
          if (!topicMap[topic.topic]) {
            topicMap[topic.topic] = { correct: 0, total: 0, count: 0 };
          }
          topicMap[topic.topic].correct += topic.correct;
          topicMap[topic.topic].total += topic.total;
          topicMap[topic.topic].count++;
        }
      }
    }

    const topics = Object.entries(topicMap).map(([topic, data]) => ({
      topic,
      totalCorrect: data.correct,
      totalQuestions: data.total,
      avgAccuracy: data.total > 0 ? (data.correct / data.total) * 100 : 0,
      candidateCount: data.count,
    })).sort((a, b) => b.avgAccuracy - a.avgAccuracy);

    res.json({
      success: true,
      topics,
    });
  } catch (error) {
    console.error('Error getting topic analysis:', error);
    res.status(500).json({ error: 'Failed to get analysis' });
  }
};

/**
 * Get skill-wise analysis for a test
 */
export const getSkillAnalysis = async (req: Request, res: Response): Promise<void> => {
  try {
    const { testId } = req.params;

    const analytics = await prisma.performanceAnalytics.findMany({
      where: {
        attempt: { testId },
      },
      select: {
        skillAnalysis: true,
      },
    });

    if (analytics.length === 0) {
      res.json({
        success: true,
        skills: [],
        message: 'No analytics data available',
      });
      return;
    }

    // Aggregate skill data
    const skillMap: Record<string, { correct: number; total: number; count: number }> = {};

    for (const a of analytics) {
      if (a.skillAnalysis) {
        const skills = JSON.parse(a.skillAnalysis);
        for (const skill of skills) {
          if (!skillMap[skill.skill]) {
            skillMap[skill.skill] = { correct: 0, total: 0, count: 0 };
          }
          skillMap[skill.skill].correct += skill.correct;
          skillMap[skill.skill].total += skill.total;
          skillMap[skill.skill].count++;
        }
      }
    }

    const skills = Object.entries(skillMap).map(([skill, data]) => ({
      skill,
      totalCorrect: data.correct,
      totalQuestions: data.total,
      avgAccuracy: data.total > 0 ? (data.correct / data.total) * 100 : 0,
      candidateCount: data.count,
    })).sort((a, b) => b.avgAccuracy - a.avgAccuracy);

    res.json({
      success: true,
      skills,
    });
  } catch (error) {
    console.error('Error getting skill analysis:', error);
    res.status(500).json({ error: 'Failed to get analysis' });
  }
};

/**
 * Get leaderboard for a test
 */
export const getLeaderboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const { testId } = req.params;
    const { limit = 10, includeProctoring } = req.query;

    const attempts = await prisma.testAttempt.findMany({
      where: {
        testId,
        status: { in: ['submitted', 'auto_submitted'] },
        score: { not: null },
      },
      include: {
        candidate: { select: { id: true, name: true, email: true } },
        analytics: includeProctoring === 'true'
          ? { select: { percentile: true, trustScore: true, overallGrade: true } }
          : undefined,
      },
      orderBy: { score: 'desc' },
      take: Number(limit),
    });
    const trustScoresByAttemptId =
      includeProctoring === 'true'
        ? await getTrustScoresForAttemptIds(attempts.map(attempt => attempt.id))
        : new Map<string, number>();

    const leaderboard = attempts.map((attempt, index) => ({
      rank: index + 1,
      candidateId: attempt.candidate.id,
      candidateName: attempt.candidate.name,
      score: attempt.score,
      percentile: attempt.analytics?.percentile,
      grade: attempt.analytics?.overallGrade,
      trustScore: includeProctoring === 'true' ? trustScoresByAttemptId.get(attempt.id) : undefined,
      submittedAt: attempt.submittedAt,
    }));

    res.json({
      success: true,
      leaderboard,
    });
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
};

/**
 * Regenerate analytics for all attempts in a test
 */
export const regenerateTestAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const { testId } = req.params;

    const attempts = await prisma.testAttempt.findMany({
      where: {
        testId,
        status: { in: ['submitted', 'auto_submitted'] },
      },
      select: { id: true },
    });

    let processed = 0;
    let failed = 0;

    for (const attempt of attempts) {
      const result = await generatePerformanceEvaluation(attempt.id);
      if (result) {
        processed++;
      } else {
        failed++;
      }
    }

    // Regenerate test-level analytics
    await generateTestAnalytics(testId);

    res.json({
      success: true,
      message: `Regenerated analytics for ${processed} attempts, ${failed} failed`,
      processed,
      failed,
    });
  } catch (error) {
    console.error('Error regenerating analytics:', error);
    res.status(500).json({ error: 'Failed to regenerate analytics' });
  }
};

/**
 * Get dashboard summary statistics
 */
export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).admin?.id;

    // Get admin's tests
    const tests = await prisma.test.findMany({
      where: { adminId },
      select: { id: true },
    });

    const testIds = tests.map(e => e.id);
    const submittedStatuses = ['submitted', 'auto_submitted'];
    const submittedWhere = {
      testId: { in: testIds },
      status: { in: submittedStatuses },
    };

    // Get various statistics
    const [
      totalAttempts,
      completedAttempts,
      flaggedAttempts,
      submittedAttempts,
      recentAttempts,
    ] = await Promise.all([
      prisma.testAttempt.count({
        where: { testId: { in: testIds } },
      }),
      prisma.testAttempt.count({
        where: submittedWhere,
      }),
      prisma.testAttempt.count({
        where: {
          testId: { in: testIds },
          isFlagged: true,
        },
      }),
      prisma.testAttempt.findMany({
        where: submittedWhere,
        select: { id: true },
      }),
      prisma.testAttempt.findMany({
        where: submittedWhere,
        include: {
          candidate: { select: { name: true, email: true } },
          test: { select: { name: true } },
          analytics: { select: { overallGrade: true, trustScore: true } },
        },
        orderBy: { submittedAt: 'desc' },
        take: 10,
      }),
    ] as const);
    const allTrustScoresByAttemptId = await getTrustScoresForAttemptIds(
      submittedAttempts.map(attempt => attempt.id)
    );
    const allTrustScores = Array.from(allTrustScoresByAttemptId.values());
    const recentTrustScoresByAttemptId = await getTrustScoresForAttemptIds(
      recentAttempts.map(attempt => attempt.id)
    );

    res.json({
      success: true,
      stats: {
        totalAttempts,
        completedAttempts,
        flaggedAttempts,
        avgTrustScore:
          allTrustScores.length > 0
            ? allTrustScores.reduce((sum, score) => sum + score, 0) / allTrustScores.length
            : 0,
        completionRate: totalAttempts > 0 ? (completedAttempts / totalAttempts) * 100 : 0,
        flagRate: completedAttempts > 0 ? (flaggedAttempts / completedAttempts) * 100 : 0,
      },
      recentAttempts: recentAttempts.map(a => ({
        id: a.id,
        candidateName: a.candidate.name,
        candidateEmail: a.candidate.email,
        testName: a.test.name,
        score: a.score,
        grade: a.analytics?.overallGrade,
        trustScore: recentTrustScoresByAttemptId.get(a.id) ?? 100,
        isFlagged: a.isFlagged,
        submittedAt: a.submittedAt,
      })),
    });
  } catch (error) {
    console.error('Error getting dashboard stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
};
