// Compile/run commands per language now live in docker/code-exec/supervisor.py
// (LANGUAGE_CONFIG there) — the Node side only needs to know which
// languages exist, not how to build/run them, since dispatch is now an
// HTTP call to a container's supervisor rather than a shell script built
// here (see dockerExec.ts's execOnSupervisor()).
export type SupportedLanguage = 'python' | 'javascript' | 'java' | 'cpp' | 'c';

export interface ExecutionJobData {
  language: SupportedLanguage;
  code: string;
  input: string;
  timeLimit?: number;
  // 'run' = candidate clicked Run, wants output fast; 'grade' = submit-time
  // grading against the full test-case set. Only affects BullMQ priority so
  // a Run click doesn't queue behind a burst of submissions.
  purpose: 'run' | 'grade';
}

export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  executionTime?: number;
}

export interface PoolStats {
  language: string;
  idle: number;
  busy: number;
  total: number;
  min: number;
  max: number;
}
