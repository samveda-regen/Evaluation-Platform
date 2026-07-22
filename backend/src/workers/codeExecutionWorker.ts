// Standalone process — run via `npm run worker:code` / `worker:code:dev`.
// Kept separate from the API process because it owns real Docker containers
// (the warm pool) and must never compete with, or be starved by, the
// HTTP-serving event loop. Run more copies of this process (same machine or
// more machines, each with its own local pool) to add capacity; BullMQ
// load-balances jobs across whatever workers are connected to the same
// Redis queue.
import { loadEnvFile } from '../utils/loadEnv.js'; // must stay the first import — this process never gets .env any other way
loadEnvFile();

import { Worker, Job } from 'bullmq';
import { getRedisConnectionOptions } from '../queues/connection.js';
import { CODE_EXECUTION_QUEUE_NAME } from '../queues/codeExecutionQueue.js';
import { ExecutionJobData, ExecutionResult, SupportedLanguage } from '../services/codeExec/types.js';
import { containerPoolManager } from '../services/codeExec/pool.js';
import { execOnSupervisor, SUPERVISOR_BUSY_ERROR } from '../services/codeExec/dockerExec.js';
import { reapOrphanedContainers } from '../utils/containerReaper.js';

const CONCURRENCY = Number(process.env.CODE_EXEC_WORKER_CONCURRENCY || 10);
const ACQUIRE_TIMEOUT_MS = Number(process.env.CODE_EXEC_ACQUIRE_TIMEOUT_MS || 8000);

// Per-language pool sizing, each independently tunable via
// CODE_EXEC_POOL_MIN_<LANG>/CODE_EXEC_POOL_MAX_<LANG>/
// CODE_EXEC_SLOTS_PER_CONTAINER_<LANG>. min/max favor Python and JS
// (interpreted, cheap to keep warm) over the compiled languages (heavier
// containers only used when a question calls for them). `slots` (how many
// candidates run truly concurrently inside ONE container of that pool) is
// sized to each language's actual per-execution CPU need, not a flat
// number — confirmed by hand that a shared 8-slot default starves Java
// badly (8 concurrent JVM compile+starts sharing one container's 0.5 CPU
// all blew past their timeout; 3-way concurrency was fine), while Python/
// JS's lightweight, short-lived processes handle 8-way sharing fine.
// Fallback only - every value here is overridden by the matching
// CODE_EXEC_SLOTS_PER_CONTAINER_<LANG> in .env. Kept in sync with .env's
// currently-configured CODE_EXEC_CONTAINER_CPUS=0.5 (python/js slots=4,
// re-verified fresh via isolated-container burst testing - see .env's
// comment for the full methodology) so a missing env var falls back to a
// tested number, not a stale one measured at a different CPU allocation.
// image: each language now gets its own container image
// (talentq/code-exec-<lang>:dev, built from docker/code-exec/<lang>/
// Dockerfile), FROM talentq/code-exec-base:dev with just that language's
// runtime/compiler layered on top - see docker/code-exec/base/Dockerfile's
// comment for why the split happened (a java submission no longer pulls
// g++/gcc layers it'll never use, and vice versa). Overridable per language
// via CODE_EXEC_DOCKER_IMAGE_<LANG>, same pattern as min/max/slots below,
// for e.g. pinning a specific tag in a given environment without touching
// code.
const POOL_DEFAULTS: Record<SupportedLanguage, { min: number; max: number; slots: number; image: string }> = {
  python: { min: 2, max: 8, slots: 4, image: 'talentq/code-exec-python:dev' },
  javascript: { min: 2, max: 8, slots: 4, image: 'talentq/code-exec-javascript:dev' },
  java: { min: 1, max: 4, slots: 2, image: 'talentq/code-exec-java:dev' },
  cpp: { min: 1, max: 4, slots: 3, image: 'talentq/code-exec-cpp:dev' },
  c: { min: 1, max: 4, slots: 5, image: 'talentq/code-exec-c:dev' },
};

