import { codeExecutionQueue, codeExecutionQueueEvents, priorityFor } from '../../queues/codeExecutionQueue.js';
import { ExecutionJobData, ExecutionResult, SupportedLanguage } from './types.js';
import { COMPILE_TIMEOUT_SEC, COMPILED_LANGUAGES } from './dockerExec.js';

// Languages routed through the container-pool worker. A language only
// belongs here once codeExecutionWorker.ts has a pool configured for it
// (see CODE_EXEC_POOL_MIN_<LANG>/CODE_EXEC_POOL_MAX_<LANG> in .env) —
// anything not listed keeps using the original host-spawn path in
// utils/codeExecutor.ts (see candidate.ts), so adding a language here and
// forgetting the pool config fails loudly (pool.ts throws "no container
// pool configured") rather than silently falling back.
const QUEUE_ROUTED_LANGUAGES: ReadonlySet<string> = new Set<SupportedLanguage>([
  'python',
  'javascript',
  'java',
  'cpp',
  'c',
]);

export function isQueueRouted(language: string): boolean {
  return process.env.CODE_EXEC_MODE === 'docker' && QUEUE_ROUTED_LANGUAGES.has(language);
}

// Extra headroom above the job's own timeLimit to cover BullMQ dispatch +
// container-acquire wait + exec overhead, so a slow-but-legitimate job
// doesn't get cut off by this wrapper before the in-container timeout would
// have reported its own TLE. Must stay >= dockerExec.ts's own
// requestTimeoutMs logic (which adds the compile budget for java/cpp/c) —
// otherwise this outer wait fires first and the candidate sees "server
// busy" even though the worker's own attempt was still within its allowed
// budget and would have returned a real result shortly after.
const BASE_HEADROOM_MS = 10_000;

export async function runQueuedExecution(data: ExecutionJobData): Promise<ExecutionResult> {
  const job = await codeExecutionQueue.add('execute', data, {
    priority: priorityFor(data.purpose),
  });

  const compileBudgetMs = COMPILED_LANGUAGES.has(data.language) ? COMPILE_TIMEOUT_SEC * 1000 : 0;
  const waitTimeoutMs = compileBudgetMs + (data.timeLimit || 5000) + BASE_HEADROOM_MS;

  try {
    const result = await job.waitUntilFinished(codeExecutionQueueEvents, waitTimeoutMs);
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error && error.message.includes('timed out')
        ? 'Server is busy. Please try again in a few seconds.'
        : 'Execution failed unexpectedly',
    };
  }
}
