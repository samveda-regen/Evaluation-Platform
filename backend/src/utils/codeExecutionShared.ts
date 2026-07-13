// Shared between codeExecutor.ts (API process — computes wait timeouts and
// talks to the queue) and dockerSandbox.ts (worker process — actually runs
// the container). Single source of truth for language/timeout config so the
// two processes can't drift apart on what "the same timeout" means.

export interface ExecutionConfig {
  language: string;
  code: string;
  input: string;
  timeLimit?: number;
  memoryLimit?: number;
  // 'run' (interactive Run button) gets queue priority over 'grade'
  // (submit-time grading). Defaults to 'run' if omitted.
  purpose?: 'run' | 'grade';
}

export interface LanguageConfig {
  extension: string;
  compile?: string[];
  run: string[];
}

export const DEFAULT_TIMEOUT = 5000; // 5 seconds
export const HARD_TIMEOUT_BUFFER = 5000; // Additional buffer for the outer hard-kill race
export const COMPILE_TIMEOUT = 30000; // Compile step budget (javac/g++/gcc) for compiled languages
export const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB

export const LANGUAGE_CONFIG: Record<string, LanguageConfig> = {
  javascript: {
    extension: 'js',
    run: ['node', '--max-old-space-size=256'],
  },
  python: {
    extension: 'py',
    run: ['python3', '-u'], // -u for unbuffered output
  },
  java: {
    extension: 'java',
    compile: ['javac'],
    run: ['java', '-Xmx256m'], // Limit JVM heap to 256MB
  },
  cpp: {
    extension: 'cpp',
    compile: ['g++', '-O2', '-o'],
    run: [],
  },
  c: {
    extension: 'c',
    compile: ['gcc', '-O2', '-o'],
    run: [],
  },
};
