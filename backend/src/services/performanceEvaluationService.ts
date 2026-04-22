/**
 * AI-Powered Performance Evaluation Service
 *
 * Analyzes candidate performance across multiple dimensions:
 * - Difficulty-based analysis (easy, medium, hard)
 * - Topic-wise performance breakdown
 * - Skill/tag analysis
 * - Time management analysis
 * - AI-generated insights and recommendations
 * - Percentile rankings
 * - Proctoring integrity scores
 */

import prisma from '../utils/db';
import { callLLM } from './llmService';
import {
  calculateTrustScoreFromEvents,
  getTrustScoresForAttemptIds,
  TRUST_REPORT_EVENT_TYPES,
} from './trustScoreService';

export interface TopicPerformance {
  topic: string;
  correct: number;
  total: number;
  accuracy: number;
  avgTimePerQuestion?: number;
}

export interface SkillPerformance {
  skill: string;
  correct: number;
  total: number;
  accuracy: number;
}

export interface DifficultyBreakdown {
  easy: { correct: number; total: number; accuracy: number };
  medium: { correct: number; total: number; accuracy: number };
  hard: { correct: number; total: number; accuracy: number };
}

export interface PerformanceMetrics {
  totalScore: number;
  maxScore: number;
  percentage: number;
  percentile?: number;
  grade: string;
  difficultyBreakdown: DifficultyBreakdown;
  topicPerformance: TopicPerformance[];
  skillPerformance: SkillPerformance[];
  timeAnalysis: {
    totalTimeTaken: number;
    avgTimePerQuestion: number;
    timeEfficiency: 'fast' | 'normal' | 'slow';
  };
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  trustScore?: number;
}

/**
 * Calculate grade based on percentage
 */
function calculateGrade(percentage: number): string {
  if (percentage >= 90) return 'A+';
  if (percentage >= 80) return 'A';
  if (percentage >= 70) return 'B+';
  if (percentage >= 60) return 'B';
  if (percentage >= 50) return 'C';
  if (percentage >= 40) return 'D';
  return 'F';
}

/**
 * Calculate percentile rank among all attempts for the same test
 */
async function calculatePercentile(testId: string, score: number): Promise<number> {
  const allScores = await prisma.testAttempt.findMany({
    where: {
      testId,
      status: { in: ['submitted', 'auto_submitted'] },
      score: { not: null },
    },
    select: { score: true },
    orderBy: { score: 'asc' },
  });

  if (allScores.length === 0) return 100;

  const belowCount = allScores.filter(a => (a.score || 0) < score).length;
  return Math.round((belowCount / allScores.length) * 100);
}

/**
 * Analyze MCQ answers for an attempt
 */
async function analyzeMCQAnswers(attemptId: string): Promise<{
  difficultyBreakdown: DifficultyBreakdown;
  topicPerformance: TopicPerformance[];
  skillPerformance: SkillPerformance[];
  totalCorrect: number;
  totalQuestions: number;
}> {
  const answers = await prisma.mCQAnswer.findMany({
    where: { attemptId },
    include: {
      question: {
        select: {
          difficulty: true,
          topic: true,
          tags: true,
          marks: true,
        },
      },
    },
  });

  const difficultyBreakdown: DifficultyBreakdown = {
    easy: { correct: 0, total: 0, accuracy: 0 },
    medium: { correct: 0, total: 0, accuracy: 0 },
    hard: { correct: 0, total: 0, accuracy: 0 },
  };

  const topicMap: Record<string, { correct: number; total: number }> = {};
  const skillMap: Record<string, { correct: number; total: number }> = {};

  let totalCorrect = 0;
  const totalQuestions = answers.length;

  for (const answer of answers) {
    const difficulty = (answer.question.difficulty || 'medium') as keyof DifficultyBreakdown;
    const topic = answer.question.topic || 'General';
    const tags = answer.question.tags ? JSON.parse(answer.question.tags) : [];

    // Difficulty breakdown
    difficultyBreakdown[difficulty].total++;
    if (answer.isCorrect) {
      difficultyBreakdown[difficulty].correct++;
      totalCorrect++;
    }

    // Topic analysis
    if (!topicMap[topic]) {
      topicMap[topic] = { correct: 0, total: 0 };
    }
    topicMap[topic].total++;
    if (answer.isCorrect) {
      topicMap[topic].correct++;
    }

    // Skill/tag analysis
    for (const tag of tags) {
      if (!skillMap[tag]) {
        skillMap[tag] = { correct: 0, total: 0 };
      }
      skillMap[tag].total++;
      if (answer.isCorrect) {
        skillMap[tag].correct++;
      }
    }
  }

  // Calculate accuracies
  for (const diff of ['easy', 'medium', 'hard'] as const) {
    if (difficultyBreakdown[diff].total > 0) {
      difficultyBreakdown[diff].accuracy =
        (difficultyBreakdown[diff].correct / difficultyBreakdown[diff].total) * 100;
    }
  }

  const topicPerformance: TopicPerformance[] = Object.entries(topicMap).map(([topic, data]) => ({
    topic,
    correct: data.correct,
    total: data.total,
    accuracy: (data.correct / data.total) * 100,
  }));

  const skillPerformance: SkillPerformance[] = Object.entries(skillMap).map(([skill, data]) => ({
    skill,
    correct: data.correct,
    total: data.total,
    accuracy: (data.correct / data.total) * 100,
  }));

  return {
    difficultyBreakdown,
    topicPerformance,
    skillPerformance,
    totalCorrect,
    totalQuestions,
  };
}

