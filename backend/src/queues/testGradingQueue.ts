import { Queue, QueueEvents } from 'bullmq';
import { getRedisConnectionOptions } from './connection.js';

export const TEST_GRADING_QUEUE_NAME = 'test-grading';

export interface TestGradingJobData {
  attemptId: string;
  testId: string;
  autoSubmit: boolean;
  // 'submit' (default): full submit-time grading — writes resultReleased and
  // fires webhook/notifications/emails. 'reevaluate': admin-triggered
  // correction — only rescoring, no side effects. See testGradingWorker.ts.
  mode?: 'submit' | 'reevaluate';
}

// submitTest() enqueues and returns immediately without waiting on this
// queue. reEvaluateAttempt() (admin action, single attempt, not a
// high-concurrency hot path) does wait, via this QueueEvents instance, so
// the admin still gets the corrected score back in the response.
export const testGradingQueue = new Queue<TestGradingJobData, { score: number }, string>(TEST_GRADING_QUEUE_NAME, {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 500, age: 86400 },
    removeOnFail: { count: 500, age: 86400 },
  },
});

export const testGradingQueueEvents = new QueueEvents(TEST_GRADING_QUEUE_NAME, {
  connection: getRedisConnectionOptions(),
});
