import prisma from '../utils/db.js';
import { compareOutput, executeCode } from '../utils/codeExecutor.js';

type ScoringStatus = 'complete' | 'pending_manual';

interface ScoreAttemptResult {
  score: number;
  totalMarks: number;
  scoringStatus: ScoringStatus;
  pendingManualMarks: number;
}

interface CodingTestCase {
  id: string;
  input: string;
  expectedOutput: string;
  marks: number;
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function scorePassedCodingCases(
  question: { marks: number; partialScoring: boolean; testCases: CodingTestCase[] },
  passedTestCaseIds: Set<string>
): number {
  if (!question.partialScoring) {
    return passedTestCaseIds.size === question.testCases.length ? question.marks : 0;
  }

  const weightedScore = question.testCases.reduce(
    (sum, testCase) => sum + (passedTestCaseIds.has(testCase.id) ? testCase.marks : 0),
    0
  );

  return Math.min(roundScore(weightedScore), question.marks);
}

function getAssignedQuestionIds(
  attemptQuestions: Array<{
    testQuestion: {
      mcqQuestionId: string | null;
      codingQuestionId: string | null;
      behavioralQuestionId: string | null;
    };
  }>,
  fallback: Array<{
    mcqQuestionId: string | null;
    codingQuestionId: string | null;
    behavioralQuestionId: string | null;
  }>
): Set<string> {
  const source = attemptQuestions.length > 0
    ? attemptQuestions.map((item) => item.testQuestion)
    : fallback;

  return new Set(
    source
      .flatMap((question) => [
        question.mcqQuestionId,
        question.codingQuestionId,
        question.behavioralQuestionId
      ])
      .filter((id): id is string => typeof id === 'string')
  );
}

export async function scoreAttemptAnswers(attemptId: string): Promise<ScoreAttemptResult> {
  const attempt = await prisma.testAttempt.findUnique({
    where: { id: attemptId },
    include: {
      test: {
        include: {
          questions: {
            include: {
              mcqQuestion: { select: { marks: true } },
              codingQuestion: { select: { marks: true, autoEvaluate: true } },
              behavioralQuestion: { select: { marks: true } }
            }
          }
        }
      },
      attemptQuestions: {
        include: {
          testQuestion: true
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
      }
    }
  });

  if (!attempt) {
    throw new Error('Attempt not found');
  }

  const assignedQuestionIds = getAssignedQuestionIds(attempt.attemptQuestions, attempt.test.questions);
  const assignedTotalMarks = attempt.test.questions.reduce((sum, question) => {
    const questionId = question.mcqQuestionId ?? question.codingQuestionId ?? question.behavioralQuestionId;
    const marks =
      question.mcqQuestion?.marks ??
      question.codingQuestion?.marks ??
      question.behavioralQuestion?.marks ??
      0;
    return sum + (questionId && assignedQuestionIds.has(questionId) ? marks : 0);
  }, 0);
  let totalScore = 0;
  let pendingManualMarks = 0;
  const answeredCodingQuestionIds = new Set<string>();
  const answeredBehavioralQuestionIds = new Set<string>();

  const mcqUpdates: Array<{ id: string; isCorrect: boolean; marksObtained: number }> = [];
  for (const mcqAnswer of attempt.mcqAnswers) {
    if (!assignedQuestionIds.has(mcqAnswer.questionId)) continue;

    const correctAnswers = JSON.parse(mcqAnswer.question.correctAnswers) as number[];
    const selectedOptions = JSON.parse(mcqAnswer.selectedOptions) as number[];

    const isCorrect =
      correctAnswers.length === selectedOptions.length &&
      correctAnswers.every((answer: number) => selectedOptions.includes(answer));

    let marks = 0;
    if (isCorrect) {
      marks = mcqAnswer.question.marks;
    } else if (selectedOptions.length > 0 && attempt.test.negativeMarking > 0) {
      marks = -attempt.test.negativeMarking;
    }

    totalScore += marks;
    mcqUpdates.push({ id: mcqAnswer.id, isCorrect, marksObtained: marks });
  }

  const codingUpdates: Array<{ id: string; testResults: string | null; marksObtained: number | null }> = [];
  for (const codingAnswer of attempt.codingAnswers) {
    if (!assignedQuestionIds.has(codingAnswer.questionId)) continue;
    answeredCodingQuestionIds.add(codingAnswer.questionId);

    const question = codingAnswer.question;
    if (!question.autoEvaluate) {
      if (codingAnswer.marksObtained != null) {
        totalScore += codingAnswer.marksObtained;
      } else {
        pendingManualMarks += question.marks;
      }
      continue;
    }

    if (question.testCases.length === 0) {
      codingUpdates.push({ id: codingAnswer.id, testResults: JSON.stringify([]), marksObtained: 0 });
      continue;
    }

    const testResults = await Promise.all(
      question.testCases.map(async (testCase) => {
        const result = await executeCode({
          language: codingAnswer.language,
          code: codingAnswer.code,
          input: testCase.input,
          timeLimit: question.timeLimit
        });

        const passed = result.success && compareOutput(testCase.expectedOutput, result.output || '');

        return {
          testCaseId: testCase.id,
          passed,
          executionTime: result.executionTime,
          error: result.error
        };
      })
    );

    const passedTestCaseIds = new Set(
      testResults
        .filter((result) => result.passed)
        .map((result) => result.testCaseId)
    );
    const marks = scorePassedCodingCases(question, passedTestCaseIds);

    totalScore += marks;
    codingUpdates.push({
      id: codingAnswer.id,
      testResults: JSON.stringify(testResults),
      marksObtained: marks
    });
  }

  const behavioralUpdates: Array<{ id: string; marksObtained: number | null }> = [];
  for (const behavioralAnswer of attempt.behavioralAnswers) {
    if (!assignedQuestionIds.has(behavioralAnswer.questionId)) continue;
    answeredBehavioralQuestionIds.add(behavioralAnswer.questionId);

    if (behavioralAnswer.marksObtained != null) {
      totalScore += behavioralAnswer.marksObtained;
    } else {
      pendingManualMarks += behavioralAnswer.question.marks;
      behavioralUpdates.push({ id: behavioralAnswer.id, marksObtained: null });
    }
  }

  for (const question of attempt.test.questions) {
    if (question.codingQuestionId && question.codingQuestion && assignedQuestionIds.has(question.codingQuestionId)) {
      if (!question.codingQuestion.autoEvaluate && !answeredCodingQuestionIds.has(question.codingQuestionId)) {
        pendingManualMarks += question.codingQuestion.marks;
      }
    }

    if (question.behavioralQuestionId && assignedQuestionIds.has(question.behavioralQuestionId)) {
      if (!answeredBehavioralQuestionIds.has(question.behavioralQuestionId)) {
        pendingManualMarks += question.behavioralQuestion?.marks ?? 0;
      }
    }
  }

  await prisma.$transaction([
    ...mcqUpdates.map((update) =>
      prisma.mCQAnswer.update({
        where: { id: update.id },
        data: { isCorrect: update.isCorrect, marksObtained: update.marksObtained }
      })
    ),
    ...codingUpdates.map((update) =>
      prisma.codingAnswer.update({
        where: { id: update.id },
        data: { testResults: update.testResults, marksObtained: update.marksObtained }
      })
    ),
    ...behavioralUpdates.map((update) =>
      prisma.behavioralAnswer.update({
        where: { id: update.id },
        data: { marksObtained: update.marksObtained }
      })
    )
  ]);

  return {
    score: roundScore(totalScore),
    totalMarks: assignedTotalMarks,
    scoringStatus: pendingManualMarks > 0 ? 'pending_manual' : 'complete',
    pendingManualMarks
  };
}

export async function recalculateTestTotalMarks(testId: string): Promise<number> {
  const questions = await prisma.testQuestion.findMany({
    where: { testId },
    include: {
      mcqQuestion: { select: { marks: true } },
      codingQuestion: { select: { marks: true } },
      behavioralQuestion: { select: { marks: true } }
    }
  });

  const totalMarks = questions.reduce((sum, question) => {
    return sum +
      (question.mcqQuestion?.marks ?? 0) +
      (question.codingQuestion?.marks ?? 0) +
      (question.behavioralQuestion?.marks ?? 0);
  }, 0);

  await prisma.test.update({
    where: { id: testId },
    data: { totalMarks }
  });

  return totalMarks;
}

export async function recalculateSubmittedAttemptsForTest(testId: string): Promise<number> {
  const attempts = await prisma.testAttempt.findMany({
    where: {
      testId,
      status: { not: 'in_progress' }
    },
    select: { id: true }
  });

  for (const attempt of attempts) {
    const scoring = await scoreAttemptAnswers(attempt.id);
    await prisma.testAttempt.update({
      where: { id: attempt.id },
      data: { score: scoring.score }
    });
  }

  return attempts.length;
}

export async function recalculateTestTotalMarksAndScores(
  testId: string
): Promise<{ totalMarks: number; rescoredAttempts: number }> {
  const totalMarks = await recalculateTestTotalMarks(testId);
  const rescoredAttempts = await recalculateSubmittedAttemptsForTest(testId);

  return { totalMarks, rescoredAttempts };
}

export async function recalculateTestsUsingQuestion(
  questionType: 'mcq' | 'coding' | 'behavioral',
  questionId: string
): Promise<void> {
  const where =
    questionType === 'mcq'
      ? { mcqQuestionId: questionId }
      : questionType === 'coding'
        ? { codingQuestionId: questionId }
        : { behavioralQuestionId: questionId };

  const testQuestions = await prisma.testQuestion.findMany({
    where,
    select: { testId: true },
    distinct: ['testId']
  });

  for (const question of testQuestions) {
    await recalculateTestTotalMarksAndScores(question.testId);
  }
}

export function validatePartialCodingMarks(
  questionMarks: number,
  partialScoring: boolean,
  testCases: Array<{ marks?: number | null }>
): string | null {
  if (!partialScoring) {
    return null;
  }

  if (testCases.some((testCase) => !Number.isFinite(Number(testCase.marks)) || Number(testCase.marks) <= 0)) {
    return 'Each test case must have positive marks when partial scoring is enabled.';
  }

  const testCaseTotal = testCases.reduce((sum, testCase) => sum + Number(testCase.marks), 0);
  if (testCaseTotal !== questionMarks) {
    return `Test case marks must add up to question marks (${questionMarks}).`;
  }

  return null;
}
