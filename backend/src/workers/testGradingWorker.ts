// In-process worker (started from src/index.ts, not a standalone script)
// because its job body calls emitToTestProctorRoom/emitToAdminRoom, which
// need the live socket.io instance that only exists inside the API process.
//
// This is the grading logic that used to run synchronously inside
// submitTest() before responding to the candidate — moved here verbatim so
// the candidate's "Test submitted successfully" response no longer waits on
// coding-question execution. See controllers/candidate.ts submitTest() for
// the thin controller that now just marks the attempt submitted and enqueues
// this job.
import { Worker, Job } from 'bullmq';
import { getRedisConnectionOptions } from '../queues/connection.js';
import { TEST_GRADING_QUEUE_NAME, TestGradingJobData } from '../queues/testGradingQueue.js';
import prisma from '../utils/db.js';
import { gradeAttemptAnswers } from '../services/attemptGradingService.js';
import { emitToAdminRoom, emitToTestProctorRoom } from '../services/socketService.js';
import { sendCandidateScoreWebhook } from '../services/candidateScoreWebhookService.js';
import { sendConfirmationEmail, sendResultEmail } from '../services/emailService.js';
import { saveNotification, ensureNotificationTable } from '../controllers/notifications.js';
import { getTestGradingPreferences } from '../utils/testPreferences.js';

const CONCURRENCY = Number(process.env.TEST_GRADING_WORKER_CONCURRENCY || 15);

let worker: Worker<TestGradingJobData, { score: number }> | undefined;

