import { Queue, QueueEvents } from 'bullmq';
import { getRedisConnectionOptions } from './connection.js';
import { CodeExecutionResult } from '../types/index.js';

export const CODE_EXECUTION_QUEUE_NAME = 'code-execution';

export interface CodeExecutionJobData {
  language: string;
  code: string;
  input: string;
  timeLimit?: number;
  memoryLimit?: number;
  // 'run' = candidate clicked Run, wants output fast; 'grade' = submit-time
  // grading. Only used to set job priority so a Run click doesn't queue
  // behind a burst of submissions sharing the same worker pool.
  purpose: 'run' | 'grade';
}

// Explicit 3-generic form (data, result, name-type=string) avoids a BullMQ
// typings quirk where passing only the data-type generic causes it to infer
// an overly-narrow job "name" type and reject plain string job names.
export const codeExecutionQueue = new Queue<CodeExecutionJobData, CodeExecutionResult, string>(CODE_EXECUTION_QUEUE_NAME, {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    removeOnComplete: { count: 1000, age: 3600 },
    removeOnFail: { count: 1000, age: 3600 },
  },
});

export const codeExecutionQueueEvents = new QueueEvents(CODE_EXECUTION_QUEUE_NAME, {
  connection: getRedisConnectionOptions(),
});
