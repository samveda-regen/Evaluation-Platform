import { Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import prisma from '../utils/db.js';
import { sendResultEmail } from '../services/emailService.js';
import { getTestGradingPreferences } from '../utils/testPreferences.js';
import { scoreBehavioralAnswer } from '../services/behavioralScoringService.js';
import { scoreWrittenAnswer } from '../services/communicationScoringService.js';

async function resolveCompanyName(companyId: string | null): Promise<string> {
  if (!companyId) return 'Our Team';
  try {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    return company?.name || 'Our Team';
  } catch {
    return 'Our Team';
  }
}

interface AttemptReviewState {
  reviewed: boolean;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  reviewNotes: string | null;
}

async function getAttemptReviewState(attemptId: string): Promise<AttemptReviewState> {
  try {
    const rows = await prisma.$queryRaw<AttemptReviewState[]>`
      SELECT "reviewed", "reviewedAt", "reviewedBy", "reviewNotes"
      FROM "TestAttempt"
      WHERE id = ${attemptId}
      LIMIT 1
    `;
    return rows[0] ?? { reviewed: false, reviewedAt: null, reviewedBy: null, reviewNotes: null };
  } catch {
    return { reviewed: false, reviewedAt: null, reviewedBy: null, reviewNotes: null };
  }
}

async function getAttemptReviewMap(attemptIds: string[]): Promise<Map<string, AttemptReviewState>> {
  if (attemptIds.length === 0) return new Map();
  const entries = await Promise.all(
    attemptIds.map(async id => [id, await getAttemptReviewState(id)] as const)
  );
  return new Map(entries);
}

export async function getTestResults(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const status = req.query.status as string;
    const flagged = req.query.flagged === 'true';

    // Verify admin owns this test
    const test = await prisma.test.findFirst({
      where: {
        id: testId,
        adminId: req.admin!.id
      }
    });

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const where: Record<string, unknown> = { testId };
    if (status) where.status = status;
    if (flagged) where.isFlagged = true;

    const [attempts, total] = await Promise.all([
      prisma.testAttempt.findMany({
        where,
        include: {
          candidate: {
            select: {
              id: true,
              email: true,
              name: true
            }
          },
          _count: {
            select: {
              mcqAnswers: true,
              codingAnswers: true,
              behavioralAnswers: true,
              activityLogs: true
            }
          },
          analytics: {
            select: {
              trustScore: true
            }
          }
        },
        orderBy: { startTime: 'desc' },
        skip,
        take: limit
      }),
      prisma.testAttempt.count({ where })
    ]);

    // Calculate statistics
    const stats = await prisma.testAttempt.aggregate({
      where: { testId, status: { in: ['submitted', 'auto_submitted'] } },
      _avg: { score: true },
      _max: { score: true },
      _min: { score: true },
      _count: true
    });

    const passedCount = test.passingMarks
      ? await prisma.testAttempt.count({
          where: {
            testId,
            status: { in: ['submitted', 'auto_submitted'] },
            score: { gte: test.passingMarks }
          }
        })
      : null;

    const attemptsWithTrust = attempts.map((attempt: typeof attempts[number]) => ({
      ...attempt,
      trustScore:
        typeof attempt.analytics?.trustScore === 'number'
          ? attempt.analytics.trustScore
          : Math.max(0, 100 - attempt.violations * 8),
    }));

    res.json({
      test: {
        id: test.id,
        name: test.name,
        testCode: test.testCode,
        totalMarks: test.totalMarks,
        passingMarks: test.passingMarks
      },
      attempts: attemptsWithTrust,
      statistics: {
        totalAttempts: stats._count,
        averageScore: stats._avg.score,
        highestScore: stats._max.score,
        lowestScore: stats._min.score,
        passedCount,
        passRate: passedCount !== null && stats._count > 0
          ? ((passedCount / stats._count) * 100).toFixed(2) + '%'
          : null
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get test results error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getAttemptDetails(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId } = req.params;

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: {
          select: {
            id: true,
            name: true,
            testCode: true,
            totalMarks: true,
            passingMarks: true,
            negativeMarking: true,
            adminId: true
          }
        },
        candidate: {
          select: {
            id: true,
            email: true,
            name: true
          }
        },
        mcqAnswers: {
          include: {
            question: true
          }
        },
        codingAnswers: {
          include: {
            question: {
              include: { testCases: true }
            }
          }
        },
        behavioralAnswers: {
          include: {
            question: true
          }
        },
        communicationAnswers: {
          include: {
            question: true
          }
        },
        activityLogs: {
          orderBy: { timestamp: 'asc' }
        },
        analytics: {
          select: { trustScore: true }
        }
      }
    });

    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    // Verify admin owns the test
    if (attempt.test.adminId !== req.admin!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Format MCQ answers with question details
    const mcqAnswers = attempt.mcqAnswers.map((a: typeof attempt.mcqAnswers[number]) => ({
      questionId: a.questionId,
      questionText: a.question.questionText,
      options: JSON.parse(a.question.options),
      correctAnswers: JSON.parse(a.question.correctAnswers),
      selectedOptions: JSON.parse(a.selectedOptions),
      isCorrect: a.isCorrect,
      marks: a.question.marks,
      marksObtained: a.marksObtained
    }));

    // Format coding answers
    const codingAnswers = attempt.codingAnswers.map((a: typeof attempt.codingAnswers[number]) => ({
      questionId: a.questionId,
      title: a.question.title,
      code: a.code,
      language: a.language,
      testResults: a.testResults ? JSON.parse(a.testResults) : null,
      marks: a.question.marks,
      marksObtained: a.marksObtained
    }));

    const behavioralAnswers = attempt.behavioralAnswers.map((a: typeof attempt.behavioralAnswers[number]) => ({
      questionId: a.questionId,
      title: a.question.title,
      description: a.question.description,
      answerText: a.answerText,
      marks: a.question.marks,
      marksObtained: a.marksObtained
    }));

    const communicationAnswers = attempt.communicationAnswers.map((a: typeof attempt.communicationAnswers[number]) => ({
      questionId: a.questionId,
      subType: a.question.subType,
      title: a.question.title,
      description: a.question.description,
      answerText: a.answerText,
      selectedOptions: a.selectedOptions ? JSON.parse(a.selectedOptions) : null,
      options: a.question.options ? JSON.parse(a.question.options) : null,
      correctAnswers: a.question.correctAnswers ? JSON.parse(a.question.correctAnswers) : null,
      isCorrect: a.isCorrect,
      transcript: a.transcript,
      replayCount: a.replayCount,
      gradingDetail: a.gradingDetail ? JSON.parse(a.gradingDetail) : null,
      marks: a.question.marks,
      marksObtained: a.marksObtained
    }));

    const reviewState = await getAttemptReviewState(attempt.id);

    res.json({
      attempt: {
        id: attempt.id,
        startTime: attempt.startTime,
        endTime: attempt.endTime,
        submittedAt: attempt.submittedAt,
        status: attempt.status,
        score: attempt.score,
        violations: attempt.violations,
        isFlagged: attempt.isFlagged,
        flagReason: attempt.flagReason,
        trustScore: typeof attempt.analytics?.trustScore === 'number' ? attempt.analytics.trustScore : 100,
        reviewed: reviewState.reviewed,
        reviewedAt: reviewState.reviewedAt,
        reviewedBy: reviewState.reviewedBy,
        reviewNotes: reviewState.reviewNotes,
        resultReleased: attempt.resultReleased,
        releasedAt: attempt.releasedAt,
        releasedBy: attempt.releasedBy,
        resultEmailSentAt: attempt.resultEmailSentAt
      },
      test: attempt.test,
      candidate: attempt.candidate,
      mcqAnswers,
      codingAnswers,
      behavioralAnswers,
      communicationAnswers,
      activityLogs: attempt.activityLogs
    });
  } catch (error) {
    console.error('Get attempt details error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function reviewAttempt(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId } = req.params;
    const { reviewed = true, reviewNotes } = req.body;

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: { select: { adminId: true } }
      }
    });

    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    if (attempt.test.adminId !== req.admin!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const isReviewed = Boolean(reviewed);
    await prisma.$executeRaw`
      UPDATE "TestAttempt"
      SET
        "reviewed" = ${isReviewed},
        "reviewedAt" = ${isReviewed ? new Date() : null},
        "reviewedBy" = ${isReviewed ? req.admin!.id : null},
        "reviewNotes" = ${isReviewed && typeof reviewNotes === 'string' && reviewNotes.trim() ? reviewNotes.trim() : null}
      WHERE id = ${attemptId}
    `;

    const reviewState = await getAttemptReviewState(attemptId);
    res.json({
      message: isReviewed ? 'Attempt marked as reviewed' : 'Attempt review cleared',
      attempt: {
        id: attemptId,
        ...reviewState
      }
    });
  } catch (error) {
    console.error('Review attempt error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Releases a manually-graded attempt's results to the candidate (score visibility +
// result email become active per the test's settings, same as Automatic grading does at submission time).
export async function releaseAttemptResult(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId } = req.params;

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: { select: { id: true, adminId: true, name: true, companyId: true, totalMarks: true, passingMarks: true } },
        candidate: { select: { email: true, name: true } }
      }
    });

    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    if (attempt.test.adminId !== req.admin!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const updated = await prisma.testAttempt.update({
      where: { id: attemptId },
      data: {
        resultReleased: true,
        releasedAt: new Date(),
        releasedBy: req.admin!.id
      }
    });

    if (attempt.candidate?.email && !attempt.resultEmailSentAt && attempt.score != null) {
      const preferences = await getTestGradingPreferences(attempt.test.id);
      if (preferences.sendResultEmail) {
        try {
          const passed = attempt.test.passingMarks != null ? attempt.score >= attempt.test.passingMarks : null;
          await sendResultEmail({
            to: attempt.candidate.email,
            candidateName: attempt.candidate.name || 'Candidate',
            testName: attempt.test.name,
            companyName: await resolveCompanyName(attempt.test.companyId),
            score: attempt.score,
            totalMarks: attempt.test.totalMarks,
            passed
          });
          await prisma.testAttempt.update({ where: { id: attemptId }, data: { resultEmailSentAt: new Date() } });
        } catch (err) {
          console.error('Result email error (release):', err);
        }
      }
    }

    res.json({
      message: 'Results released to candidate',
      attempt: {
        id: updated.id,
        resultReleased: updated.resultReleased,
        releasedAt: updated.releasedAt,
        releasedBy: updated.releasedBy
      }
    });
  } catch (error) {
    console.error('Release attempt result error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Lets an admin manually (re)send the result email for a single attempt, regardless of
// the test's automatic sendResultEmail/gradingMode settings — an explicit one-off action.
export async function sendAttemptResultEmail(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId } = req.params;

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: { select: { adminId: true, name: true, companyId: true, totalMarks: true, passingMarks: true } },
        candidate: { select: { email: true, name: true } }
      }
    });

    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    if (attempt.test.adminId !== req.admin!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (!attempt.candidate?.email) {
      res.status(400).json({ error: 'Candidate has no email on file' });
      return;
    }

    if (attempt.score == null) {
      res.status(400).json({ error: 'Attempt has not been scored yet' });
      return;
    }

    const passed = attempt.test.passingMarks != null ? attempt.score >= attempt.test.passingMarks : null;
    await sendResultEmail({
      to: attempt.candidate.email,
      candidateName: attempt.candidate.name || 'Candidate',
      testName: attempt.test.name,
      companyName: await resolveCompanyName(attempt.test.companyId),
      score: attempt.score,
      totalMarks: attempt.test.totalMarks,
      passed
    });

    const updated = await prisma.testAttempt.update({
      where: { id: attemptId },
      data: { resultEmailSentAt: new Date() }
    });

    res.json({
      message: 'Result email sent',
      attempt: { id: updated.id, resultEmailSentAt: updated.resultEmailSentAt }
    });
  } catch (error) {
    console.error('Send attempt result email error:', error);
    res.status(500).json({ error: 'Failed to send result email' });
  }
}