/**
 * Analyze coding answers for an attempt
 */
async function analyzeCodingAnswers(attemptId: string): Promise<{
  avgPassRate: number;
  avgExecutionTime: number;
  avgMemoryUsage: number;
  codeQuality: number; // Simplified metric
}> {
  const answers = await prisma.codingAnswer.findMany({
    where: { attemptId },
    select: {
      testResults: true,
      executionTime: true,
      memoryUsed: true,
      marksObtained: true,
      question: {
        select: { marks: true },
      },
    },
  });

  if (answers.length === 0) {
    return { avgPassRate: 0, avgExecutionTime: 0, avgMemoryUsage: 0, codeQuality: 0 };
  }

  let totalPassRate = 0;
  let totalExecTime = 0;
  let totalMemory = 0;
  let totalQuality = 0;

  for (const answer of answers) {
    // Calculate pass rate from test results
    if (answer.testResults) {
      try {
        const results = JSON.parse(answer.testResults);
        const passed = results.filter((r: any) => r.passed).length;
        totalPassRate += (passed / results.length) * 100;
      } catch {
        // Ignore parse errors
      }
    }

    totalExecTime += answer.executionTime || 0;
    totalMemory += answer.memoryUsed || 0;

    // Simple quality score based on marks obtained
    if (answer.question.marks > 0 && answer.marksObtained != null) {
      totalQuality += (answer.marksObtained / answer.question.marks) * 100;
    }
  }

  const count = answers.length;
  return {
    avgPassRate: totalPassRate / count,
    avgExecutionTime: totalExecTime / count,
    avgMemoryUsage: totalMemory / count,
    codeQuality: totalQuality / count,
  };
}

/**
 * Generate AI insights using LLM
 */
