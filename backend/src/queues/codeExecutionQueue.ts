import { Queue, QueueEvents } from 'bullmq';
import { getRedisConnectionOptions } from './connection.js';
import { ExecutionJobData, ExecutionResult } from '../services/codeExec/types.js';

export const CODE_EXECUTION_QUEUE_NAME = 'code-execution';

// 'run' jobs (candidate clicked Run) get a higher numeric priority than
// 'grade' jobs (submit-time grading) so an interactive Run click doesn't
// queue behind a burst of submissions near the exam deadline. BullMQ:
// lower number = higher priority.
const PRIORITY: Record<ExecutionJobData['purpose'], number> = {
  run: 1,
  grade: 5,
};

export function priorityFor(purpose: ExecutionJobData['purpose']): number {
  return PRIORITY[purpose];
}

// Explicit 3-generic form (data, result, name-type=string) avoids a BullMQ
// typings quirk where passing only the data-type generic causes it to infer
// an overly-narrow job "name" type and reject plain string job names.
export const codeExecutionQueue = new Queue<ExecutionJobData, ExecutionResult, string>(CODE_EXECUTION_QUEUE_NAME, {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    removeOnComplete: { count: 1000, age: 3600 },
    removeOnFail: { count: 1000, age: 3600 },
  },
});
// Every in-flight job.waitUntilFinished() call (enqueue.ts) registers a
// listener on this queue while it waits — during an exam, dozens of
// candidates can legitimately have a Run or Submit in flight at once. That's
// expected concurrency, not a leak, so raise the ceiling past Node's
// default of 10 rather than let it log a false-positive warning.
codeExecutionQueue.setMaxListeners(0);

export const codeExecutionQueueEvents = new QueueEvents(CODE_EXECUTION_QUEUE_NAME, {
  connection: getRedisConnectionOptions(),
});
