import type Anthropic from '@anthropic-ai/sdk';
import { fetchAdminAccounts } from '../controllers/superAdminAccounts.js';
import { fetchActionLog, fetchAuditLog, fetchClickEvents } from '../controllers/superAdminAuditLog.js';
import { fetchFeatureFlags } from '../controllers/superAdminFeatureFlags.js';
import { fetchLiveTelemetry, fetchTelemetryHistory } from '../controllers/superAdminTelemetry.js';

// Every tool here is a read-only window into the same data the superadmin
// screens already render — the assistant never touches Prisma directly with
// anything other than these vetted, capped queries, and it has no tool that
// writes, deletes, or toggles anything.
const MAX_ROWS = 100;

function clampLimit(input: unknown, fallback: number): number {
  const n = typeof input === 'number' ? input : Number.parseInt(String(input ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_ROWS, Math.floor(n));
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
        limit: { type: 'number', description: `Max rows to return, most recent first (default 50, max ${MAX_ROWS}).` },
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
        limit: { type: 'number', description: `Max rows to return, most recent first (default 50, max ${MAX_ROWS}).` },
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
        limit: { type: 'number', description: `Max rows to return, most recent first (default 50, max ${MAX_ROWS}).` },
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
        limit: { type: 'number', description: 'Max snapshots to return, oldest to newest (default 60, max 500).' },
      },
    },
  },
  {
    name: 'get_feature_flags',
    description:
      'The current state of every feature lock (test creation, invitations, results export, AI test generator, question repository writes) — whether enabled, scope (global or a specific admin), and who last changed it.',
    input_schema: { type: 'object', properties: {} },
  },
];

export async function executeAssistantTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_admin_accounts':
      return fetchAdminAccounts();
    case 'get_action_log':
      return fetchActionLog({ take: clampLimit(input.limit, 50) });
    case 'get_audit_log':
      return fetchAuditLog({
        take: clampLimit(input.limit, 50),
        resourceType: typeof input.resourceType === 'string' ? input.resourceType : undefined,
      });
    case 'get_click_events':
      return fetchClickEvents({ take: clampLimit(input.limit, 50) });
    case 'get_live_telemetry':
      return fetchLiveTelemetry();
    case 'get_telemetry_history':
      return fetchTelemetryHistory(clampLimit(input.limit, 60));
    case 'get_feature_flags':
      return fetchFeatureFlags();
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