async function generateAIInsights(metrics: {
  percentage: number;
  difficultyBreakdown: DifficultyBreakdown;
  topicPerformance: TopicPerformance[];
  skillPerformance: SkillPerformance[];
}): Promise<{
  insights: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}> {
  // Identify strengths and weaknesses from data
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  // Difficulty-based strengths/weaknesses
  if (metrics.difficultyBreakdown.hard.accuracy >= 70) {
    strengths.push('Excellent performance on difficult questions');
  } else if (metrics.difficultyBreakdown.hard.accuracy < 30 && metrics.difficultyBreakdown.hard.total > 0) {
    weaknesses.push('Struggles with hard-level questions');
  }

  if (metrics.difficultyBreakdown.easy.accuracy < 80 && metrics.difficultyBreakdown.easy.total > 0) {
    weaknesses.push('Missing easy questions - review fundamentals');
  }

  // Topic-based strengths/weaknesses
  for (const topic of metrics.topicPerformance) {
    if (topic.total >= 2) {
      if (topic.accuracy >= 80) {
        strengths.push(`Strong in ${topic.topic}`);
      } else if (topic.accuracy < 50) {
        weaknesses.push(`Needs improvement in ${topic.topic}`);
      }
    }
  }

  // Skill-based strengths/weaknesses
  for (const skill of metrics.skillPerformance) {
    if (skill.total >= 2) {
      if (skill.accuracy >= 80) {
        strengths.push(`Proficient in ${skill.skill}`);
      } else if (skill.accuracy < 50) {
        weaknesses.push(`Needs practice in ${skill.skill}`);
      }
    }
  }

  // Generate recommendations
  const recommendations: string[] = [];

  if (metrics.percentage < 50) {
    recommendations.push('Focus on understanding core concepts before attempting advanced topics');
  }

  if (weaknesses.length > 0) {
    const weakTopics = metrics.topicPerformance.filter(t => t.accuracy < 50).map(t => t.topic);
    if (weakTopics.length > 0) {
      recommendations.push(`Review and practice: ${weakTopics.slice(0, 3).join(', ')}`);
    }
  }

  if (metrics.difficultyBreakdown.medium.accuracy < 60) {
    recommendations.push('Work on medium difficulty problems to build problem-solving skills');
  }

  // Try to get AI-generated insights
  let aiInsights = '';
  try {
    const prompt = `Analyze this test performance and provide a brief, personalized assessment (2-3 sentences):

Overall Score: ${metrics.percentage.toFixed(1)}%
Easy Questions: ${metrics.difficultyBreakdown.easy.accuracy.toFixed(1)}% accuracy
Medium Questions: ${metrics.difficultyBreakdown.medium.accuracy.toFixed(1)}% accuracy
Hard Questions: ${metrics.difficultyBreakdown.hard.accuracy.toFixed(1)}% accuracy

Top performing topics: ${metrics.topicPerformance.filter(t => t.accuracy >= 70).map(t => t.topic).join(', ') || 'None'}
Weak topics: ${metrics.topicPerformance.filter(t => t.accuracy < 50).map(t => t.topic).join(', ') || 'None'}

Provide constructive, encouraging feedback focusing on improvement areas.`;

    const response = await callLLM([{ role: 'user', content: prompt }]);
    if (response.content) {
      aiInsights = response.content;
    }
  } catch (error) {
    console.error('Failed to generate AI insights:', error);
    aiInsights = `Performance score: ${metrics.percentage.toFixed(1)}%. ${
      metrics.percentage >= 70
        ? 'Good performance overall.'
        : metrics.percentage >= 50
        ? 'Average performance with room for improvement.'
        : 'Significant improvement needed.'
    }`;
  }

  return {
    insights: aiInsights,
    strengths: strengths.slice(0, 5),
    weaknesses: weaknesses.slice(0, 5),
    recommendations: recommendations.slice(0, 5),
  };
}

/**
 * Generate comprehensive performance evaluation for an attempt
 */
