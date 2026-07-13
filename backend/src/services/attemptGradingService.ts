import { executeCodeWithRetry, compareOutput } from '../utils/codeExecutor.js';

// Canonical MCQ + coding + behavioral scoring — the single implementation
// shared by submit-time grading (workers/testGradingWorker.ts) and admin
// re-evaluation (controllers/results.ts reEvaluateAttempt). Previously these
// had three independently-drifted copies (plus a fourth, unused one in the
// now-deleted services/scoringService.ts) with different partial-credit
// rounding behavior. Coding test cases run through executeCodeWithRetry(),
// so a busy execution queue here doesn't get scored as a wrong answer either.

export interface MCQAnswerForGrading {
  id: string;
  selectedOptions: string;
  question: { correctAnswers: string; marks: number };
}

export interface CodingTestCaseForGrading {
  id: string;
  input: string;
  expectedOutput: string;
}

export interface CodingAnswerForGrading {
  id: string;
  language: string;
  code: string;
  question: {
    timeLimit: number;
    marks: number;
    partialScoring: boolean;
    testCases: CodingTestCaseForGrading[];
  };
}

export interface BehavioralAnswerForGrading {
  marksObtained: number | null;
}

export interface GradedAnswers {
  totalScore: number;
  mcqUpdates: Array<{ id: string; isCorrect: boolean; marksObtained: number }>;
  codingUpdates: Array<{ id: string; testResults: string; marksObtained: number }>;
}

export async function gradeAttemptAnswers(
  mcqAnswers: MCQAnswerForGrading[],
  codingAnswers: CodingAnswerForGrading[],
  behavioralAnswers: BehavioralAnswerForGrading[],
  negativeMarking: number
): Promise<GradedAnswers> {
  let totalScore = 0;
  const mcqUpdates: GradedAnswers['mcqUpdates'] = [];

  for (const mcqAnswer of mcqAnswers) {
    const correctAnswers = JSON.parse(mcqAnswer.question.correctAnswers) as number[];
    const selectedOptions = JSON.parse(mcqAnswer.selectedOptions) as number[];

    const isCorrect =
      correctAnswers.length === selectedOptions.length &&
      correctAnswers.every((a: number) => selectedOptions.includes(a));

    let marks = 0;
    if (isCorrect) {
      marks = mcqAnswer.question.marks;
    } else if (selectedOptions.length > 0 && negativeMarking > 0) {
      marks = -negativeMarking;
    }

    totalScore += marks;
    mcqUpdates.push({ id: mcqAnswer.id, isCorrect, marksObtained: marks });
  }

  // Grade every coding answer's test cases concurrently — nothing here needs
  // to run sequentially, the code-execution queue is what actually bounds
  // concurrency.
  const codingResults = await Promise.all(
    codingAnswers.map(async (codingAnswer) => {
      const question = codingAnswer.question;
      if (question.testCases.length === 0) {
        return { id: codingAnswer.id, testResults: JSON.stringify([]), marksObtained: 0 };
      }

      const testResults = await Promise.all(
        question.testCases.map(async (testCase) => {
          const result = await executeCodeWithRetry({
            language: codingAnswer.language,
            code: codingAnswer.code,
            input: testCase.input,
            timeLimit: question.timeLimit,
            purpose: 'grade',
          });

          const passed = result.success && compareOutput(testCase.expectedOutput, result.output || '');

          return {
            testCaseId: testCase.id,
            passed,
            executionTime: result.executionTime,
            error: result.error,
          };
        })
      );

      const passedTests = testResults.filter((r) => r.passed).length;
      let marks = 0;
      if (question.partialScoring) {
        // Round to 2 decimal places to avoid floating point issues.
        marks = Math.round((passedTests / question.testCases.length) * question.marks * 100) / 100;
      } else {
        marks = passedTests === question.testCases.length ? question.marks : 0;
      }

      return { id: codingAnswer.id, testResults: JSON.stringify(testResults), marksObtained: marks };
    })
  );

  const codingUpdates: GradedAnswers['codingUpdates'] = [];
  for (const update of codingResults) {
    totalScore += update.marksObtained;
    codingUpdates.push(update);
  }

  for (const behavioralAnswer of behavioralAnswers) {
    totalScore += behavioralAnswer.marksObtained ?? 0;
  }

  return { totalScore, mcqUpdates, codingUpdates };
}
