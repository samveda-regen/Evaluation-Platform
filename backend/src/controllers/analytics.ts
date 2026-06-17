import { Request, Response } from 'express';
import prisma from '../utils/db';
import {
  generatePerformanceEvaluation,
  generateTestAnalytics,
  getPerformanceComparison,
} from '../services/performanceEvaluationService';

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

    // Always regenerate so stats reflect the latest submitted attempts
    await generateTestAnalytics(testId);

    let analytics = await prisma.testAnalytics.findUnique({
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

    const [testQuestions, mcqAnswers, codingAnswers] = await Promise.all([
      prisma.testQuestion.findMany({
        where: { testId },
        select: {
          mcqQuestion:        { select: { difficulty: true } },
          codingQuestion:     { select: { difficulty: true } },
          behavioralQuestion: { select: { difficulty: true } },
        },
      }),
      prisma.mCQAnswer.findMany({
        where: { attempt: { testId } },
        select: { isCorrect: true, question: { select: { difficulty: true } } },
      }),
      prisma.codingAnswer.findMany({
        where: { attempt: { testId } },
        select: { marksObtained: true, question: { select: { difficulty: true } } },
      }),
    ]);

    /* actual question counts from the test definition */
    const qCounts = { easy: 0, medium: 0, hard: 0 };
    for (const tq of testQuestions) {
      const q = tq.mcqQuestion || tq.codingQuestion || tq.behavioralQuestion;
      if (!q) continue;
      const d = (q.difficulty || 'medium').toLowerCase();
      if (d === 'easy') qCounts.easy++;
      else if (d === 'hard') qCounts.hard++;
      else qCounts.medium++;
    }

    /* compute accuracy from raw answers */
    const diffStats = { easy: { correct: 0, total: 0 }, medium: { correct: 0, total: 0 }, hard: { correct: 0, total: 0 } };
    for (const ans of mcqAnswers) {
      const d = (ans.question.difficulty || 'medium').toLowerCase();
      const k = d === 'easy' ? 'easy' : d === 'hard' ? 'hard' : 'medium';
      diffStats[k].total++;
      if (ans.isCorrect) diffStats[k].correct++;
    }
    for (const ans of codingAnswers) {
      const d = (ans.question.difficulty || 'medium').toLowerCase();
      const k = d === 'easy' ? 'easy' : d === 'hard' ? 'hard' : 'medium';
      diffStats[k].total++;
      if ((ans.marksObtained ?? 0) > 0) diffStats[k].correct++;
    }

    const analysis = {
      easy:   { totalCorrect: diffStats.easy.correct,   totalQuestions: qCounts.easy,   avgAccuracy: diffStats.easy.total   > 0 ? (diffStats.easy.correct   / diffStats.easy.total)   * 100 : 0 },
      medium: { totalCorrect: diffStats.medium.correct, totalQuestions: qCounts.medium, avgAccuracy: diffStats.medium.total > 0 ? (diffStats.medium.correct / diffStats.medium.total) * 100 : 0 },
      hard:   { totalCorrect: diffStats.hard.correct,   totalQuestions: qCounts.hard,   avgAccuracy: diffStats.hard.total   > 0 ? (diffStats.hard.correct   / diffStats.hard.total)   * 100 : 0 },
      totalAttempts: mcqAnswers.length + codingAnswers.length > 0 ? 1 : 0,
    };

    res.json({ success: true, analysis });
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

    const [analytics, testQuestions] = await Promise.all([
      prisma.performanceAnalytics.findMany({
        where: { attempt: { testId } },
        select: { skillAnalysis: true },
      }),
      prisma.testQuestion.findMany({
        where: { testId },
        select: {
          mcqQuestion:        { select: { topic: true, tags: true } },
          codingQuestion:     { select: { topic: true, tags: true } },
          behavioralQuestion: { select: { topic: true, tags: true } },
        },
      }),
    ]);

    /* Try performance-analytics skills first */
    const skillMap: Record<string, { correct: number; total: number; count: number }> = {};
    for (const a of analytics) {
      if (!a.skillAnalysis) continue;
      try {
        const skills = JSON.parse(a.skillAnalysis) as { skill: string; correct: number; total: number }[];
        for (const s of skills) {
          if (!skillMap[s.skill]) skillMap[s.skill] = { correct: 0, total: 0, count: 0 };
          skillMap[s.skill].correct += s.correct;
          skillMap[s.skill].total   += s.total;
          skillMap[s.skill].count++;
        }
      } catch { /* skip */ }
    }

    if (Object.keys(skillMap).length > 0) {
      const skills = Object.entries(skillMap).map(([skill, data]) => ({
        skill,
        totalCorrect: data.correct,
        totalQuestions: data.total,
        avgAccuracy: data.total > 0 ? (data.correct / data.total) * 100 : 0,
        candidateCount: data.count,
      })).sort((a, b) => b.avgAccuracy - a.avgAccuracy);
      res.json({ success: true, skills });
      return;
    }

    /* Fall back: derive skills from question tags/topics */
    const tagFreq: Record<string, number> = {};
    const total = testQuestions.length;
    for (const tq of testQuestions) {
      const q = tq.mcqQuestion || tq.codingQuestion || tq.behavioralQuestion;
      if (!q) continue;
      if (q.tags) {
        try {
          const tags: string[] = JSON.parse(q.tags);
          for (const t of tags) { if (t?.trim()) tagFreq[t.trim()] = (tagFreq[t.trim()] || 0) + 1; }
        } catch { /* skip */ }
      }
      if (q.topic?.trim()) tagFreq[q.topic.trim()] = (tagFreq[q.topic.trim()] || 0) + 1;
    }

    const skills = Object.entries(tagFreq)
      .map(([skill, count]) => ({
        skill,
        totalCorrect: 0,
        totalQuestions: count,
        avgAccuracy: Math.round((count / Math.max(total, 1)) * 100),
        candidateCount: 0,
      }))
      .sort((a, b) => b.avgAccuracy - a.avgAccuracy)
      .slice(0, 10);

    res.json({ success: true, skills });
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

    const leaderboard = attempts.map((attempt, index) => ({
      rank: index + 1,
      candidateId: attempt.candidate.id,
      candidateName: attempt.candidate.name,
      score: attempt.score,
      percentile: attempt.analytics?.percentile,
      grade: attempt.analytics?.overallGrade,
      trustScore: attempt.analytics?.trustScore,
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
 * Admin-wide performance overview  (GET /analytics/admin/overview?period=30d)
 * Powers the standalone /admin/analytics page — aggregates across all tests.
 */
export const getAdminOverview = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).admin?.id;
    const period  = ((req.query.period as string) || '30d').toLowerCase();

    const tests = await prisma.test.findMany({
      where: { adminId },
      select: { id: true, passingMarks: true, totalMarks: true },
    });
    const testIds = tests.map(t => t.id);

    if (testIds.length === 0) {
      res.json({ success: true, data: { stats: null, scoreTrend: [], skillCoverage: [], difficultyBreakdown: null, topCandidates: [] } });
      return;
    }

    /* build testId → totalMarks lookup from the already-fetched tests */
    const testMarksMap: Record<string, number> = {};
    for (const t of tests) testMarksMap[t.id] = t.totalMarks;

    const days     = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const since    = new Date(Date.now() - days * 86_400_000);
    const prevSince = new Date(since.getTime() - days * 86_400_000);

    /* ─ attempt fetches ─────────────────────────────────── */
    const [currentAttempts, prevAttempts, allCompleted, totalAllAttemptsCount, testQuestions, mcqAnswers, codingAnswers] = await Promise.all([
      prisma.testAttempt.findMany({
        where: { testId: { in: testIds }, status: { in: ['submitted', 'auto_submitted'] }, submittedAt: { gte: since } },
        select: { id: true, testId: true, score: true, startTime: true, submittedAt: true },
      }),
      prisma.testAttempt.findMany({
        where: { testId: { in: testIds }, status: { in: ['submitted', 'auto_submitted'] }, submittedAt: { gte: prevSince, lt: since } },
        select: { id: true, testId: true, score: true },
      }),
      prisma.testAttempt.findMany({
        where: { testId: { in: testIds }, status: { in: ['submitted', 'auto_submitted'] }, score: { not: null } },
        select: {
          id: true, testId: true, score: true, startTime: true, submittedAt: true, candidateId: true,
          candidate: { select: { id: true, name: true, email: true } },
        },
        orderBy: { score: 'desc' },
      }),
      /* all-time total for the KPI card */
      prisma.testAttempt.count({ where: { testId: { in: testIds } } }),
      /* questions for difficulty counts + skill tags */
      prisma.testQuestion.findMany({
        where: { testId: { in: testIds } },
        select: {
          questionType: true,
          mcqQuestion:        { select: { difficulty: true, topic: true, tags: true } },
          codingQuestion:     { select: { difficulty: true, topic: true, tags: true } },
          behavioralQuestion: { select: { difficulty: true, topic: true, tags: true } },
        },
      }),
      /* raw MCQ answers for real difficulty accuracy */
      prisma.mCQAnswer.findMany({
        where: { attempt: { testId: { in: testIds } } },
        select: { isCorrect: true, question: { select: { difficulty: true } } },
      }),
      /* raw coding answers for difficulty accuracy */
      prisma.codingAnswer.findMany({
        where: { attempt: { testId: { in: testIds } } },
        select: { marksObtained: true, question: { select: { difficulty: true } } },
      }),
    ]);

    /* ─ stats helper ─────────────────────────────────────── */
    const calcStats = (attempts: { score: number | null; testId: string }[]) => {
      const scored = attempts.filter(a => a.score !== null && (testMarksMap[a.testId] ?? 0) > 0);
      if (!scored.length) return { count: attempts.length, avgScore: 0, passRate: 0 };
      const avgScore = scored.reduce((s, a) => s + (a.score! / testMarksMap[a.testId]) * 100, 0) / scored.length;
      const passed   = scored.filter(a => (a.score! / testMarksMap[a.testId]) * 100 >= 60).length;
      return { count: attempts.length, avgScore, passRate: (passed / scored.length) * 100 };
    };

    const curr = calcStats(currentAttempts);
    const prev = calcStats(prevAttempts);

    const timeDiffs = currentAttempts
      .filter(a => a.submittedAt && a.startTime)
      .map(a => (new Date(a.submittedAt!).getTime() - new Date(a.startTime).getTime()) / 60_000);
    const avgTimeMinutes = timeDiffs.length
      ? Math.round(timeDiffs.reduce((s, t) => s + t, 0) / timeDiffs.length)
      : 0;

    /* ─ score trend (6 buckets) ──────────────────────────── */
    const buckets = 6;
    const bucketMs = (days * 86_400_000) / buckets;
    const trendBuckets: number[][] = Array.from({ length: buckets }, () => []);
    const cutoffMs = since.getTime();

    for (const a of allCompleted) {
      const tm = testMarksMap[a.testId] ?? 0;
      if (!a.submittedAt || a.score === null || tm <= 0) continue;
      const diff = new Date(a.submittedAt).getTime() - cutoffMs;
      if (diff < 0) continue;
      const idx = Math.min(buckets - 1, Math.floor(diff / bucketMs));
      trendBuckets[idx].push((a.score / tm) * 100);
    }

    const scoreTrend = trendBuckets.map((scores, i) => ({
      label: `W${i + 1}`,
      avgScore: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0,
      count: scores.length,
    }));

    /* ─ question-based difficulty counts + tag skills ────── */
    const diffQCounts = { easy: 0, medium: 0, hard: 0 };
    const tagFreq: Record<string, number> = {};
    const totalQ = testQuestions.length;

    for (const tq of testQuestions) {
      const q = tq.mcqQuestion || tq.codingQuestion || tq.behavioralQuestion;
      if (!q) continue;
      const diff = (q.difficulty || 'medium').toLowerCase();
      if (diff === 'easy')       diffQCounts.easy++;
      else if (diff === 'hard')  diffQCounts.hard++;
      else                       diffQCounts.medium++;

      if (q.tags) {
        try {
          const tags: string[] = JSON.parse(q.tags);
          for (const t of tags) { if (t?.trim()) tagFreq[t.trim()] = (tagFreq[t.trim()] || 0) + 1; }
        } catch { /* skip malformed */ }
      }
      if (q.topic?.trim()) {
        const tp = q.topic.trim();
        tagFreq[tp] = (tagFreq[tp] || 0) + 1;
      }
    }

    /* ─ skill & difficulty from performanceAnalytics ─────── */
    const perfRows = await prisma.performanceAnalytics.findMany({
      where: { attempt: { testId: { in: testIds } } },
      select: { skillAnalysis: true },
    });

    const skillMap: Record<string, { total: number; n: number }> = {};
    for (const pa of perfRows) {
      if (!pa.skillAnalysis) continue;
      try {
        const skills: { skill: string; correct: number; total: number }[] = JSON.parse(pa.skillAnalysis);
        for (const s of skills) {
          if (!skillMap[s.skill]) skillMap[s.skill] = { total: 0, n: 0 };
          skillMap[s.skill].total += s.total > 0 ? (s.correct / s.total) * 100 : 0;
          skillMap[s.skill].n++;
        }
      } catch { /* skip malformed */ }
    }

    /* Prefer performance-analytics accuracy; fall back to question tag frequency */
    const perfSkills = Object.entries(skillMap)
      .map(([skill, d]) => ({ skill, avgAccuracy: Math.round(d.total / d.n) }))
      .sort((a, b) => b.avgAccuracy - a.avgAccuracy)
      .slice(0, 7);

    const tagSkills = Object.entries(tagFreq)
      .map(([skill, count]) => ({ skill, avgAccuracy: Math.round((count / Math.max(totalQ, 1)) * 100) }))
      .sort((a, b) => b.avgAccuracy - a.avgAccuracy)
      .slice(0, 7);

    const skillCoverage = perfSkills.length > 0 ? perfSkills : tagSkills;

    /* ─ difficulty accuracy from raw answers ─────────────── */
    const diffStats = {
      easy:   { correct: 0, total: 0 },
      medium: { correct: 0, total: 0 },
      hard:   { correct: 0, total: 0 },
    };
    for (const ans of mcqAnswers) {
      const d = (ans.question.difficulty || 'medium').toLowerCase();
      const k = d === 'easy' ? 'easy' : d === 'hard' ? 'hard' : 'medium';
      diffStats[k].total++;
      if (ans.isCorrect) diffStats[k].correct++;
    }
    for (const ans of codingAnswers) {
      const d = (ans.question.difficulty || 'medium').toLowerCase();
      const k = d === 'easy' ? 'easy' : d === 'hard' ? 'hard' : 'medium';
      diffStats[k].total++;
      if ((ans.marksObtained ?? 0) > 0) diffStats[k].correct++;
    }
    const difficultyBreakdown = {
      easy:   { avgAccuracy: diffStats.easy.total   > 0 ? Math.round((diffStats.easy.correct   / diffStats.easy.total)   * 100) : 0, count: diffQCounts.easy   },
      medium: { avgAccuracy: diffStats.medium.total > 0 ? Math.round((diffStats.medium.correct / diffStats.medium.total) * 100) : 0, count: diffQCounts.medium },
      hard:   { avgAccuracy: diffStats.hard.total   > 0 ? Math.round((diffStats.hard.correct   / diffStats.hard.total)   * 100) : 0, count: diffQCounts.hard   },
    };

    /* ─ top candidates ───────────────────────────────────── */
    const topRaw = allCompleted
      .filter(a => a.score !== null && (testMarksMap[a.testId] ?? 0) > 0)
      .slice(0, 4)
      .map((a, i) => ({
        rank: i + 1,
        candidateId:   a.candidate.id,
        candidateName: (a.candidate.name ?? a.candidate.email ?? a.candidateId),
        score: Math.round((a.score! / testMarksMap[a.testId]) * 100),
        attemptId: a.id,
        trustScore: 0,
      }));

    if (topRaw.length) {
      const trustRows = await prisma.performanceAnalytics.findMany({
        where: { attemptId: { in: topRaw.map(t => t.attemptId) } },
        select: { attemptId: true, trustScore: true },
      });
      for (const tr of topRaw) {
        const found = trustRows.find(r => r.attemptId === tr.attemptId);
        if (found?.trustScore) tr.trustScore = Math.round(found.trustScore);
      }
    }

    res.json({
      success: true,
      data: {
        stats: {
          totalAttempts:  totalAllAttemptsCount,
          avgScore:       Math.round(curr.avgScore),
          passRate:       Math.round(curr.passRate),
          avgTimeMinutes,
          changes: {
            attempts: prev.count > 0 ? Math.round(((curr.count - prev.count) / prev.count) * 100) : null,
            avgScore: prev.avgScore > 0 ? Math.round(curr.avgScore - prev.avgScore) : null,
            passRate: prev.passRate > 0 ? Math.round(curr.passRate - prev.passRate) : null,
          },
        },
        scoreTrend,
        skillCoverage,
        difficultyBreakdown,
        topCandidates: topRaw,
      },
    });
  } catch (error) {
    console.error('Error getting admin overview:', error);
    res.status(500).json({ error: 'Failed to get overview' });
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

    // Get various statistics
    const [
      totalAttempts,
      completedAttempts,
      flaggedAttempts,
      avgTrustScore,
      recentAttempts,
    ] = await Promise.all([
      prisma.testAttempt.count({
        where: { testId: { in: testIds } },
      }),
      prisma.testAttempt.count({
        where: {
          testId: { in: testIds },
          status: { in: ['submitted', 'auto_submitted'] },
        },
      }),
      prisma.testAttempt.count({
        where: {
          testId: { in: testIds },
          isFlagged: true,
        },
      }),
      prisma.performanceAnalytics.aggregate({
        where: {
          attempt: { testId: { in: testIds } },
          trustScore: { not: null },
        },
        _avg: { trustScore: true },
      }),
      prisma.testAttempt.findMany({
        where: {
          testId: { in: testIds },
          status: { in: ['submitted', 'auto_submitted'] },
        },
        include: {
          candidate: { select: { name: true, email: true } },
          test: { select: { name: true } },
          analytics: { select: { overallGrade: true, trustScore: true } },
        },
        orderBy: { submittedAt: 'desc' },
        take: 10,
      }),
    ]);

    res.json({
      success: true,
      stats: {
        totalAttempts,
        completedAttempts,
        flaggedAttempts,
        avgTrustScore: avgTrustScore._avg.trustScore || 0,
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
        trustScore: a.analytics?.trustScore,
        isFlagged: a.isFlagged,
        submittedAt: a.submittedAt,
      })),
    });
  } catch (error) {
    console.error('Error getting dashboard stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
};
