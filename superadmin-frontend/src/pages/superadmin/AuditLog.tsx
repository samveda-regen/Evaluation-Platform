import { useEffect, useState, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { Download, ShieldCheck, ShieldAlert, ArrowLeft } from 'lucide-react';
import {
  superAdminApi,
  type AuditLogEntry,
  type AdminActionLogEntry,
  type ClickSessionSummary,
  type AdminClickEventEntry,
} from '../../services/superAdminApi';
import { getRealtimeSocket } from '../../services/realtimeService';
import { Card, EmptyState, PageHeader, StatusPill, relativeTime } from './components';

function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 120);
  return String(value).slice(0, 120);
}

function downloadCsv(csv: string) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function FilterBar({
  search,
  setSearch,
  from,
  setFrom,
  to,
  setTo,
}: {
  search: string;
  setSearch: (v: string) => void;
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <input
        placeholder="Search actor, resource, action…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="flex-1 min-w-[200px] bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-[12.5px] text-sa-ink outline-none focus:border-sa-accent font-mono"
      />
      <input
        type="date"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        className="bg-sa-panel-inset border border-sa-line rounded-sm px-2.5 py-2 text-[12px] text-sa-ink outline-none focus:border-sa-accent font-mono"
      />
      <span className="text-sa-ink-faint text-[11px]">to</span>
      <input
        type="date"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className="bg-sa-panel-inset border border-sa-line rounded-sm px-2.5 py-2 text-[12px] text-sa-ink outline-none focus:border-sa-accent font-mono"
      />
    </div>
  );
}

