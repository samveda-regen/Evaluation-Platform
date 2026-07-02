import prisma from './db.js';

export interface TestGradingPreferences {
  gradingMode: 'Automatic' | 'Manual';
  showScoreToCandidate: boolean;
  sendResultEmail: boolean;
}

const DEFAULT_PREFERENCES: TestGradingPreferences = {
  gradingMode: 'Automatic',
  showScoreToCandidate: false,
  sendResultEmail: false,
};

export async function getTestGradingPreferences(testId: string): Promise<TestGradingPreferences> {
  try {
    const rows = await prisma.$queryRaw<Array<{ proctoringSettings: string | null }>>`
      SELECT "proctoringSettings" FROM "Test" WHERE id = ${testId}
    `;
    const raw = rows[0]?.proctoringSettings ?? null;
    if (!raw) return { ...DEFAULT_PREFERENCES };

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_PREFERENCES };
    }
    const settings = parsed as Record<string, unknown>;

    return {
      gradingMode: settings.gradingMode === 'Manual' ? 'Manual' : 'Automatic',
      showScoreToCandidate: settings.showScoreToCandidate === true,
      sendResultEmail: settings.sendResultEmail === true,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
