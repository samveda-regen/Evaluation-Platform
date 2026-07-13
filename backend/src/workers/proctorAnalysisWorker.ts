// In-process worker (started from src/index.ts, not a standalone script)
// because its job body calls emitToProctorTargets, which needs the live
// socket.io instance that only exists inside the API process — see
// setSocketServer() in services/socketService.ts.
import { Worker, Job } from 'bullmq';
import { getRedisConnectionOptions } from '../queues/connection.js';
import { PROCTOR_ANALYSIS_QUEUE_NAME, ProctorAnalysisJobData, ProctorAnalysisResult } from '../queues/proctorAnalysisQueue.js';
import { processProctoringAnalysis } from '../controllers/proctoring.js';

const CONCURRENCY = Number(process.env.PROCTOR_ANALYSIS_WORKER_CONCURRENCY || 400);

let worker: Worker<ProctorAnalysisJobData, ProctorAnalysisResult> | undefined;

async function processJob(job: Job<ProctorAnalysisJobData>): Promise<ProctorAnalysisResult> {
  const { sessionId, attemptId, customAIViolations, analysisData } = job.data;
  return processProctoringAnalysis(sessionId, attemptId, customAIViolations, analysisData);
}

export function startProctorAnalysisWorker(): Worker<ProctorAnalysisJobData, ProctorAnalysisResult> {
  if (worker) return worker;

  worker = new Worker<ProctorAnalysisJobData, ProctorAnalysisResult>(
    PROCTOR_ANALYSIS_QUEUE_NAME,
    processJob,
    {
      connection: getRedisConnectionOptions(),
      concurrency: CONCURRENCY,
    }
  );

  worker.on('ready', () => {
    console.log(`[proctorAnalysisWorker] connected. concurrency=${CONCURRENCY}`);
  });
  worker.on('failed', (job, err) => {
    console.error(`[proctorAnalysisWorker] job ${job?.id} failed:`, err.message);
  });

  return worker;
}

export async function stopProctorAnalysisWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
}
