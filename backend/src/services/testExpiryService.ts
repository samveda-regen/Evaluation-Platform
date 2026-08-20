import prisma from '../utils/db.js';
import { autoSubmitExpiredAttempt } from '../controllers/candidate.js';

const SWEEP_INTERVAL_MS = 15_000;

let sweepTimer: ReturnType<typeof setInterval> | null = null;
let sweepInFlight = false;

// Server-side safety net for the exam timer: the client also counts down and
// auto-submits, but that only runs while the candidate's tab is open and its JS
// is executing. If the tab/browser is closed or the machine drops offline, the
// client-side timer never fires, so this sweep periodically finds attempts whose
// startTime + test.duration has already passed and finalizes them from the server,
// independent of whether the candidate's browser is present at all.
export async function sweepExpiredAttempts(): Promise<void> {
  if (sweepInFlight) return;
  sweepInFlight = true;
  try {
    const candidates = await prisma.testAttempt.findMany({
      where: { status: 'in_progress' },
      select: {
        id: true,
        testId: true,
        startTime: true,
        test: { select: { duration: true } },
        activityLogs: { where: { eventType: 'test_start' }, select: { id: true }, take: 1 },
      },
    });

    const now = Date.now();
    // startTime is stamped at login, before ID verification / "Start Test" is ever clicked
    // (see startTest's own correction of startTime, candidate.ts). An attempt with no
    // test_start log yet hasn't actually begun the exam, so it must never be swept as expired
    // — otherwise a candidate stuck waiting on ID verification approval can get auto-submitted
    // before seeing a single question.
    const expired = candidates.filter(
      (attempt) =>
        attempt.activityLogs.length > 0 &&
        attempt.startTime.getTime() + attempt.test.duration * 60_000 <= now
    );

    for (const attempt of expired) {
      await autoSubmitExpiredAttempt(attempt.id, attempt.testId);
    }
  } catch (error) {
    console.error('Test expiry sweep failed:', error);
  } finally {
    sweepInFlight = false;
  }
}

export function startTestExpirySweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void sweepExpiredAttempts();
  }, SWEEP_INTERVAL_MS);
  void sweepExpiredAttempts();
}

export function stopTestExpirySweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