// Recomputes a TestAttempt's total score from its current mcq/coding/behavioral/communication
// marksObtained values and persists it. Shared by manual and AI grading so both stay in sync.
async function recalculateAttemptScore(attemptId: string): Promise<number> {
  const attempt = await prisma.testAttempt.findUnique({
    where: { id: attemptId },
    select: {
      mcqAnswers: { select: { marksObtained: true } },
      codingAnswers: { select: { marksObtained: true } },
      behavioralAnswers: { select: { marksObtained: true } },
      communicationAnswers: { select: { marksObtained: true } }
    }
  });

  const mcqTotal = attempt?.mcqAnswers.reduce((sum, a) => sum + (a.marksObtained ?? 0), 0) ?? 0;
  const codingTotal = attempt?.codingAnswers.reduce((sum, a) => sum + (a.marksObtained ?? 0), 0) ?? 0;
  const behavioralTotal = attempt?.behavioralAnswers.reduce((sum, a) => sum + (a.marksObtained ?? 0), 0) ?? 0;
  const communicationTotal = attempt?.communicationAnswers.reduce((sum, a) => sum + (a.marksObtained ?? 0), 0) ?? 0;
  const newScore = mcqTotal + codingTotal + behavioralTotal + communicationTotal;

  await prisma.testAttempt.update({ where: { id: attemptId }, data: { score: newScore } });
  return newScore;
}

