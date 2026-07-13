import Docker from 'dockerode';
import { mkdir, chmod, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { CodeExecutionResult } from '../types/index.js';
import {
  ExecutionConfig,
  LanguageConfig,
  LANGUAGE_CONFIG,
  DEFAULT_TIMEOUT,
  COMPILE_TIMEOUT,
  MAX_OUTPUT_SIZE,
} from './codeExecutionShared.js';

// dockerode auto-detects the right socket: Windows Docker Desktop's named
// pipe (//./pipe/docker_engine) in dev, /var/run/docker.sock on a Linux prod
// host — same code path either way.
const docker = new Docker();

export const CODE_EXEC_DOCKER_IMAGE = process.env.CODE_EXEC_DOCKER_IMAGE || 'talentq/code-exec:dev';
const CODE_EXEC_SCRATCH_ROOT = process.env.CODE_EXEC_SCRATCH_ROOT || join(os.tmpdir(), 'talentq-code-exec');
const DEFAULT_MEMORY_MB = 256;
// Fraction of a CPU core reserved per container (1.0 = one full core). On a
// small box, MAX_CONCURRENT_EXECUTIONS x this value can easily exceed the
// physical core count — tune both together for the host you're actually on.
const CONTAINER_CPU_CORES = Number(process.env.CODE_EXEC_CONTAINER_CPUS || 1);
const CONTAINER_PIDS_LIMIT = Number(process.env.CODE_EXEC_CONTAINER_PIDS_LIMIT || 64);

// Labels used by containerReaper.ts to find and force-remove anything that
// somehow survives past its expected lifetime.
export const CODE_EXEC_LABEL = 'talentq.codeexec';

async function ensureScratchRoot(): Promise<void> {
  await mkdir(CODE_EXEC_SCRATCH_ROOT, { recursive: true }).catch(() => {});
}

// Builds the in-container shell command. Compilation and execution are each
// wrapped in coreutils `timeout` so the container enforces its own deadline
// even if the Node-side wrapper crashes. Exit code 125 is reserved to mean
// "compilation failed" (distinct from 124, which `timeout` uses for "the
// command itself was killed for running too long" — i.e. a genuine
// Time-Limit-Exceeded on the candidate's code, not an infra problem).
//
// Input is redirected from a file (`< input.txt`) rather than delivered over
// a Docker attach stdin stream: closing a dockerode attach stream doesn't
// reliably propagate as stdin EOF over every transport (confirmed hanging
// forever over Docker Desktop's Windows named-pipe transport), so any
// program reading stdin would block until the outer timeout killed it. File
// redirection sidesteps that entirely and is identical on every platform.
function buildShellCommand(
  language: string,
  langConfig: LanguageConfig,
  className: string | undefined,
  timeLimitMs: number
): string {
  const runSeconds = Math.max(1, Math.ceil(timeLimitMs / 1000));
  const compileSeconds = Math.ceil(COMPILE_TIMEOUT / 1000);

  let runCmd: string;
  if (language === 'java') {
    runCmd = `java -Xmx256m -cp /workspace ${className}`;
  } else if (language === 'cpp' || language === 'c') {
    runCmd = './main';
  } else if (language === 'python') {
    runCmd = 'python3 -u main.py';
  } else {
    runCmd = 'node --max-old-space-size=256 main.js';
  }
  const timedRun = `timeout -k 2 ${runSeconds} ${runCmd} < input.txt`;

  if (!langConfig.compile) {
    return timedRun;
  }

  const compileCmd =
    language === 'java'
      ? 'javac Main.java'
      : language === 'cpp'
      ? 'g++ -O2 -o main main.cpp'
      : 'gcc -O2 -o main main.c';

  return `if timeout ${compileSeconds} ${compileCmd}; then ${timedRun}; else exit 125; fi`;
}

export async function runInSandbox(config: ExecutionConfig): Promise<CodeExecutionResult> {
  const { language, code, input, timeLimit = DEFAULT_TIMEOUT, memoryLimit } = config;

  const langConfig = LANGUAGE_CONFIG[language.toLowerCase()];
  if (!langConfig) {
    return {
      success: false,
      error: `Unsupported language: ${language}. Supported: ${Object.keys(LANGUAGE_CONFIG).join(', ')}`,
    };
  }
  if (!code || code.trim().length === 0) {
    return { success: false, error: 'No code provided' };
  }

  await ensureScratchRoot();
  const executionId = uuidv4();
  const scratchDir = join(CODE_EXEC_SCRATCH_ROOT, executionId);
  await mkdir(scratchDir, { recursive: true });
  // The container runs as a fixed non-root uid baked into the image; this
  // scratch dir is throwaway and per-execution, so the simplest portable fix
  // (across Docker Desktop's WSL2 bind mounts and a real Linux host) is to
  // make it world-writable rather than trying to match host/container uids.
  await chmod(scratchDir, 0o777);

  const normalizedLanguage = language.toLowerCase();
  const fileName = normalizedLanguage === 'java' ? 'Main.java' : `main.${langConfig.extension}`;
  await writeFile(join(scratchDir, fileName), code);
  await writeFile(join(scratchDir, 'input.txt'), input || '');

  const className = normalizedLanguage === 'java'
    ? (code.match(/public\s+class\s+(\w+)/)?.[1] || 'Main')
    : undefined;

  const memMb = memoryLimit || DEFAULT_MEMORY_MB;
  const shellCommand = buildShellCommand(normalizedLanguage, langConfig, className, timeLimit);
  // Outer backstop timeout: compile budget (if any) + run budget + margin.
  // If this fires, the in-container `timeout` above has already failed to
  // enforce the deadline itself — treat it as an infra problem, not TLE.
  const outerTimeoutMs = (langConfig.compile ? COMPILE_TIMEOUT : 0) + timeLimit + 10000;

  let container: Docker.Container | undefined;
  const startTime = Date.now();

  try {
    container = await docker.createContainer({
      Image: CODE_EXEC_DOCKER_IMAGE,
      Cmd: ['sh', '-c', shellCommand],
      WorkingDir: '/workspace',
      User: 'node',
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      HostConfig: {
        Binds: [`${scratchDir}:/workspace`],
        ReadonlyRootfs: true,
        Tmpfs: { '/tmp': 'rw,size=32m,mode=1777' },
        NetworkMode: 'none',
        Memory: memMb * 1024 * 1024,
        MemorySwap: memMb * 1024 * 1024,
        NanoCpus: Math.round(CONTAINER_CPU_CORES * 1_000_000_000),
        PidsLimit: CONTAINER_PIDS_LIMIT,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
      },
      Labels: {
        [CODE_EXEC_LABEL]: 'true',
        'talentq.executionId': executionId,
        'talentq.startedAt': new Date().toISOString(),
      },
    });

    const attachStream = await container.attach({ stream: true, stdout: true, stderr: true });

    let stdout = '';
    let stderr = '';
    const stdoutSink = { write: (chunk: Buffer) => { if (stdout.length < MAX_OUTPUT_SIZE) stdout += chunk.toString(); } };
    const stderrSink = { write: (chunk: Buffer) => { if (stderr.length < MAX_OUTPUT_SIZE) stderr += chunk.toString(); } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (docker as any).modem.demuxStream(attachStream, stdoutSink, stderrSink);

    await container.start();

    let timedOut = false;
    const waitResult = await Promise.race([
      container.wait(),
      new Promise<{ StatusCode: number }>((resolve) => {
        setTimeout(() => { timedOut = true; resolve({ StatusCode: -1 }); }, outerTimeoutMs);
      }),
    ]);

    if (timedOut) {
      await container.kill({ signal: 'SIGKILL' }).catch(() => {});
      return { success: false, error: 'Execution timed out. Your code took too long to run.' };
    }

    const executionTime = Date.now() - startTime;
    const exitCode = waitResult.StatusCode;

    if (exitCode === 124) {
      return {
        success: false,
        error: 'Time Limit Exceeded - Your code took too long to execute',
        executionTime: timeLimit,
      };
    }
    if (exitCode === 125) {
      const errorMsg = stderr || stdout || 'Unknown compilation error';
      return { success: false, error: `Compilation Error:\n${errorMsg.slice(0, 2000)}` };
    }
    if (exitCode !== 0) {
      const errorMsg = stderr || 'Runtime error (non-zero exit code)';
      return { success: false, error: `Runtime Error:\n${errorMsg.slice(0, 2000)}`, executionTime };
    }

    return { success: true, output: stdout.trim(), executionTime };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown execution error',
    };
  } finally {
    if (container) {
      await container.remove({ force: true }).catch(() => {});
    }
    rm(scratchDir, { recursive: true, force: true }).catch(() => {});
  }
}
