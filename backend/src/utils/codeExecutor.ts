import { spawn, ChildProcess } from 'child_process';
import { writeFile, mkdir, rm, chown, chmod } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { CodeExecutionResult } from '../types/index.js';

const TEMP_DIR = '/tmp/code_execution';
const DEFAULT_TIMEOUT = 5000; // 5 seconds
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB
const HARD_TIMEOUT_BUFFER = 5000; // Additional 5s buffer for hard kill

// Candidate code must run as an unprivileged OS account, never as the
// backend's own user (which can read backend/.env and every other app
// file). Set CODE_EXEC_UID/CODE_EXEC_GID to the numeric uid/gid of a
// dedicated low-privilege sandbox user (see ops docs for setup) - the
// backend process itself needs root or CAP_SETUID/CAP_SETGID to drop into
// it. Without this configured, code still runs as whatever user the
// backend runs as, which is only acceptable in local dev.
const SANDBOX_UID = process.env.CODE_EXEC_UID ? Number(process.env.CODE_EXEC_UID) : undefined;
const SANDBOX_GID = process.env.CODE_EXEC_GID ? Number(process.env.CODE_EXEC_GID) : undefined;
const SANDBOX_USER_CONFIGURED =
  process.platform !== 'win32' &&
  Number.isInteger(SANDBOX_UID) &&
  Number.isInteger(SANDBOX_GID);

if (!SANDBOX_USER_CONFIGURED && process.env.NODE_ENV === 'production') {
  console.warn(
    '[codeExecutor] CODE_EXEC_UID/CODE_EXEC_GID are not set - candidate code will run as the ' +
    'backend process user, which can read application secrets and files. Configure a dedicated ' +
    'unprivileged sandbox user before serving real candidates.'
  );
}

// Code Execution Queue Configuration
const MAX_CONCURRENT_EXECUTIONS = 10;
const QUEUE_TIMEOUT = 30000; // 30 seconds max wait in queue

// Track active processes for cleanup
const activeProcesses = new Set<ChildProcess>();

interface QueuedExecution {
  resolve: (result: CodeExecutionResult) => void;
  reject: (error: Error) => void;
  config: ExecutionConfig;
  addedAt: number;
}

// Improved execution queue with better error handling
class ExecutionQueue {
  private queue: QueuedExecution[] = [];
  private activeExecutions = 0;

  async enqueue(config: ExecutionConfig): Promise<CodeExecutionResult> {
    // If we have capacity, execute immediately
    if (this.activeExecutions < MAX_CONCURRENT_EXECUTIONS) {
      return this.execute(config);
    }

    // Otherwise, add to queue and wait
    return new Promise<CodeExecutionResult>((resolve, reject) => {
      const queuedItem: QueuedExecution = {
        resolve,
        reject,
        config,
        addedAt: Date.now()
      };
      this.queue.push(queuedItem);

      // Set timeout for queue wait
      const timeoutId = setTimeout(() => {
        const index = this.queue.indexOf(queuedItem);
        if (index !== -1) {
          this.queue.splice(index, 1);
          resolve({
            success: false,
            error: 'Server is busy. Please try again in a few seconds.'
          });
        }
      }, QUEUE_TIMEOUT);

      // Store timeout ID for cleanup
      (queuedItem as QueuedExecution & { timeoutId?: NodeJS.Timeout }).timeoutId = timeoutId;
    });
  }

  private async execute(config: ExecutionConfig): Promise<CodeExecutionResult> {
    this.activeExecutions++;

    // Hard timeout wrapper - ensures execution completes within limit
    const hardTimeout = (config.timeLimit || DEFAULT_TIMEOUT) + HARD_TIMEOUT_BUFFER;

    try {
      const result = await Promise.race([
        executeCodeInternal(config),
        new Promise<CodeExecutionResult>((resolve) => {
          setTimeout(() => {
            resolve({
              success: false,
              error: 'Execution timed out. Your code took too long to run.'
            });
          }, hardTimeout);
        })
      ]);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Execution failed unexpectedly'
      };
    } finally {
      this.activeExecutions--;
      this.processQueue();
    }
  }

  private processQueue(): void {
    if (this.queue.length === 0 || this.activeExecutions >= MAX_CONCURRENT_EXECUTIONS) {
      return;
    }

    const next = this.queue.shift();
    if (next) {
      // Clear the timeout
      const item = next as QueuedExecution & { timeoutId?: NodeJS.Timeout };
      if (item.timeoutId) {
        clearTimeout(item.timeoutId);
      }

      // Check if this item has timed out
      if (Date.now() - next.addedAt > QUEUE_TIMEOUT) {
        next.resolve({
          success: false,
          error: 'Server is busy. Please try again in a few seconds.'
        });
        this.processQueue();
        return;
      }

      this.execute(next.config).then(next.resolve).catch(next.reject);
    }
  }

  getStatus(): { active: number; queued: number; maxConcurrent: number } {
    return {
      active: this.activeExecutions,
      queued: this.queue.length,
      maxConcurrent: MAX_CONCURRENT_EXECUTIONS
    };
  }
}