export async function generatePerformanceEvaluation(attemptId: string): Promise<PerformanceMetrics | null> {
  try {
    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: true,
        proctorSession: {
          include: {
            events: { where: { dismissed: false } },
          },
        },
      },
    });

    if (!attempt) {
      console.error('Attempt not found:', attemptId);
      return null;
    }

    // Analyze MCQ and coding answers
    const mcqAnalysis = await analyzeMCQAnswers(attemptId);
    const codingAnalysis = await analyzeCodingAnswers(attemptId);

    // Calculate overall metrics
    const totalScore = attempt.score || 0;
    const maxScore = attempt.test.totalMarks;
    const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

    // Calculate percentile
    const percentile = await calculatePercentile(attempt.testId, totalScore);

    // Calculate time analysis
    const totalTimeTaken = attempt.submittedAt && attempt.startTime
      ? Math.floor((new Date(attempt.submittedAt).getTime() - new Date(attempt.startTime).getTime()) / 1000)
      : 0;
    const totalQuestions = mcqAnalysis.totalQuestions;
    const avgTimePerQuestion = totalQuestions > 0 ? totalTimeTaken / totalQuestions : 0;
    const expectedTimePerQuestion = (attempt.test.duration * 60) / Math.max(totalQuestions, 1);

    let timeEfficiency: 'fast' | 'normal' | 'slow' = 'normal';
    if (avgTimePerQuestion < expectedTimePerQuestion * 0.5) {
      timeEfficiency = 'fast';
    } else if (avgTimePerQuestion > expectedTimePerQuestion * 1.5) {
      timeEfficiency = 'slow';
    }

    // Calculate trust score from proctoring
    let trustScore: number | undefined;
    if (attempt.proctorSession) {
      const trustEvents = attempt.proctorSession.events.filter(event =>
        TRUST_REPORT_EVENT_TYPES.includes(event.eventType)
      );
      trustScore = calculateTrustScoreFromEvents(trustEvents);
    }

    // Generate AI insights
    const aiAnalysis = await generateAIInsights({
      percentage,
      difficultyBreakdown: mcqAnalysis.difficultyBreakdown,
      topicPerformance: mcqAnalysis.topicPerformance,
      skillPerformance: mcqAnalysis.skillPerformance,
    });

    const metrics: PerformanceMetrics = {
      totalScore,
      maxScore,
      percentage,
      percentile,
      grade: calculateGrade(percentage),
      difficultyBreakdown: mcqAnalysis.difficultyBreakdown,
      topicPerformance: mcqAnalysis.topicPerformance,
      skillPerformance: mcqAnalysis.skillPerformance,
      timeAnalysis: {
        totalTimeTaken,
        avgTimePerQuestion: Math.round(avgTimePerQuestion),
        timeEfficiency,
      },
      strengths: aiAnalysis.strengths,
      weaknesses: aiAnalysis.weaknesses,
      recommendations: aiAnalysis.recommendations,
      trustScore,
    };

    // Store analytics in database
    await prisma.performanceAnalytics.upsert({
      where: { attemptId },
      create: {
        attemptId,
        totalScore,
        percentile,
        overallGrade: metrics.grade,
        totalTimeTaken,
        averageTimePerQuestion: Math.round(avgTimePerQuestion),
        easyCorrect: mcqAnalysis.difficultyBreakdown.easy.correct,
        easyTotal: mcqAnalysis.difficultyBreakdown.easy.total,
        easyAccuracy: mcqAnalysis.difficultyBreakdown.easy.accuracy,
        mediumCorrect: mcqAnalysis.difficultyBreakdown.medium.correct,
        mediumTotal: mcqAnalysis.difficultyBreakdown.medium.total,
        mediumAccuracy: mcqAnalysis.difficultyBreakdown.medium.accuracy,
        hardCorrect: mcqAnalysis.difficultyBreakdown.hard.correct,
        hardTotal: mcqAnalysis.difficultyBreakdown.hard.total,
        hardAccuracy: mcqAnalysis.difficultyBreakdown.hard.accuracy,
        topicAnalysis: JSON.stringify(mcqAnalysis.topicPerformance),
        skillAnalysis: JSON.stringify(mcqAnalysis.skillPerformance),
        aiInsights: aiAnalysis.insights,
        strengths: JSON.stringify(aiAnalysis.strengths),
        weaknesses: JSON.stringify(aiAnalysis.weaknesses),
        recommendations: JSON.stringify(aiAnalysis.recommendations),
        trustScore,
        codingMetrics: JSON.stringify(codingAnalysis),
      },
      update: {
        totalScore,
        percentile,
        overallGrade: metrics.grade,
        totalTimeTaken,
        averageTimePerQuestion: Math.round(avgTimePerQuestion),
        easyCorrect: mcqAnalysis.difficultyBreakdown.easy.correct,
        easyTotal: mcqAnalysis.difficultyBreakdown.easy.total,
        easyAccuracy: mcqAnalysis.difficultyBreakdown.easy.accuracy,
        mediumCorrect: mcqAnalysis.difficultyBreakdown.medium.correct,
        mediumTotal: mcqAnalysis.difficultyBreakdown.medium.total,
        mediumAccuracy: mcqAnalysis.difficultyBreakdown.medium.accuracy,
        hardCorrect: mcqAnalysis.difficultyBreakdown.hard.correct,
        hardTotal: mcqAnalysis.difficultyBreakdown.hard.total,
        hardAccuracy: mcqAnalysis.difficultyBreakdown.hard.accuracy,
        topicAnalysis: JSON.stringify(mcqAnalysis.topicPerformance),
        skillAnalysis: JSON.stringify(mcqAnalysis.skillPerformance),
        aiInsights: aiAnalysis.insights,
        strengths: JSON.stringify(aiAnalysis.strengths),
        weaknesses: JSON.stringify(aiAnalysis.weaknesses),
        recommendations: JSON.stringify(aiAnalysis.recommendations),
        trustScore,
        codingMetrics: JSON.stringify(codingAnalysis),
      },
    });

    return metrics;
  } catch (error) {
    console.error('Error generating performance evaluation:', error);
    return null;
  }
}

/**
 * Generate test-level analytics
 */
