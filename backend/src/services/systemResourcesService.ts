// Real host/process/DB resource numbers for the Superadmin Observer's
// Telemetry screen — the counterpart to telemetryRingBuffer.ts's app-level
// metrics. Everything here is read straight from the OS, the running PM2
// daemon, or Postgres itself at call time; nothing is estimated or cached
// beyond the single tick that reads it, and any source that isn't available
// on this host (e.g. PM2 during local dev, or disk stats on Windows) reports
// null instead of a fabricated number.

import os from 'os';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import prisma from '../utils/db.js';

const execAsync = promisify(exec);
const PM2_JLIST_TIMEOUT_MS = 4_000;

export interface HostResources {
  cpuLoadPct: number | null; // 1-minute load average, normalized to 0-100% of total cores
  cpuCores: number;
  memTotalBytes: number;
  memUsedBytes: number;
  memUsedPct: number;
  diskTotalBytes: number | null;
  diskUsedBytes: number | null;
  diskUsedPct: number | null;
  uptimeSec: number;
}

export interface ProcessResource {
  name: string;
  pmId: number;
  status: string;
  cpuPct: number;
  memBytes: number;
  uptimeMs: number | null;
  restarts: number;
}

export interface DbPoolResources {
  activeConnections: number;
}

export interface BacklogResources {
  pendingAdminDeletions: number;
}

export function getHostResources(): HostResources {
  const cpuCores = os.cpus().length || 1;
  // os.loadavg() always reports [0, 0, 0] on Windows — real on Linux, where this
  // actually runs in production, so we don't special-case the platform beyond that.
  const [loadAvg1m] = os.loadavg();
  const cpuLoadPct = loadAvg1m > 0 ? Math.min(100, Math.round((loadAvg1m / cpuCores) * 1000) / 10) : null;

  const memTotalBytes = os.totalmem();
  const memUsedBytes = memTotalBytes - os.freemem();
  const memUsedPct = Math.round((memUsedBytes / memTotalBytes) * 1000) / 10;

  let diskTotalBytes: number | null = null;
  let diskUsedBytes: number | null = null;
  let diskUsedPct: number | null = null;
  try {
    // statfsSync isn't implemented for Windows in Node — falls through to the catch
    // there (local dev), and reports real numbers on the Linux production host.
    const stats = fs.statfsSync('/');
    diskTotalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    diskUsedBytes = diskTotalBytes - freeBytes;
    diskUsedPct = Math.round((diskUsedBytes / diskTotalBytes) * 1000) / 10;
  } catch {
    // not available on this platform — leave as null rather than guessing
  }

  return {
    cpuLoadPct,
    cpuCores,
    memTotalBytes,
    memUsedBytes,
    memUsedPct,
    diskTotalBytes,
    diskUsedBytes,
    diskUsedPct,
    uptimeSec: os.uptime(),
  };
}

interface Pm2ListEntry {
  name: string;
  pm_id: number;
  pm2_env?: { status?: string; pm_uptime?: number; restart_time?: number };
  monit?: { cpu?: number; memory?: number };
}

// Reads straight from the PM2 daemon this process is itself managed by
// (ecosystem.config.js) — the same source the `pm2` CLI/dashboard reads.
// Returns null (not an error) when pm2 isn't reachable, e.g. local dev
// where nothing runs under PM2 at all.
export async function getProcessResources(): Promise<ProcessResource[] | null> {
  try {
    const { stdout } = await execAsync('pm2 jlist', { timeout: PM2_JLIST_TIMEOUT_MS });
    const list = JSON.parse(stdout) as Pm2ListEntry[];
    return list.map((entry) => ({
      name: entry.name,
      pmId: entry.pm_id,
      status: entry.pm2_env?.status ?? 'unknown',
      cpuPct: entry.monit?.cpu ?? 0,
      memBytes: entry.monit?.memory ?? 0,
      uptimeMs: entry.pm2_env?.pm_uptime ? Date.now() - entry.pm2_env.pm_uptime : null,
      restarts: entry.pm2_env?.restart_time ?? 0,
    }));
  } catch {
    return null;
  }
}

export async function getDbPoolResources(): Promise<DbPoolResources | null> {
  try {
    const rows = await prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) AS count FROM pg_stat_activity WHERE datname = current_database()`;
    return { activeConnections: Number(rows[0]?.count ?? 0) };
  } catch {
    return null;
  }
}

export async function getBacklogResources(): Promise<BacklogResources> {
  const pendingAdminDeletions = await prisma.admin.count({ where: { pendingDeletionAt: { not: null } } });
  return { pendingAdminDeletions };
}

export async function getLiveResourcesSnapshot() {
  const [processes, dbPool, backlog] = await Promise.all([
    getProcessResources(),
    getDbPoolResources(),
    getBacklogResources(),
  ]);
  return {
    capturedAt: new Date().toISOString(),
    host: getHostResources(),
    processes,
    dbPool,
    backlog,
  };
}