// Singleton queue instance
const executionQueue = new ExecutionQueue();

interface ExecutionConfig {
  language: string;
  code: string;
  input: string;
  timeLimit?: number;
  memoryLimit?: number;
}

const LANGUAGE_CONFIG: Record<string, { extension: string; compile?: string[]; run: string[] }> = {
  javascript: {
    extension: 'js',
    run: ['node', '--max-old-space-size=256']
  },
  python: {
    extension: 'py',
    run: ['python3', '-u'] // -u for unbuffered output
  },
  java: {
    extension: 'java',
    compile: ['javac'],
    run: ['java', '-Xmx256m'] // Limit JVM heap to 256MB
  },
  cpp: {
    extension: 'cpp',
    compile: ['g++', '-O2', '-o'], // Add optimization
    run: []
  },
  c: {
    extension: 'c',
    compile: ['gcc', '-O2', '-o'], // Add optimization
    run: []
  }
};

// Env vars that are safe to expose to candidate-submitted code.
// Everything else (DB creds, JWT/session secrets, API keys, webhook secrets,
// SSH/session vars, etc.) lives in process.env and must NEVER reach a child
// process spawned for untrusted code - do not add to this list without
// confirming the value contains no secret.
const SAFE_ENV_ALLOWLIST = ['PATH', 'LANG', 'LC_ALL', 'TZ'];

function buildSandboxEnv(workDir: string): NodeJS.ProcessEnv {
  const sandboxEnv: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      sandboxEnv[key] = process.env[key];
    }
  }
  // Point HOME/TMPDIR at the disposable per-execution workDir so language
  // runtimes/toolchains don't read or write outside the sandboxed directory.
  sandboxEnv.HOME = workDir;
  sandboxEnv.TMPDIR = workDir;
  sandboxEnv.TMP = workDir;
  sandboxEnv.TEMP = workDir;
  return sandboxEnv;
}

async function ensureTempDir(): Promise<void> {
  try {
    await mkdir(TEMP_DIR, { recursive: true });
  } catch {
    // Directory might already exist
  }

  if (SANDBOX_USER_CONFIGURED) {
    // Self-heal on every execution: TEMP_DIR must stay traversable (o+x) so
    // the sandbox uid can chdir into its own per-run subfolder (Node drops
    // privileges before chdir'ing), but not listable (no o+r). If /tmp gets
    // wiped and recreated (e.g. tmpfs reset on reboot), mkdir above silently
    // reapplies default perms, which would otherwise wedge execution again -
    // this makes that a non-issue instead of a manual chmod every reboot.
    try {
      await chmod(TEMP_DIR, 0o711);
    } catch {
      // best effort
    }
  }
}

function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid) return;

  try {
    // Try to kill the entire process group
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    try {
      // Fallback to killing just the process
      proc.kill('SIGKILL');
    } catch {
      // Process might already be dead
    }
  }

  activeProcesses.delete(proc);
}

async function executeCommand(
  command: string,
  args: string[],
  input: string,
  timeout: number,
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean; killed: boolean }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killed = false;
    let resolved = false;

    const safeResolve = (result: { stdout: string; stderr: string; exitCode: number; timedOut: boolean; killed: boolean }) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    const proc = spawn(command, args, {
      cwd,
      env: buildSandboxEnv(cwd),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true, // Create new process group for easier cleanup
      ...(SANDBOX_USER_CONFIGURED ? { uid: SANDBOX_UID as number, gid: SANDBOX_GID as number } : {})
    });

    activeProcesses.add(proc);

    // Primary timeout
    const timeoutId = setTimeout(() => {
      timedOut = true;
      killed = true;
      killProcessTree(proc);
    }, timeout);

    // Hard kill timeout (backup)
    const hardKillId = setTimeout(() => {
      if (!resolved) {
        killed = true;
        killProcessTree(proc);
        safeResolve({
          stdout: stdout.trim(),
          stderr: stderr.trim() || 'Process killed due to timeout',
          exitCode: 137,
          timedOut: true,
          killed: true
        });
      }
    }, timeout + 2000);

    proc.stdout?.on('data', (data: Buffer) => {
      if (stdout.length < MAX_OUTPUT_SIZE) {
        stdout += data.toString();
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      if (stderr.length < MAX_OUTPUT_SIZE) {
        stderr += data.toString();
      }
    });

    // Write input and close stdin
    if (input) {
      try {
        proc.stdin?.write(input);
      } catch {
        // Stdin might be closed
      }
    }
    proc.stdin?.end();

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      clearTimeout(hardKillId);
      activeProcesses.delete(proc);
      safeResolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
        timedOut,
        killed
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      clearTimeout(hardKillId);
      activeProcesses.delete(proc);
      safeResolve({
        stdout: '',
        stderr: err.message,
        exitCode: 1,
        timedOut: false,
        killed: false
      });
    });
  });
}