export async function generateTestAnalytics(testId: string): Promise<void> {
  try {
    const attempts = await prisma.testAttempt.findMany({
      where: {
        testId,
        status: { in: ['submitted', 'auto_submitted'] },
        score: { not: null },
      },
      include: {
        test: { select: { passingMarks: true, totalMarks: true } },
        analytics: true,
      },
    });

    if (attempts.length === 0) {
      const emptyDistribution = {};
      await prisma.testAnalytics.upsert({
        where: { testId },
        create: {
          testId,
          totalAttempts: 0,
          completedAttempts: 0,
          averageScore: 0,
          medianScore: 0,
          highestScore: 0,
          lowestScore: 0,
          passRate: 0,
          totalViolations: 0,
          flaggedAttempts: 0,
          averageTrustScore: null,
          scoreDistribution: JSON.stringify(emptyDistribution),
          timeDistribution: JSON.stringify(emptyDistribution),
          lastCalculatedAt: new Date(),
        },
        update: {
          totalAttempts: 0,
          completedAttempts: 0,
          averageScore: 0,
          medianScore: 0,
          highestScore: 0,
          lowestScore: 0,
          passRate: 0,
          totalViolations: 0,
          flaggedAttempts: 0,
          averageTrustScore: null,
          scoreDistribution: JSON.stringify(emptyDistribution),
          timeDistribution: JSON.stringify(emptyDistribution),
          lastCalculatedAt: new Date(),
        },
      });
      return;
    }

    const scores = attempts.map(a => a.score || 0);
    const sortedScores = [...scores].sort((a, b) => a - b);
    const trustScoresByAttemptId = await getTrustScoresForAttemptIds(attempts.map(attempt => attempt.id));
    const trustScores = attempts
      .map(attempt => trustScoresByAttemptId.get(attempt.id))
      .filter((score): score is number => typeof score === 'number');

    const analytics = {
      totalAttempts: attempts.length,
      completedAttempts: attempts.filter(a => a.status === 'submitted').length,
      averageScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      medianScore: sortedScores[Math.floor(sortedScores.length / 2)],
      highestScore: Math.max(...scores),
      lowestScore: Math.min(...scores),
      passRate: (attempts.filter(a => (a.score || 0) >= (attempts[0]?.test?.passingMarks || 0)).length / attempts.length) * 100,
      flaggedAttempts: attempts.filter(a => a.isFlagged).length,
      averageTrustScore:
        trustScores.length > 0
          ? trustScores.reduce((sum, score) => sum + score, 0) / trustScores.length
          : null,
      totalViolations: attempts.reduce((sum, a) => sum + a.violations, 0),
    };

    // Calculate score distribution
    const distribution: Record<string, number> = {};
    for (const score of scores) {
      const bucket = `${Math.floor(score / 10) * 10}-${Math.floor(score / 10) * 10 + 9}`;
      distribution[bucket] = (distribution[bucket] || 0) + 1;
    }

    await prisma.testAnalytics.upsert({
      where: { testId },
      create: {
        testId,
        ...analytics,
        scoreDistribution: JSON.stringify(distribution),
        lastCalculatedAt: new Date(),
      },
      update: {
        ...analytics,
        scoreDistribution: JSON.stringify(distribution),
        lastCalculatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Error generating test analytics:', error);
  }
}

/**
 * Get performance comparison across multiple candidates
 */
export async function getPerformanceComparison(testId: string, filters?: {
  minScore?: number;
  maxScore?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  topic?: string;
  flagged?: boolean;
}): Promise<any[]> {
  const where: any = {
    test: { id: testId },
    status: { in: ['submitted', 'auto_submitted'] },
  };

  if (filters?.flagged !== undefined) {
    where.isFlagged = filters.flagged;
  }

  const attempts = await prisma.testAttempt.findMany({
    where,
    include: {
      candidate: { select: { id: true, name: true, email: true } },
      test: { select: { totalMarks: true } },
      analytics: true,
    },
    orderBy: { score: 'desc' },
  });
  const trustScoresByAttemptId = await getTrustScoresForAttemptIds(attempts.map(attempt => attempt.id));

  return attempts.map(attempt => ({
    candidateId: attempt.candidate.id,
    candidateName: attempt.candidate.name,
    candidateEmail: attempt.candidate.email,
    score: attempt.score,
    percentage: attempt.analytics?.totalScore
      ? (attempt.analytics.totalScore / (attempt.test.totalMarks || 1)) * 100
      : 0,
    percentile: attempt.analytics?.percentile,
    grade: attempt.analytics?.overallGrade,
    trustScore: trustScoresByAttemptId.get(attempt.id),
    violations: attempt.violations,
    isFlagged: attempt.isFlagged,
    difficultyAccuracy: attempt.analytics ? {
      easy: attempt.analytics.easyAccuracy,
      medium: attempt.analytics.mediumAccuracy,
      hard: attempt.analytics.hardAccuracy,
    } : null,
  })).filter(a => {
    if (filters?.minScore !== undefined && (a.score || 0) < filters.minScore) return false;
    if (filters?.maxScore !== undefined && (a.score || 0) > filters.maxScore) return false;
    return true;
  });
}

export default {
  generatePerformanceEvaluation,
  generateTestAnalytics,
  getPerformanceComparison,
};
