import { CodeExecutionResult } from '../types/index.js';
import {
  ExecutionConfig,
  LANGUAGE_CONFIG,
  DEFAULT_TIMEOUT,
  HARD_TIMEOUT_BUFFER,
  COMPILE_TIMEOUT,
} from './codeExecutionShared.js';
import { codeExecutionQueue, codeExecutionQueueEvents } from '../queues/codeExecutionQueue.js';

// Actual execution now happens in a separate worker process
// (src/workers/codeExecutionWorker.ts), inside a locked-down Docker
// container (src/utils/dockerSandbox.ts). This module's job is just to
// enqueue the work and wait for it — the external executeCode() signature is
// unchanged so every existing caller (runCode, submitTest, etc.) needed no
// changes.
export async function executeCode(config: ExecutionConfig): Promise<CodeExecutionResult> {
  const langConfig = LANGUAGE_CONFIG[config.language.toLowerCase()];
  const needsCompile = !!langConfig?.compile;
  // Same formula the old in-process race used — how long we're willing to
  // wait for a result before treating this as "server is busy" rather than a
  // genuine answer from the candidate's code.
  const hardTimeoutMs = (needsCompile ? COMPILE_TIMEOUT : 0) + (config.timeLimit || DEFAULT_TIMEOUT) + HARD_TIMEOUT_BUFFER;

  const job = await codeExecutionQueue.add(
    'execute',
    {
      language: config.language,
      code: config.code,
      input: config.input,
      timeLimit: config.timeLimit,
      memoryLimit: config.memoryLimit,
      purpose: config.purpose || 'run',
    },
    {
      // BullMQ: lower number = higher priority. Interactive "Run" clicks
      // should never queue behind a burst of submit-time grading jobs.
      priority: (config.purpose || 'run') === 'run' ? 1 : 10,
    }
  );

  try {
    const result = await job.waitUntilFinished(codeExecutionQueueEvents, hardTimeoutMs);
    return result as unknown as CodeExecutionResult;
  } catch {
    // waitUntilFinished throws both on a real timeout and if the job itself
    // errored unexpectedly (worker crash mid-execution) — either way, this is
    // an infra-side failure, not a verdict on the candidate's code.
    return {
      success: false,
      error: 'Server is busy. Please try again in a few seconds.',
    };
  }
}

// Error strings that mean the execution never got a fair chance to run because of
// server congestion (queue full, or the hard-timeout race), not because the
// candidate's code is wrong. Safe to retry transparently.
const INFRA_FAILURE_MESSAGES = new Set([
  'Server is busy. Please try again in a few seconds.',
  'Execution timed out. Your code took too long to run.',
]);

export function isInfraFailure(result: CodeExecutionResult): boolean {
  return !result.success && !!result.error && INFRA_FAILURE_MESSAGES.has(result.error);
}

// Same as executeCode, but transparently retries once if the failure looks like
// infrastructure congestion rather than a genuine compile/runtime/time-limit
// failure in the candidate's own code — so a busy server doesn't get recorded
// as a wrong answer.
export async function executeCodeWithRetry(config: ExecutionConfig): Promise<CodeExecutionResult> {
  const first = await executeCode(config);
  if (!isInfraFailure(first)) return first;
  await new Promise((resolve) => setTimeout(resolve, 500));
  return executeCode(config);
}

// Get current queue status (for monitoring / the /api/health/queues endpoint)
export async function getExecutionQueueStatus(): Promise<{
  active: number;
  waiting: number;
  delayed: number;
  failed: number;
}> {
  const counts = await codeExecutionQueue.getJobCounts('active', 'waiting', 'delayed', 'failed');
  return {
    active: counts.active ?? 0,
    waiting: counts.waiting ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
  };
}

export function compareOutput(expected: string, actual: string): boolean {
  // Normalize whitespace and compare
  const normalizeOutput = (s: string) =>
    s.trim().split('\n').map(line => line.trim()).join('\n');

  return normalizeOutput(expected) === normalizeOutput(actual);
}