// Internal execution function (called by queue)
async function executeCodeInternal(config: ExecutionConfig): Promise<CodeExecutionResult> {
  const { language, code, input, timeLimit = DEFAULT_TIMEOUT } = config;

  const langConfig = LANGUAGE_CONFIG[language.toLowerCase()];
  if (!langConfig) {
    return {
      success: false,
      error: `Unsupported language: ${language}. Supported: ${Object.keys(LANGUAGE_CONFIG).join(', ')}`
    };
  }

  // Validate code isn't empty
  if (!code || code.trim().length === 0) {
    return {
      success: false,
      error: 'No code provided'
    };
  }

  await ensureTempDir();

  const executionId = uuidv4();
  const workDir = join(TEMP_DIR, executionId);

  try {
    await mkdir(workDir, { recursive: true });
  } catch (error) {
    return {
      success: false,
      error: 'Failed to create execution environment'
    };
  }

  // Java requires filename to match public class name
  const fileName = language.toLowerCase() === 'java' ? 'Main.java' : `main.${langConfig.extension}`;
  const filePath = join(workDir, fileName);

  try {
    await writeFile(filePath, code);

    // Hand the work directory over to the unprivileged sandbox user so the
    // compile/run steps below (which execute as that user) can read/write
    // within it, and so nothing else on the box is reachable from it.
    if (SANDBOX_USER_CONFIGURED) {
      await chmod(workDir, 0o700);
      await chown(workDir, SANDBOX_UID as number, SANDBOX_GID as number);
      await chown(filePath, SANDBOX_UID as number, SANDBOX_GID as number);
    }

    const startTime = Date.now();

    // Compile if needed (for Java, C, C++)
    if (langConfig.compile) {
      let compileArgs: string[];
      let outputFile = '';

      if (language.toLowerCase() === 'java') {
        compileArgs = ['Main.java'];
      } else {
        outputFile = join(workDir, 'main');
        compileArgs = [...langConfig.compile.slice(1), outputFile, filePath];
      }

      const compileResult = await executeCommand(
        langConfig.compile[0],
        compileArgs,
        '',
        30000, // 30s compile timeout
        workDir
      );

      if (compileResult.exitCode !== 0) {
        const errorMsg = compileResult.stderr || compileResult.stdout || 'Unknown compilation error';
        return {
          success: false,
          error: `Compilation Error:\n${errorMsg.substring(0, 2000)}` // Limit error message length
        };
      }
    }

    // Run the code
    let runCommand: string;
    let runArgs: string[];

    if (language.toLowerCase() === 'java') {
      const className = code.match(/public\s+class\s+(\w+)/)?.[1] || 'Main';
      runCommand = 'java';
      runArgs = ['-Xmx256m', '-cp', workDir, className];
    } else if (language.toLowerCase() === 'cpp' || language.toLowerCase() === 'c') {
      runCommand = join(workDir, 'main');
      runArgs = [];
    } else {
      runCommand = langConfig.run[0];
      runArgs = [...langConfig.run.slice(1), filePath];
    }

    const runResult = await executeCommand(runCommand, runArgs, input, timeLimit, workDir);
    const executionTime = Date.now() - startTime;

    if (runResult.timedOut || runResult.killed) {
      return {
        success: false,
        error: 'Time Limit Exceeded - Your code took too long to execute',
        executionTime: timeLimit
      };
    }

    if (runResult.exitCode !== 0) {
      const errorMsg = runResult.stderr || 'Runtime error (non-zero exit code)';
      return {
        success: false,
        error: `Runtime Error:\n${errorMsg.substring(0, 2000)}`,
        executionTime
      };
    }

    return {
      success: true,
      output: runResult.stdout,
      executionTime
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown execution error'
    };
  } finally {
    // Cleanup with retry
    const cleanup = async (retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          await rm(workDir, { recursive: true, force: true, maxRetries: 2 });
          return;
        } catch {
          if (i < retries - 1) {
            await new Promise(r => setTimeout(r, 100));
          }
        }
      }
    };

    // Run cleanup in background
    cleanup().catch(() => {});
  }
}

// Public API - queued execution
export async function executeCode(config: ExecutionConfig): Promise<CodeExecutionResult> {
  return executionQueue.enqueue(config);
}

// Get current queue status (for monitoring)
export function getExecutionQueueStatus(): { active: number; queued: number; maxConcurrent: number } {
  return executionQueue.getStatus();
}

export function compareOutput(expected: string, actual: string): boolean {
  // Normalize whitespace and compare
  const normalizeOutput = (s: string) =>
    s.trim().split('\n').map(line => line.trim()).join('\n');

  return normalizeOutput(expected) === normalizeOutput(actual);
}

// Cleanup on server shutdown
export function cleanupAllProcesses(): void {
  for (const proc of activeProcesses) {
    killProcessTree(proc);
  }
  activeProcesses.clear();
}

// Handle graceful shutdown
process.on('SIGTERM', cleanupAllProcesses);
process.on('SIGINT', cleanupAllProcesses);
