import http from 'http';
import { ExecutionResult, SupportedLanguage } from './types.js';

const CONTAINER_MEMORY_MB = Number(process.env.CODE_EXEC_CONTAINER_MEMORY_MB || 256);
const CONTAINER_PIDS_LIMIT = Number(process.env.CODE_EXEC_CONTAINER_PIDS_LIMIT || 64);

// Must match supervisor.py's COMPILE_TIMEOUT_SEC exactly — this is the
// extra budget the supervisor itself allows compiled languages before the
// timeLimit-bounded run step even starts. Getting this out of sync is a
// real, serious bug in this specific architecture: if the client-side
// timeout fires while the supervisor is still legitimately compiling, the
// worker treats it as the container's fault (see codeExecutionWorker.ts's
// retry loop, which marks an unhealthy container dead and destroys it) —
// destroying a container that was never actually broken takes every other
// candidate concurrently sharing that same container down with it.
export const COMPILE_TIMEOUT_SEC = 15;
export const COMPILED_LANGUAGES: ReadonlySet<SupportedLanguage> = new Set(['java', 'cpp', 'c']);

// Must match supervisor.py's /run response exactly (see its acquire_uid()
// call site) — this is the container's own "I'm genuinely full/saturated
// right now" signal, distinct from a crash or a candidate's own code
// failing. codeExecutionWorker.ts's retry loop checks for this exact string
// to retry on a different container instead of surfacing it as a failure,
// and to avoid marking a perfectly healthy container dead over it.
export const SUPERVISOR_BUSY_ERROR = 'Server is busy. Please try again in a few seconds.';

// Dispatches one job to a specific container's supervisor.py over its
// published loopback port — replaces the old `docker exec` per job. This
// is a plain HTTP POST, not a Docker Engine API call: the container is
// already running a long-lived process (supervisor.py) that accepts many
// concurrent requests and runs each as its own isolated OS process (see
// supervisor.py's module docstring) — the worker just has to reach it.
export async function execOnSupervisor(
  hostPort: number,
  language: SupportedLanguage,
  code: string,
  input: string,
  timeLimitMs: number
): Promise<ExecutionResult> {
  const payload = JSON.stringify({
    language,
    code,
    input: input || '',
    timeLimitMs,
    memoryMb: CONTAINER_MEMORY_MB,
    pidsLimit: CONTAINER_PIDS_LIMIT,
  });

  // Backstop above the in-supervisor rlimits/timeout: covers HTTP
  // round-trip + queueing inside the supervisor's own thread pool, PLUS
  // the separate compile budget for languages that need one — the
  // supervisor's own worst case is (COMPILE_TIMEOUT_SEC + timeLimitMs) for
  // those, not timeLimitMs alone. If this fires, the supervisor's own
  // timeout handling has already failed to enforce its deadline — an
  // infra problem, not candidate TLE.
  const compileBudgetMs = COMPILED_LANGUAGES.has(language) ? COMPILE_TIMEOUT_SEC * 1000 : 0;
  const requestTimeoutMs = compileBudgetMs + timeLimitMs + 10_000;

  return new Promise<ExecutionResult>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: hostPort,
        path: '/run',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: requestTimeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as ExecutionResult;
            resolve(parsed);
          } catch (err) {
            reject(new Error(`Malformed response from supervisor: ${(err as Error).message}`));
          }
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('Execution timed out. Your code took too long to run.')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