for (const [language, defaults] of Object.entries(POOL_DEFAULTS) as [SupportedLanguage, { min: number; max: number; slots: number; image: string }][]) {
  const envKey = language.toUpperCase();
  containerPoolManager.configurePool(language, {
    min: Number(process.env[`CODE_EXEC_POOL_MIN_${envKey}`] || defaults.min),
    max: Number(process.env[`CODE_EXEC_POOL_MAX_${envKey}`] || defaults.max),
    slotsPerContainer: Number(process.env[`CODE_EXEC_SLOTS_PER_CONTAINER_${envKey}`] || defaults.slots),
    image: process.env[`CODE_EXEC_DOCKER_IMAGE_${envKey}`] || defaults.image,
  });
}

// A container handed out by acquire() can occasionally turn out to be dead
// on arrival (crashed supervisor, container wiped out from under us by
// something outside this process). One retry on a *different* container
// turns that into a non-event for the candidate instead of a surfaced
// infra error. Unlike the old docker-exec model, a failure here only ever
// implicates the *one* container the job happened to land on — pool.ts's
// markDead() removes exactly that container, not the whole pool, since
// every other container is an independently addressable process serving
// its own set of concurrent jobs, not shared state that one failure casts
// doubt on.
const MAX_ATTEMPTS = 3;

async function processJob(job: Job<ExecutionJobData>): Promise<ExecutionResult> {
  const { language, code, input, timeLimit = 5000 } = job.data;

  if (!(language in POOL_DEFAULTS)) {
    return { success: false, error: `Language "${language}" is not yet routed through the container pool` };
  }

  let lastError = 'Execution failed unexpectedly';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const claim = await containerPoolManager.acquire(language, ACQUIRE_TIMEOUT_MS);
    let healthy = true;
    let resourceBusy = false;
    try {
      const result = await execOnSupervisor(claim.hostPort, language, code, input, timeLimit);
      healthy = result.success || !!result.executionTime; // ran to completion, even if the candidate's code itself failed
      // SUPERVISOR_BUSY_ERROR is an infra-level "no room right now" signal
      // (every sandbox UID busy, or supervisor.py's own resource-headroom
      // gate refused admission) — not a dead container and not the
      // candidate's fault. The old code returned this straight to the
      // candidate as a failure and, via claim.release(false), marked the
      // container dead and destroyed it — even though nothing was actually
      // broken with it, just momentarily saturated. Instead: retry on a
      // (likely different, since this one just went into cooldown —see
      // pool.ts's markBusy()) container, up to MAX_ATTEMPTS.
      if (!result.success && result.error === SUPERVISOR_BUSY_ERROR) {
        healthy = true;
        resourceBusy = true;
        lastError = result.error;
        continue;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[codeExecutionWorker] attempt ${attempt}/${MAX_ATTEMPTS} on container ${claim.id.slice(0, 12)} failed:`, message);
      healthy = false;
      lastError = message;
      // claim.release(false) below routes to pool.ts's release(), which
      // calls markDead() for an unhealthy container — no need to do it
      // again here.
    } finally {
      claim.release(healthy, resourceBusy);
    }
  }

  return { success: false, error: lastError };
}

async function main(): Promise<void> {
  const docker = containerPoolManager.getDocker();
  const reaped = await reapOrphanedContainers(docker);
  if (reaped > 0) {
    console.warn(`[codeExecutionWorker] reaped ${reaped} orphaned container(s) from a previous run`);
  }

  await containerPoolManager.start();
  console.log('[codeExecutionWorker] container pools ready:', containerPoolManager.stats());

  const worker = new Worker<ExecutionJobData, ExecutionResult>(CODE_EXECUTION_QUEUE_NAME, processJob, {
    connection: getRedisConnectionOptions(),
    concurrency: CONCURRENCY,
  });

  worker.on('ready', () => {
    console.log(`[codeExecutionWorker] connected. concurrency=${CONCURRENCY}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[codeExecutionWorker] job ${job?.id} failed:`, err.message);
  });

  setInterval(() => {
    console.log('[codeExecutionWorker] pool stats:', containerPoolManager.stats());
  }, 30_000).unref();

  async function shutdown(signal: string): Promise<void> {
    console.log(`[codeExecutionWorker] ${signal} received, draining active jobs...`);
    await worker.close();
    await containerPoolManager.shutdown();
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[codeExecutionWorker] failed to start:', err);
  process.exit(1);
});
