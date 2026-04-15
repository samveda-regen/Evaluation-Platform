import { Request } from 'express';

export interface AdminPayload {
  id: string;
  email: string;
  role: 'admin';
}

export interface CandidatePayload {
  id: string;
  email: string;
  testId: string;
  attemptId: string;
  invitationId?: string;
  role: 'candidate';
}

export interface AuthenticatedRequest extends Request {
  admin?: AdminPayload;
  candidate?: CandidatePayload;
}

export interface MCQOption {
  index: number;
  text: string;
}

export interface TestCaseResult {
  testCaseId: string;
  passed: boolean;
  marks?: number;
  actualOutput?: string;
  expectedOutput?: string;
  executionTime?: number;
  error?: string;
}

export interface CodeExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  executionTime?: number;
  memoryUsed?: number;
}

export interface TestSubmissionData {
  mcqAnswers: {
    questionId: string;
    selectedOptions: number[];
  }[];
  codingAnswers: {
    questionId: string;
    code: string;
    language: string;
  }[];
}