// Admin manually assigns/overrides marks for a free-text behavioral answer. This is the backup
// path used when the AI auto-score (below) is missing, failed, or needs correcting.
export async function gradeBehavioralAnswer(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId, questionId } = req.params;
    const { marksObtained } = req.body;

    if (typeof marksObtained !== 'number' || Number.isNaN(marksObtained)) {
      res.status(400).json({ error: 'marksObtained must be a number' });
      return;
    }

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: { select: { adminId: true } },
        behavioralAnswers: { select: { id: true, questionId: true, question: { select: { marks: true } } } }
      }
    });

    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    if (attempt.test.adminId !== req.admin!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const behavioralAnswer = attempt.behavioralAnswers.find(a => a.questionId === questionId);
    if (!behavioralAnswer) {
      res.status(404).json({ error: 'Behavioral answer not found' });
      return;
    }

    const maxMarks = behavioralAnswer.question.marks;
    const clampedMarks = Math.min(maxMarks, Math.max(0, marksObtained));

    await prisma.behavioralAnswer.update({
      where: { id: behavioralAnswer.id },
      data: { marksObtained: clampedMarks }
    });

    const newScore = await recalculateAttemptScore(attemptId);

    res.json({
      message: 'Behavioral answer graded',
      questionId,
      marksObtained: clampedMarks,
      score: newScore
    });
  } catch (error) {
    console.error('Grade behavioral answer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Auto-grades a free-text behavioral answer via the LLM, using the question library's
// title/description/expectedAnswer/marks as the grading benchmark, and PERSISTS the result as
// the default score (called automatically by the frontend as soon as an ungraded answer is
// viewed, no admin click required). Manual grading (gradeBehavioralAnswer above) remains fully
// available as a backup — an admin can always overwrite this score if the AI gets it wrong.
export async function autoGradeBehavioralAnswer(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId, questionId } = req.params;

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: { select: { adminId: true } },
        behavioralAnswers: {
          where: { questionId },
          select: {
            id: true,
            answerText: true,
            question: { select: { title: true, description: true, expectedAnswer: true, marks: true } }
          }
        }
      }
    });

    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    if (attempt.test.adminId !== req.admin!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const behavioralAnswer = attempt.behavioralAnswers[0];
    if (!behavioralAnswer) {
      res.status(404).json({ error: 'Behavioral answer not found' });
      return;
    }

    const result = await scoreBehavioralAnswer({
      title: behavioralAnswer.question.title,
      description: behavioralAnswer.question.description,
      expectedAnswer: behavioralAnswer.question.expectedAnswer,
      maxMarks: behavioralAnswer.question.marks,
      answerText: behavioralAnswer.answerText
    });

    await prisma.behavioralAnswer.update({
      where: { id: behavioralAnswer.id },
      data: { marksObtained: result.marksObtained }
    });

    const newScore = await recalculateAttemptScore(attemptId);

    res.json({
      questionId,
      marksObtained: result.marksObtained,
      maxMarks: behavioralAnswer.question.marks,
      reasoning: result.reasoning,
      score: newScore
    });
  } catch (error) {
    console.error('Auto grade behavioral answer error:', error);
    res.status(500).json({ error: 'Failed to generate AI score. Please grade manually.' });
  }
}