async function gradeAttempt(job: Job<TestGradingJobData>): Promise<{ score: number }> {
  const { attemptId, testId, autoSubmit, mode } = job.data;
  const isReEvaluation = mode === 'reevaluate';

  const [attempt, test] = await Promise.all([
    prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        mcqAnswers: { include: { question: { select: { correctAnswers: true, marks: true } } } },
        codingAnswers: { include: { question: { select: { timeLimit: true, marks: true, partialScoring: true, testCases: true } } } },
        behavioralAnswers: { select: { marksObtained: true } },
        candidate: { select: { name: true, email: true } },
      },
    }),
    prisma.test.findUnique({ where: { id: testId } }),
  ]);

  if (!attempt || !test) {
    const msg = `attempt or test not found for grading job: attemptId=${attemptId} testId=${testId}`;
    console.error(`[testGradingWorker] ${msg}`);
    throw new Error(msg);
  }

  const { totalScore, mcqUpdates, codingUpdates } = await gradeAttemptAnswers(
    attempt.mcqAnswers,
    attempt.codingAnswers,
    attempt.behavioralAnswers,
    test.negativeMarking
  );

  // Admin-triggered re-evaluation only corrects the score/test-results — it
  // must not change resultReleased (the admin already decided that
  // separately) or re-fire the submit-time webhook/notification/emails,
  // which would look like a duplicate test completion to the candidate and
  // any downstream integration.
  if (isReEvaluation) {
    await prisma.$transaction([
      ...mcqUpdates.map(update =>
        prisma.mCQAnswer.update({
          where: { id: update.id },
          data: { isCorrect: update.isCorrect, marksObtained: update.marksObtained },
        })
      ),
      ...codingUpdates.map(update =>
        prisma.codingAnswer.update({
          where: { id: update.id },
          data: { testResults: update.testResults, marksObtained: update.marksObtained },
        })
      ),
      prisma.testAttempt.update({
        where: { id: attemptId },
        data: { score: totalScore },
      }),
    ]);
    return { score: totalScore };
  }

  const attemptStatus = attempt.status; // already set to submitted/auto_submitted by submitTest()
  const webhookStatus = attemptStatus === 'submitted' || attemptStatus === 'auto_submitted'
    ? 'completed'
    : attemptStatus;

  const gradingPreferences = await getTestGradingPreferences(testId);
  const resultReleased = gradingPreferences.gradingMode !== 'Manual';
  const passed = test.passingMarks != null ? totalScore >= test.passingMarks : null;

  await prisma.$transaction([
    ...mcqUpdates.map(update =>
      prisma.mCQAnswer.update({
        where: { id: update.id },
        data: { isCorrect: update.isCorrect, marksObtained: update.marksObtained },
      })
    ),
    ...codingUpdates.map(update =>
      prisma.codingAnswer.update({
        where: { id: update.id },
        data: { testResults: update.testResults, marksObtained: update.marksObtained },
      })
    ),
    prisma.testAttempt.update({
      where: { id: attemptId },
      data: { score: totalScore, resultReleased },
    }),
  ]);

  const submissionPayload = {
    testId,
    testName: test.name,
    attemptId,
    candidateName: attempt.candidate?.name ?? 'Unknown',
    candidateEmail: attempt.candidate?.email ?? '',
    autoSubmit: !!autoSubmit,
    timestamp: new Date().toISOString(),
  };

  emitToTestProctorRoom(testId, 'test-submitted', submissionPayload);
  emitToAdminRoom(test.adminId, 'test-submitted', submissionPayload);

  void ensureNotificationTable().then(() =>
    saveNotification({
      adminId: test.adminId,
      type: 'completed',
      attemptId,
      testId,
      testName: test.name,
      candidateName: attempt.candidate?.name ?? 'Unknown',
      autoSubmit: !!autoSubmit,
    })
  ).catch(err => console.error('Notification save error (submit):', err));

  void sendCandidateScoreWebhook({
    name: attempt.candidate?.name ?? 'Unknown',
    emailid: attempt.candidate?.email ?? '',
    score: totalScore,
    testid: testId,
    status: webhookStatus,
  });

  const candidateEmail = attempt.candidate?.email;
  const candidateName = attempt.candidate?.name ?? 'Candidate';
  if (!candidateEmail) {
    console.warn(`Confirmation email skipped: no email on candidate for attempt ${attemptId}`);
  }
  if (candidateEmail) {
    void (async () => {
      try {
        const testRow = await prisma.test.findUnique({
          where: { id: testId },
          select: { name: true, companyId: true },
        });
        if (!testRow) {
          console.error(`Confirmation email: test ${testId} not found`);
          return;
        }

        let companyName = 'Our Team';
        if (testRow.companyId) {
          try {
            const company = await prisma.company.findUnique({
              where: { id: testRow.companyId },
              select: { name: true },
            });
            if (company?.name) companyName = company.name;
          } catch { /* company name is optional */ }
        }

        let confirmEmailSubject: string | undefined;
        let confirmEmailBody: string | undefined;
        try {
          const rows = await prisma.$queryRaw<Array<{
            confirmEmailSubject: string | null;
            confirmEmailBody: string | null;
          }>>`SELECT "confirmEmailSubject", "confirmEmailBody" FROM "Test" WHERE id = ${testId}`;
          if (rows.length > 0) {
            confirmEmailSubject = rows[0].confirmEmailSubject ?? undefined;
            confirmEmailBody = rows[0].confirmEmailBody ?? undefined;
          }
        } catch {
          // columns not in DB yet — use default templates (safe to continue)
        }

        await sendConfirmationEmail({
          to: candidateEmail,
          candidateName,
          testName: testRow.name,
          companyName,
          confirmEmailSubject,
          confirmEmailBody,
        });
        console.log(`Confirmation email sent to ${candidateEmail} for test "${testRow.name}"`);
      } catch (err) {
        console.error('Confirmation email error:', err);
      }
    })();
  }

  if (resultReleased && gradingPreferences.sendResultEmail && candidateEmail) {
    void (async () => {
      try {
        const testRow = await prisma.test.findUnique({
          where: { id: testId },
          select: { name: true, companyId: true },
        });
        if (!testRow) return;

        let companyName = 'Our Team';
        if (testRow.companyId) {
          try {
            const company = await prisma.company.findUnique({
              where: { id: testRow.companyId },
              select: { name: true },
            });
            if (company?.name) companyName = company.name;
          } catch { /* company name is optional */ }
        }

        await sendResultEmail({
          to: candidateEmail,
          candidateName,
          testName: testRow.name,
          companyName,
          score: totalScore,
          totalMarks: test.totalMarks,
          passed,
        });
        await prisma.testAttempt.update({
          where: { id: attemptId },
          data: { resultEmailSentAt: new Date() },
        });
        console.log(`Result email sent to ${candidateEmail} for test "${testRow.name}"`);
      } catch (err) {
        console.error('Result email error:', err);
      }
    })();
  }

  return { score: totalScore };
}

export function startTestGradingWorker(): Worker<TestGradingJobData, { score: number }> {
  if (worker) return worker;

  worker = new Worker<TestGradingJobData, { score: number }>(TEST_GRADING_QUEUE_NAME, gradeAttempt, {
    connection: getRedisConnectionOptions(),
    concurrency: CONCURRENCY,
  });

  worker.on('ready', () => {
    console.log(`[testGradingWorker] connected. concurrency=${CONCURRENCY}`);
  });
  worker.on('failed', (job, err) => {
    console.error(`[testGradingWorker] job ${job?.id} (attempt ${job?.data.attemptId}) failed:`, err.message);
  });

  return worker;
}

export async function stopTestGradingWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
}
