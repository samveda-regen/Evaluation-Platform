interface CodingScoreTestCase {
  id: string;
  marks: number;
}

interface CodingScoreQuestion {
  marks: number;
  partialScoring: boolean;
  testCases: CodingScoreTestCase[];
}

interface CodingScoreResult {
  testCaseId: string;
  passed: boolean;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateCodingQuestionScore(
  question: CodingScoreQuestion,
  testResults: CodingScoreResult[]
): number {
  if (question.testCases.length === 0 || testResults.length === 0) {
    return 0;
  }

  if (!question.partialScoring) {
    return testResults.every((result) => result.passed) ? question.marks : 0;
  }

  const positiveMarksByTestCase = new Map<string, number>();
  let totalWeightedMarks = 0;

  for (const testCase of question.testCases) {
    const safeMarks = Number.isFinite(testCase.marks) && testCase.marks > 0 ? testCase.marks : 0;
    positiveMarksByTestCase.set(testCase.id, safeMarks);
    totalWeightedMarks += safeMarks;
  }

  if (totalWeightedMarks > 0) {
    let passedWeightedMarks = 0;

    for (const result of testResults) {
      if (result.passed) {
        passedWeightedMarks += positiveMarksByTestCase.get(result.testCaseId) ?? 0;
      }
    }

    return roundToTwoDecimals((passedWeightedMarks / totalWeightedMarks) * question.marks);
  }

  const passedTests = testResults.filter((result) => result.passed).length;
  return roundToTwoDecimals((passedTests / question.testCases.length) * question.marks);
}