// Admin manually assigns/overrides marks for a Written/Speaking communication answer. Listening
// and Reading are auto-scored elsewhere (they're MCQ-shaped) and are not gradable through this
// endpoint — mirrors gradeBehavioralAnswer above.
export async function gradeCommunicationAnswer(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId, questionId } = req.params;
    const { marksObtained } = req.body;

    if (typeof marksObtained !== 'number' || Number.isNaN(marksObtained)) {
      res.status(400).json({ error: 'marksObtained must be a number' });
      return;
    }

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: { select: { adminId: true } },
        communicationAnswers: { select: { id: true, questionId: true, question: { select: { marks: true, subType: true } } } }
      }
    });

    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    if (attempt.test.adminId !== req.admin!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const communicationAnswer = attempt.communicationAnswers.find(a => a.questionId === questionId);
    if (!communicationAnswer) {
      res.status(404).json({ error: 'Communication answer not found' });
      return;
    }
    if (communicationAnswer.question.subType !== 'WRITTEN' && communicationAnswer.question.subType !== 'SPEAKING') {
      res.status(400).json({ error: 'Listening/Reading answers are scored automatically and cannot be graded manually.' });
      return;
    }

    const maxMarks = communicationAnswer.question.marks;
    const clampedMarks = Math.min(maxMarks, Math.max(0, marksObtained));

    await prisma.communicationAnswer.update({
      where: { id: communicationAnswer.id },
      data: { marksObtained: clampedMarks }
    });

    const newScore = await recalculateAttemptScore(attemptId);

    res.json({
      message: 'Communication answer graded',
      questionId,
      marksObtained: clampedMarks,
      score: newScore
    });
  } catch (error) {
    console.error('Grade communication answer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Auto-grades a Written answer via the LLM (Speaking auto-grading lands in a later phase once
// Whisper transcription is wired up). Mirrors autoGradeBehavioralAnswer's contract.
export async function autoGradeCommunicationAnswer(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId, questionId } = req.params;

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: { select: { adminId: true } },
        communicationAnswers: {
          where: { questionId },
          select: {
            id: true,
            answerText: true,
            question: { select: { subType: true, title: true, description: true, evaluationNotes: true, marks: true } }
          }
        }
      }
    });

    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    if (attempt.test.adminId !== req.admin!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const communicationAnswer = attempt.communicationAnswers[0];
    if (!communicationAnswer) {
      res.status(404).json({ error: 'Communication answer not found' });
      return;
    }
    if (communicationAnswer.question.subType !== 'WRITTEN') {
      res.status(400).json({ error: 'AI auto-grading is currently only available for Written answers.' });
      return;
    }

    const result = await scoreWrittenAnswer({
      title: communicationAnswer.question.title,
      description: communicationAnswer.question.description ?? '',
      evaluationNotes: communicationAnswer.question.evaluationNotes,
      maxMarks: communicationAnswer.question.marks,
      answerText: communicationAnswer.answerText ?? ''
    });

    await prisma.communicationAnswer.update({
      where: { id: communicationAnswer.id },
      data: { marksObtained: result.marksObtained, gradingDetail: JSON.stringify({ reasoning: result.reasoning }) }
    });

    const newScore = await recalculateAttemptScore(attemptId);

    res.json({
      questionId,
      marksObtained: result.marksObtained,
      maxMarks: communicationAnswer.question.marks,
      reasoning: result.reasoning,
      score: newScore
    });
  } catch (error) {
    console.error('Auto grade communication answer error:', error);
    res.status(500).json({ error: 'Failed to generate AI score. Please grade manually.' });
  }
}

