// Standalone process — run via `npm run worker:code` / `worker:code:dev`.
// Kept separate from the API process because it manages real Docker
// containers per job and must never compete with (or be starved by) the
// HTTP-serving event loop. Run more copies of this process (same machine or
// more machines) to add capacity; BullMQ load-balances jobs across whatever
// workers are connected to the same Redis queue.
import '../env.js'; // must stay the first import — this process never gets .env any other way

import { Worker, Job } from 'bullmq';
import { getRedisConnectionOptions } from '../queues/connection.js';
import { CODE_EXECUTION_QUEUE_NAME, CodeExecutionJobData } from '../queues/codeExecutionQueue.js';
import { runInSandbox, CODE_EXEC_DOCKER_IMAGE } from '../utils/dockerSandbox.js';
import { startContainerReaper } from '../utils/containerReaper.js';
import { CodeExecutionResult } from '../types/index.js';

const CONCURRENCY = Number(process.env.CODE_EXEC_WORKER_CONCURRENCY || 10);
// Backstop sweep: check every 30s, force-remove any of our containers older
// than 3 minutes (generously above any realistic compile+run+overhead time).
const REAPER_INTERVAL_MS = 30_000;
const REAPER_MAX_AGE_MS = 3 * 60_000;

async function processJob(job: Job<CodeExecutionJobData>): Promise<CodeExecutionResult> {
  return runInSandbox({
    language: job.data.language,
    code: job.data.code,
    input: job.data.input,
    timeLimit: job.data.timeLimit,
    memoryLimit: job.data.memoryLimit,
  });
}

const worker = new Worker<CodeExecutionJobData, CodeExecutionResult>(
  CODE_EXECUTION_QUEUE_NAME,
  processJob,
  {
    connection: getRedisConnectionOptions(),
    concurrency: CONCURRENCY,
  }
);

worker.on('ready', () => {
  console.log(`[codeExecutionWorker] connected. image=${CODE_EXEC_DOCKER_IMAGE} concurrency=${CONCURRENCY}`);
});

worker.on('failed', (job, err) => {
  console.error(`[codeExecutionWorker] job ${job?.id} failed:`, err.message);
});

startContainerReaper(REAPER_INTERVAL_MS, REAPER_MAX_AGE_MS);

async function shutdown(signal: string): Promise<void> {
  console.log(`[codeExecutionWorker] ${signal} received, draining active jobs...`);
  await worker.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
