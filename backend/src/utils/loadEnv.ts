import fs from 'fs';
import path from 'path';

function applyEnvFile(envPath: string): boolean {
  if (!fs.existsSync(envPath)) return false;

  const contents = fs.readFileSync(envPath, 'utf-8');
  const lines = contents.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed.slice(eqIndex + 1).trim();
    let value = '';

    if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
      const quote = rawValue[0];
      for (let i = 1; i < rawValue.length; i += 1) {
        const ch = rawValue[i];
        if (ch === '\\' && i + 1 < rawValue.length) {
          value += rawValue[i + 1];
          i += 1;
          continue;
        }
        if (ch === quote) break;
        value += ch;
      }
    } else {
      const hashIndex = rawValue.indexOf('#');
      value = (hashIndex >= 0 ? rawValue.slice(0, hashIndex) : rawValue).trim();
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return true;
}

// Shared by both the API process (index.ts) and the standalone worker
// process (workers/codeExecutionWorker.ts) — each is a separate `node`
// invocation with no other mechanism that loads backend/.env for it.
export function loadEnvFile(): void {
  const candidatePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'backend', '.env'),
    path.resolve(__dirname, '..', '..', '.env'),
  ];

  for (const envPath of candidatePaths) {
    if (applyEnvFile(envPath)) {
      console.info(`[env] loaded from ${envPath}`);
      return;
    }
  }

  console.warn('[env] .env file not found in expected locations');
}
