import { Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import prisma from '../utils/db.js';

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
        activityLogs: {
          orderBy: { timestamp: 'asc' }
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
        flagReason: attempt.flagReason
      },
      test: attempt.test,
      candidate: attempt.candidate,
      mcqAnswers,
      codingAnswers,
      behavioralAnswers,
      activityLogs: attempt.activityLogs
    });
  } catch (error) {
    console.error('Get attempt details error:', error);
    res.status(500).json({ error: 'Internal server error' });
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

    const [
      totalTests,
      activeTests,
      totalAttempts,
      totalQuestions,
      recentAttempts
    ] = await Promise.all([
      prisma.test.count({ where: { adminId } }),
      prisma.test.count({ where: { adminId, isActive: true } }),
      prisma.testAttempt.count({
        where: { test: { adminId } }
      }),
      Promise.all([
        prisma.mCQQuestion.count(),
        prisma.codingQuestion.count()
      ]).then(([mcq, coding]) => mcq + coding),
      prisma.testAttempt.findMany({
        where: { test: { adminId } },
        include: {
          candidate: { select: { name: true, email: true } },
          test: { select: { name: true } }
        },
        orderBy: { startTime: 'desc' },
        take: 10
      })
    ]);

    res.json({
      stats: {
        totalTests,
        activeTests,
        totalAttempts,
        totalQuestions
      },
      recentAttempts
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
