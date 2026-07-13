import { Queue, QueueEvents } from 'bullmq';
import { getRedisConnectionOptions } from './connection.js';
import { ProctoringAnalysis } from '../services/proctorAIService.js';

export const PROCTOR_ANALYSIS_QUEUE_NAME = 'proctor-analysis';

export interface ProctorAnalysisJobData {
  sessionId: string;
  attemptId: string;
  customAIViolations: string | null;
  analysisData: ProctoringAnalysis;
}

export interface ProctorAnalysisResult {
  success: boolean;
  violations: Array<Record<string, unknown>>;
  totalViolations: number;
  maxViolations: number;
  shouldTerminate: boolean;
  isFlagged: boolean;
}

export const proctorAnalysisQueue = new Queue<ProctorAnalysisJobData, ProctorAnalysisResult, string>(PROCTOR_ANALYSIS_QUEUE_NAME, {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 500, age: 600 },
    removeOnFail: { count: 500, age: 600 },
  },
});

export const proctorAnalysisQueueEvents = new QueueEvents(PROCTOR_ANALYSIS_QUEUE_NAME, {
  connection: getRedisConnectionOptions(),
});