export async function flagAttempt(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId } = req.params;
    const { isFlagged, reason } = req.body;

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: { select: { adminId: true } }
      }
    });

    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    if (attempt.test.adminId !== req.admin!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    await prisma.testAttempt.update({
      where: { id: attemptId },
      data: {
        isFlagged: isFlagged ?? true,
        flagReason: reason || null
      }
    });

    res.json({ message: 'Attempt flagged successfully' });
  } catch (error) {
    console.error('Flag attempt error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteAttempt(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId } = req.params;

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: { test: { select: { adminId: true } } }
    });

    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    if (attempt.test.adminId !== req.admin!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    await prisma.testAttempt.delete({ where: { id: attemptId } });

    res.json({ message: 'Attempt deleted successfully' });
  } catch (error) {
    console.error('Delete attempt error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function reEvaluateAttempt(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId } = req.params;

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: {
          select: {
            adminId: true,
            negativeMarking: true
          }
        },
        mcqAnswers: {
          include: { question: true }
        },
        codingAnswers: {
          include: {
            question: {
              include: { testCases: true }
            }
          }
        },
        behavioralAnswers: {
          select: { marksObtained: true }
        },
        communicationAnswers: {
          include: { question: true }
        }
      }
    });

    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    if (attempt.test.adminId !== req.admin!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    let totalScore = 0;

    // Re-evaluate MCQ answers
    for (const mcqAnswer of attempt.mcqAnswers) {
      const correctAnswers = JSON.parse(mcqAnswer.question.correctAnswers) as number[];
      const selectedOptions = JSON.parse(mcqAnswer.selectedOptions) as number[];

      const isCorrect =
        correctAnswers.length === selectedOptions.length &&
        correctAnswers.every((a: number) => selectedOptions.includes(a));

      let marks = 0;
      if (isCorrect) {
        marks = mcqAnswer.question.marks;
      } else if (selectedOptions.length > 0 && attempt.test.negativeMarking > 0) {
        marks = -attempt.test.negativeMarking;
      }

      totalScore += marks;

      await prisma.mCQAnswer.update({
        where: { id: mcqAnswer.id },
        data: {
          isCorrect,
          marksObtained: marks
        }
      });
    }

    // Re-evaluate coding answers
    const { executeCode, compareOutput } = await import('../utils/codeExecutor.js');

    for (const codingAnswer of attempt.codingAnswers) {
      const question = codingAnswer.question;
      const testResults = [];
      let passedTests = 0;

      for (const testCase of question.testCases) {
        const result = await executeCode({
          language: codingAnswer.language,
          code: codingAnswer.code,
          input: testCase.input,
          timeLimit: question.timeLimit
        });

        const passed = result.success && compareOutput(testCase.expectedOutput, result.output || '');

        testResults.push({
          testCaseId: testCase.id,
          passed,
          executionTime: result.executionTime,
          error: result.error
        });

        if (passed) passedTests++;
      }

      let marks = 0;
      if (question.partialScoring) {
        marks = (passedTests / question.testCases.length) * question.marks;
      } else {
        marks = passedTests === question.testCases.length ? question.marks : 0;
      }

      totalScore += marks;

      await prisma.codingAnswer.update({
        where: { id: codingAnswer.id },
        data: {
          testResults: JSON.stringify(testResults),
          marksObtained: marks
        }
      });
    }

    // Fold in already-graded behavioral marks — this endpoint only re-runs MCQ/coding
    // auto-grading and must not silently drop manually-graded behavioral scores.
    for (const behavioralAnswer of attempt.behavioralAnswers) {
      totalScore += behavioralAnswer.marksObtained ?? 0;
    }

    // Communication: Listening/Reading are MCQ-shaped and re-auto-score here (same exact-match
    // rule); Written/Speaking are LLM/manually graded elsewhere, so their already-set marksObtained
    // is simply folded in, mirroring the behavioral fold-in above.
    for (const communicationAnswer of attempt.communicationAnswers) {
      const question = communicationAnswer.question;
      if (question.subType === 'LISTENING' || question.subType === 'READING') {
        const correctAnswers = question.correctAnswers ? (JSON.parse(question.correctAnswers) as number[]) : [];
        const selectedOptions = communicationAnswer.selectedOptions ? (JSON.parse(communicationAnswer.selectedOptions) as number[]) : [];
        const isCorrect =
          correctAnswers.length === selectedOptions.length &&
          correctAnswers.every((a: number) => selectedOptions.includes(a));
        const marks = isCorrect ? question.marks : 0;
        totalScore += marks;

        await prisma.communicationAnswer.update({
          where: { id: communicationAnswer.id },
          data: { isCorrect, marksObtained: marks }
        });
      } else {
        totalScore += communicationAnswer.marksObtained ?? 0;
      }
    }

    // Update attempt score
    await prisma.testAttempt.update({
      where: { id: attemptId },
      data: { score: totalScore }
    });

    res.json({
      message: 'Re-evaluation completed',
      newScore: totalScore
    });
  } catch (error) {
    console.error('Re-evaluate attempt error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function exportResults(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId } = req.params;
    const format = (req.query.format as string) || 'csv';

    // Verify admin owns this test
    const test = await prisma.test.findFirst({
      where: {
        id: testId,
        adminId: req.admin!.id
      }
    });

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const attempts = await prisma.testAttempt.findMany({
      where: { testId },
      include: {
        candidate: {
          select: {
            email: true,
            name: true
          }
        }
      },
      orderBy: { startTime: 'asc' }
    });

    if (format === 'csv') {
      const headers = [
        'Candidate Name',
        'Email',
        'Start Time',
        'End Time',
        'Status',
        'Score',
        'Violations',
        'Flagged'
      ];

      const rows = attempts.map((a: typeof attempts[number]) => [
        a.candidate.name,
        a.candidate.email,
        a.startTime.toISOString(),
        a.endTime?.toISOString() || '',
        a.status,
        a.score?.toString() || '0',
        a.violations.toString(),
        a.isFlagged ? 'Yes' : 'No'
      ]);

      const csv = [
        headers.join(','),
        ...rows.map((r: string[]) => r.map((cell: string) => `"${cell}"`).join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${test.name}_results.csv"`);
      res.send(csv);
    } else if (format === 'json') {
      res.json({
        test: {
          id: test.id,
          name: test.name,
          testCode: test.testCode,
          totalMarks: test.totalMarks
        },
        results: attempts.map((a: typeof attempts[number]) => ({
          candidateName: a.candidate.name,
          email: a.candidate.email,
          startTime: a.startTime,
          endTime: a.endTime,
          status: a.status,
          score: a.score,
          violations: a.violations,
          flagged: a.isFlagged
        }))
      });
    } else {
      res.status(400).json({ error: 'Invalid format. Use csv or json' });
    }
  } catch (error) {
    console.error('Export results error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getDashboardStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const adminId = req.admin!.id;

    // Last 7 days window
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const now = new Date();

    const [
      totalTests,
      activeTests,
      totalAttempts,
      totalQuestions,
      recentAttempts,
      weeklyRaw,
      flaggedCount,
      avgTrustRow,
    ] = await Promise.all([
      prisma.test.count({ where: { adminId } }),
      prisma.test.count({
        where: {
          adminId,
          isActive: true,
          startTime: { lte: now },
          OR: [
            { endTime: null },
            { endTime: { gte: now } }
          ]
        }
      }),
      prisma.testAttempt.count({ where: { test: { adminId } } }),
      Promise.all([
        prisma.mCQQuestion.count(),
        prisma.codingQuestion.count()
      ]).then(([mcq, coding]) => mcq + coding),
      prisma.testAttempt.findMany({
        where: { test: { adminId } },
        include: {
          candidate: { select: { name: true, email: true } },
          test: { select: { name: true, totalMarks: true } }
        },
        orderBy: { startTime: 'desc' },
        take: 10
      }),
      // Raw attempts from last 7 days for weekly chart
      prisma.testAttempt.findMany({
        where: { test: { adminId }, startTime: { gte: sevenDaysAgo } },
        select: { startTime: true }
      }),
      // Flagged attempts for integrity chart
      prisma.testAttempt.count({ where: { test: { adminId }, isFlagged: true } }),
      // Average trust score — fetch trust scores from attempts' analytics
      prisma.testAttempt.findMany({
        where: { test: { adminId } },
        select: { analytics: { select: { trustScore: true } } }
      }),
    ]);

    // Build day-by-day counts for last 7 days
    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weeklyAttempts = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
      const dayEnd   = new Date(d); dayEnd.setHours(23, 59, 59, 999);
      const value = weeklyRaw.filter(a => {
        const t = new Date(a.startTime);
        return t >= dayStart && t <= dayEnd;
      }).length;
      return { label: DAY_LABELS[d.getDay()], value };
    });

    // Compute avg trust score from fetched rows
    const trustScores = (avgTrustRow as { analytics: { trustScore: number | null } | null }[])
      .map(a => a.analytics?.trustScore ?? null)
      .filter((s): s is number => s !== null);
    const avgTrustScore = trustScores.length
      ? Math.round(trustScores.reduce((s, v) => s + v, 0) / trustScores.length)
      : 0;

    const recentAttemptReviewMap = await getAttemptReviewMap(recentAttempts.map(attempt => attempt.id));
    const recentAttemptsWithReview = recentAttempts.map(attempt => ({
      ...attempt,
      ...(recentAttemptReviewMap.get(attempt.id) ?? { reviewed: false, reviewedAt: null, reviewedBy: null, reviewNotes: null }),
    }));

    res.json({
      stats: { totalTests, activeTests, totalAttempts, totalQuestions },
      recentAttempts: recentAttemptsWithReview,
      weeklyAttempts,
      integrityStats: {
        flagged: flaggedCount,
        clean: Math.max(0, totalAttempts - flaggedCount),
        avgTrustScore,
      },
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getAllAttempts(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const adminId = req.admin!.id;
    const page  = Math.max(1, parseInt(req.query.page  as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
    const skip  = (page - 1) * limit;
    const testId = ((req.query.testId as string) || '').trim();
    const status = ((req.query.status as string) || '').trim();
    const reviewed = ((req.query.reviewed as string) || '').trim();
    const search = ((req.query.search as string) || '').trim();

    const where: Record<string, unknown> = { test: { adminId } };
    if (testId)  where.testId = testId;
    if (status)  where.status = status;
    if (reviewed === 'true' || reviewed === 'false') {
      try {
        const reviewRows = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT ta.id
          FROM "TestAttempt" ta
          INNER JOIN "Test" t ON t.id = ta."testId"
          WHERE t."adminId" = ${adminId} AND ta."reviewed" = ${reviewed === 'true'}
        `;
        where.id = { in: reviewRows.map(row => row.id) };
      } catch {
        where.id = { in: [] };
      }
    }
    if (search) {
      where.OR = [
        { candidate: { name:  { contains: search } } },
        { candidate: { email: { contains: search } } },
        { test:      { name:  { contains: search } } },
      ];
    }

    const [attempts, total, tests] = await Promise.all([
      prisma.testAttempt.findMany({
        where,
        include: {
          candidate: { select: { id: true, name: true, email: true } },
          test:      { select: { id: true, name: true } },
          analytics: { select: { trustScore: true } },
        },
        orderBy: { startTime: 'desc' },
        skip,
        take: limit,
      }),
      prisma.testAttempt.count({ where }),
      prisma.test.findMany({
        where: { adminId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const reviewMap = await getAttemptReviewMap(attempts.map(attempt => attempt.id));

    res.json({
      attempts: attempts.map(a => ({
        id:            a.id,
        startTime:     a.startTime,
        endTime:       a.endTime,
        submittedAt:   a.submittedAt,
        status:        a.status,
        score:         a.score,
        violations:    a.violations,
        isFlagged:     a.isFlagged,
        reviewed:      reviewMap.get(a.id)?.reviewed ?? false,
        reviewedAt:    reviewMap.get(a.id)?.reviewedAt ?? null,
        candidate:     a.candidate,
        test:          { id: a.test.id, name: a.test.name },
        trustScore:    typeof a.analytics?.trustScore === 'number'
                         ? a.analytics.trustScore
                         : Math.max(0, 100 - a.violations * 8),
      })),
      tests,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Get all attempts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getRecentCompletedAttempts(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const adminId = req.admin!.id;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);

    const attempts = await prisma.testAttempt.findMany({
      where: {
        test: { adminId },
        status: { in: ['submitted', 'auto_submitted'] },
        submittedAt: { not: null }
      },
      include: {
        candidate: { select: { name: true, email: true } },
        test: { select: { id: true, name: true } }
      },
      orderBy: { submittedAt: 'desc' },
      take: limit
    });

    res.json({
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        status: attempt.status,
        submittedAt: attempt.submittedAt,
        candidate: attempt.candidate,
        test: attempt.test
      }))
    });
  } catch (error) {
    console.error('Get recent completed attempts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