export default function SuperAdminAuditLog() {
  const [tab, setTab] = useState<'changes' | 'requests' | 'replay'>('changes');
  const [audit, setAudit] = useState<AuditLogEntry[] | null>(null);
  const [actions, setActions] = useState<AdminActionLogEntry[] | null>(null);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [chainStatus, setChainStatus] = useState<{ intact: boolean; checkedCount: number } | null>(null);

  const [sessions, setSessions] = useState<ClickSessionSummary[] | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [replayEvents, setReplayEvents] = useState<AdminClickEventEntry[] | null>(null);

  const load = useCallback(async () => {
    try {
      const params = { limit: 100, search: search || undefined, from: from || undefined, to: to || undefined };
      const [auditRes, actionRes] = await Promise.all([
        superAdminApi.getAuditLog(params),
        superAdminApi.getActionLog(params),
      ]);
      setAudit(auditRes.data.entries);
      setActions(actionRes.data.entries);
    } catch {
      toast.error('Failed to load audit log');
    }
  }, [search, from, to]);

  const loadSessions = useCallback(async () => {
    try {
      const { data } = await superAdminApi.listClickSessions();
      setSessions(data.sessions);
    } catch {
      toast.error('Failed to load click sessions');
    }
  }, []);

  useEffect(() => {
    void load();
    const socket = getRealtimeSocket();
    const onAudit = () => void load();
    const onAction = () => void load();
    socket.on('audit-entry', onAudit);
    socket.on('admin-action', onAction);
    return () => {
      socket.off('audit-entry', onAudit);
      socket.off('admin-action', onAction);
    };
  }, [load]);

  useEffect(() => {
    if (tab === 'replay' && !sessions) void loadSessions();
  }, [tab, sessions, loadSessions]);

  const openSession = async (sessionId: string) => {
    setSelectedSession(sessionId);
    try {
      const { data } = await superAdminApi.getClickSessionReplay(sessionId);
      setReplayEvents(data.entries);
    } catch {
      toast.error('Failed to load session replay');
    }
  };

  const exportCsv = async () => {
    try {
      const { data } = await superAdminApi.exportAuditLogCsv({ search: search || undefined, from: from || undefined, to: to || undefined });
      downloadCsv(data);
    } catch {
      toast.error('Export failed');
    }
  };

  const verifyChain = async () => {
    try {
      const { data } = await superAdminApi.getAuditChainStatus();
      setChainStatus(data);
      toast[data.intact ? 'success' : 'error'](
        data.intact ? `Chain intact across ${data.checkedCount} record(s)` : `Tamper detected at record ${data.brokenAtIndex}`
      );
    } catch {
      toast.error('Verification failed');
    }
  };

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description="Every change on the platform — who changed what and when — plus the complete, server-guaranteed request log and per-admin click replay behind it."
      />

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex gap-2">
          {(['changes', 'requests', 'replay'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`font-mono text-[11px] uppercase tracking-[0.05em] px-3 py-1.5 rounded-full border ${
                tab === t ? 'text-sa-accent bg-sa-accent-soft border-sa-accent/40' : 'text-sa-ink-dim bg-sa-panel-inset border-sa-line'
              }`}
            >
              {t === 'changes' ? 'What changed' : t === 'requests' ? 'Every request' : 'Session replay'}
            </button>
          ))}
        </div>
        {tab === 'changes' && (
          <div className="flex items-center gap-2">
            {chainStatus && (
              <StatusPill tone={chainStatus.intact ? 'good' : 'critical'}>
                {chainStatus.intact ? 'Chain intact' : 'Tampered'}
              </StatusPill>
            )}
            <button
              onClick={() => void verifyChain()}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide px-2.5 py-1.5 rounded-sm border border-sa-line text-sa-ink-dim hover:border-sa-line-bright transition-all"
            >
              {chainStatus?.intact === false ? <ShieldAlert size={13} /> : <ShieldCheck size={13} />} Verify integrity
            </button>
            <button
              onClick={() => void exportCsv()}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide px-2.5 py-1.5 rounded-sm border border-sa-accent/40 text-sa-accent hover:shadow-glow-cyan-sm transition-all"
            >
              <Download size={13} /> Export CSV
            </button>
          </div>
        )}
      </div>

      {(tab === 'changes' || tab === 'requests') && (
        <FilterBar search={search} setSearch={setSearch} from={from} setFrom={setFrom} to={to} setTo={setTo} />
      )}

      {tab === 'changes' && (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-sa-line text-left">
                  {['Time', 'Actor', 'Action', 'Resource', 'Before → After'].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-mono text-[10px] tracking-[0.06em] uppercase text-sa-ink-faint font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {audit?.map((row) => (
                  <tr key={row.id} className="border-b border-sa-line-soft last:border-0 align-top">
                    <td className="px-4 py-2.5 font-mono text-[11.5px] text-sa-ink-faint whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-sa-ink">{row.actorEmail}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-sa-panel-inset border border-sa-line text-sa-ink-dim">
                        {row.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-sa-ink-dim">
                      {row.resourceType}
                      {row.resourceId ? <span className="font-mono text-[11px] text-sa-ink-faint"> #{row.resourceId.slice(0, 8)}</span> : null}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11.5px] text-sa-ink-faint max-w-md truncate">
                      {formatDiffValue(row.before)} → {formatDiffValue(row.after)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {audit?.length === 0 && <EmptyState>No changes recorded yet.</EmptyState>}
            {audit === null && <EmptyState>Loading…</EmptyState>}
          </div>
        </Card>
      )}

      {tab === 'requests' && (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-sa-line text-left">
                  {['Time', 'Admin', 'Method', 'Path', 'Status', 'Duration'].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-mono text-[10px] tracking-[0.06em] uppercase text-sa-ink-faint font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {actions?.map((row) => (
                  <tr key={row.id} className="border-b border-sa-line-soft last:border-0">
                    <td className="px-4 py-2.5 font-mono text-[11.5px] text-sa-ink-faint whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-2.5 text-sa-ink">{row.adminEmail}</td>
                    <td className="px-4 py-2.5 font-mono text-[11.5px] text-sa-ink-dim">{row.method}</td>
                    <td className="px-4 py-2.5 font-mono text-[11.5px] text-sa-ink-dim truncate max-w-xs">{row.path}</td>
                    <td className="px-4 py-2.5">
                      <StatusPill tone={row.statusCode >= 500 ? 'critical' : row.statusCode >= 400 ? 'warn' : 'good'}>
                        {row.statusCode}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11.5px] text-sa-ink-faint tabular-nums">{row.durationMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {actions?.length === 0 && <EmptyState>No requests recorded yet.</EmptyState>}
            {actions === null && <EmptyState>Loading…</EmptyState>}
          </div>
        </Card>
      )}

      {tab === 'replay' && (
        <Card className="p-0 overflow-hidden">
          {selectedSession ? (
            <div className="p-4">
              <button
                onClick={() => {
                  setSelectedSession(null);
                  setReplayEvents(null);
                }}
                className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-sa-ink-dim hover:text-sa-accent transition-colors mb-4"
              >
                <ArrowLeft size={13} /> Back to sessions
              </button>
              <div className="relative pl-5 space-y-3 border-l border-sa-line-bright ml-1.5">
                {replayEvents?.map((event) => (
                  <div key={event.id} className="relative">
                    <span className="absolute -left-[23px] top-1 h-2 w-2 rounded-full bg-sa-accent shadow-glow-cyan-sm" />
                    <div className="font-mono text-[11px] text-sa-ink-faint">
                      {new Date(event.clientTimestamp).toLocaleTimeString()}
                    </div>
                    <div className="text-[13px] text-sa-ink">
                      {event.eventType}
                      {event.targetLabel && <span className="text-sa-ink-dim"> — {event.targetLabel}</span>}
                    </div>
                    {event.route && <div className="font-mono text-[11px] text-sa-ink-faint">{event.route}</div>}
                  </div>
                ))}
                {replayEvents?.length === 0 && <EmptyState>No events in this session.</EmptyState>}
                {replayEvents === null && <EmptyState>Loading…</EmptyState>}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-sa-line text-left">
                    {['Admin', 'Started', 'Ended', 'Events', ''].map((h) => (
                      <th key={h} className="px-4 py-2.5 font-mono text-[10px] tracking-[0.06em] uppercase text-sa-ink-faint font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sessions?.map((s) => (
                    <tr key={s.sessionId} className="border-b border-sa-line-soft last:border-0">
                      <td className="px-4 py-2.5 text-sa-ink">{s.adminEmail}</td>
                      <td className="px-4 py-2.5 font-mono text-[11.5px] text-sa-ink-faint">{relativeTime(s.startedAt)}</td>
                      <td className="px-4 py-2.5 font-mono text-[11.5px] text-sa-ink-faint">{relativeTime(s.endedAt)}</td>
                      <td className="px-4 py-2.5 font-mono text-[11.5px] text-sa-ink-dim">{s.eventCount}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => void openSession(s.sessionId)}
                          className="font-mono text-[11.5px] uppercase tracking-wide text-sa-accent border border-sa-accent/40 rounded-sm px-2.5 py-1.5 hover:shadow-glow-cyan-sm transition-all"
                        >
                          Replay
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sessions?.length === 0 && <EmptyState>No click sessions recorded yet.</EmptyState>}
              {sessions === null && <EmptyState>Loading…</EmptyState>}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
