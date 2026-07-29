import { Request } from 'express';

export interface AdminPayload {
  id: string;
  email: string;
  role: 'admin';
  // Standard JWT claim, populated by jsonwebtoken on sign/verify — used by
  // adminAuth to reject tokens issued before a force-logout timestamp.
  iat?: number;
  // Set when this request was authenticated via a superadmin impersonation
  // token rather than the admin's own login, so it can be audit-logged and
  // time-boxed distinctly from a normal session.
  impersonatedBy?: string;
}

export interface CandidatePayload {
  id: string;
  email: string;
  testId: string;
  attemptId: string;
  invitationId?: string;
  role: 'candidate';
}

export interface IntegrationPayload {
  id: string;
  email: string;
  role: 'integration_admin';
  companyId: string;
  scopes: string[];
}

export interface SuperAdminPayload {
  id: string;
  email: string;
  role: 'superadmin';
  // Sub-role gating mutating routes (see requireFullControl middleware) —
  // distinct from the outer `role: 'superadmin'` discriminant above, which
  // just identifies the token type against Admin/Candidate/Integration.
  accessLevel?: 'full_control' | 'read_only';
  iat?: number;
}

export interface AuthenticatedRequest extends Request {
  admin?: AdminPayload;
  candidate?: CandidatePayload;
  integration?: IntegrationPayload;
  superAdmin?: SuperAdminPayload;
}

export interface MCQOption {
  index: number;
  text: string;
}

export interface TestCaseResult {
  testCaseId: string;
  passed: boolean;
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
