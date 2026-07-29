import type Anthropic from '@anthropic-ai/sdk';
import { fetchAdminAccounts } from '../controllers/superAdminAccounts.js';
import { fetchActionLog, fetchAuditLog, fetchClickEvents } from '../controllers/superAdminAuditLog.js';
import { fetchFeatureFlags } from '../controllers/superAdminFeatureFlags.js';
import { fetchLiveTelemetry, fetchTelemetryHistory } from '../controllers/superAdminTelemetry.js';

// Every tool here is a read-only window into the same data the superadmin
// screens already render — the assistant never touches Prisma directly with
// anything other than these vetted, capped queries, and it has no tool that
// writes, deletes, or toggles anything.
//
// Kept deliberately small: every tool_result gets appended to the running
// message list and resent in full on each subsequent tool-use round (that's
// how the Anthropic API works, not something we can avoid) -- a single
// verbose result can get billed several times over within one multi-round
// answer. The screens these mirror (Audit Log, Action Log, etc.) still show
// full, unclamped history; only what's handed to the LLM is capped.
const MAX_ROWS = 25;
const DEFAULT_ROWS = 15;

function clampLimit(input: unknown, fallback: number = DEFAULT_ROWS): number {
  const n = typeof input === 'number' ? input : Number.parseInt(String(input ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_ROWS, Math.floor(n));
}

// AuditLog.before/after are full JSON snapshots of whatever entity changed
// (a Test row can carry long instructions/email-body text and settings
// blobs) -- multiplied across up to 25 rows, this is the single biggest
// token cost in the assistant's toolset. The real Audit Log screen still
// gets the untouched snapshots; this only thins what the LLM sees.
const MAX_SNAPSHOT_VALUE_CHARS = 200;

function summarizeSnapshot(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_SNAPSHOT_VALUE_CHARS ? `${value.slice(0, MAX_SNAPSHOT_VALUE_CHARS)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 5).map(summarizeSnapshot);
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 20);
    return Object.fromEntries(entries.map(([k, v]) => [k, summarizeSnapshot(v)]));
  }
  return value;
}

function summarizeAuditEntries(entries: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return entries.map((entry) => ({
    ...entry,
    before: summarizeSnapshot(entry.before),
    after: summarizeSnapshot(entry.after),
  }));
}

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_admin_accounts',
    description:
      'List every admin account on the platform, with company name, online/offline status, last-active time, total recorded actions, and owned content counts (tests, MCQ/coding/behavioral questions).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_action_log',
    description:
      'The server-guaranteed log of every admin API request (method, path, status code, duration, ip, admin email/name, timestamp). This is the ground truth for "what did admins do" — every request is logged, including failed ones.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: `Max rows to return, most recent first (default ${DEFAULT_ROWS}, max ${MAX_ROWS}).` },
      },
    },
  },
  {
    name: 'get_audit_log',
    description:
      'The before/after mutation trail — create/update/delete actions on Tests, Questions, Admins, FeatureFlags, etc., with the actor email and a before/after snapshot. This is the "what changed" record.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: `Max rows to return, most recent first (default ${DEFAULT_ROWS}, max ${MAX_ROWS}).` },
        resourceType: { type: 'string', description: 'Optional filter, e.g. "Test", "Admin", "FeatureFlag".' },
      },
    },
  },
  {
    name: 'get_click_events',
    description:
      'Raw UI click/navigation events reported by admin browser tabs — target label, route, and timestamp. Useful for reconstructing exactly what an admin clicked, at UI-level granularity below the action log.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: `Max rows to return, most recent first (default ${DEFAULT_ROWS}, max ${MAX_ROWS}).` },
      },
    },
  },
  {
    name: 'get_live_telemetry',
    description:
      'Current live platform health: app frame rate (fps), API latency p50/p95, socket ping, CV/proctoring engine latency p50/p95, proctoring refresh rate, failed-request rate, and active proctoring session count. All values are measured in the last 5 minutes, not simulated.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_telemetry_history',
    description:
      'Historical telemetry snapshots (one per minute) for trend analysis — same fields as get_live_telemetry, sampled over time.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: `Max snapshots to return, oldest to newest (default ${DEFAULT_ROWS}, max ${MAX_ROWS}).` },
      },
    },
  },
  {
    name: 'get_feature_flags',
    description:
      'The current platform-wide state of every feature lock (test creation, invitations, results export, AI test generator, question repository writes) — whether enabled, and who last changed it. Per-account overrides are not included here.',
    input_schema: { type: 'object', properties: {} },
  },
];

export async function executeAssistantTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_admin_accounts':
      return fetchAdminAccounts();
    case 'get_action_log':
      return fetchActionLog({ take: clampLimit(input.limit) });
    case 'get_audit_log': {
      const result = await fetchAuditLog({
        take: clampLimit(input.limit),
        resourceType: typeof input.resourceType === 'string' ? input.resourceType : undefined,
      });
      return { ...result, entries: summarizeAuditEntries(result.entries) };
    }
    case 'get_click_events':
      return fetchClickEvents({ take: clampLimit(input.limit) });
    case 'get_live_telemetry':
      return fetchLiveTelemetry();
    case 'get_telemetry_history':
      return fetchTelemetryHistory(clampLimit(input.limit));
    case 'get_feature_flags':
      return fetchFeatureFlags();
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
