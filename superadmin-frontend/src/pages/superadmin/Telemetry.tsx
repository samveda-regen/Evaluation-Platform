import { useEffect, useState, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { toast } from 'react-hot-toast';
import { superAdminApi, type LiveTelemetry, type LiveResources, type TelemetrySnapshotEntry } from '../../services/superAdminApi';
import { getRealtimeSocket } from '../../services/realtimeService';
import { Card, KpiTile, PageHeader, EmptyState, StatusPill } from './components';

const MAX_HISTORY_POINTS = 120;

function fmt(value: number | null, unit: string, digits = 0): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(digits)}${unit}`;
}

function fpsTone(fps: number | null): 'good' | 'warn' | 'critical' | 'default' {
  if (fps === null) return 'default';
  if (fps >= 50) return 'good';
  if (fps >= 30) return 'warn';
  return 'critical';
}

function fpsLabel(fps: number | null): string {
  if (fps === null) return 'no samples yet';
  if (fps >= 50) return 'smooth';
  if (fps >= 30) return 'slight jank';
  return 'janky';
}

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function fmtUptime(ms: number | null): string {
  if (ms === null) return '—';
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function pctTone(pct: number | null): 'good' | 'warn' | 'critical' | 'default' {
  if (pct === null) return 'default';
  if (pct >= 90) return 'critical';
  if (pct >= 75) return 'warn';
  return 'good';
}

function processStatusTone(status: string): 'good' | 'warn' | 'critical' | 'dim' {
  if (status === 'online') return 'good';
  if (status === 'stopped' || status === 'errored') return 'critical';
  return 'warn';
}

const tooltipStyle = {
  contentStyle: { background: '#1A1A1F', border: '1px solid #3A3A42', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#9B9BA5' },
};

const gridProps = {
  cartesian: { stroke: '#1D1D22', vertical: false as const },
  xAxis: { tick: { fill: '#68686F', fontSize: 10 }, axisLine: { stroke: '#26262C' }, tickLine: false as const, minTickGap: 40 },
  yAxis: { tick: { fill: '#68686F', fontSize: 10 }, axisLine: false as const, tickLine: false as const, width: 36 },
};

export default function SuperAdminTelemetry() {
  const [live, setLive] = useState<LiveTelemetry | null>(null);
  const [history, setHistory] = useState<TelemetrySnapshotEntry[]>([]);
  const [resources, setResources] = useState<LiveResources | null>(null);

  const loadLive = useCallback(async () => {
    try {
      const { data } = await superAdminApi.getLiveTelemetry();
      setLive(data);
    } catch {
      // silent — the live socket feed will populate this shortly after
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const { data } = await superAdminApi.getTelemetryHistory(MAX_HISTORY_POINTS);
      setHistory(data.snapshots);
    } catch {
      toast.error('Failed to load telemetry history');
    }
  }, []);

  const loadResources = useCallback(async () => {
    try {
      const { data } = await superAdminApi.getLiveResources();
      setResources(data);
    } catch {
      // silent — the live socket feed will populate this shortly after
    }
  }, []);

  // One-time fetch for immediate paint; everything after this arrives live
  // over the socket (telemetry-tick / telemetry-snapshot / resources-tick) —
  // no polling.
  useEffect(() => {
    void loadLive();
    void loadHistory();
    void loadResources();
  }, [loadLive, loadHistory, loadResources]);

  useEffect(() => {
    const socket = getRealtimeSocket();

    const handleTick = (payload: LiveTelemetry) => setLive(payload);
    const handleSnapshot = (snapshot: TelemetrySnapshotEntry) => {
      setHistory((prev) => [...prev, snapshot].slice(-MAX_HISTORY_POINTS));
    };
    const handleResourcesTick = (payload: LiveResources) => setResources(payload);

    socket.on('telemetry-tick', handleTick);
    socket.on('telemetry-snapshot', handleSnapshot);
    socket.on('resources-tick', handleResourcesTick);

    return () => {
      socket.off('telemetry-tick', handleTick);
      socket.off('telemetry-snapshot', handleSnapshot);
      socket.off('resources-tick', handleResourcesTick);
    };
  }, []);

  const chartData = history.map((s) => ({
    time: new Date(s.capturedAt).toLocaleTimeString(),
    ping: s.medianPingMs,
    cvP50: s.cvLatencyP50Ms,
    cvP95: s.cvLatencyP95Ms,
    appFps: s.appFps,
    apiP50: s.apiLatencyP50Ms,
    apiP95: s.apiLatencyP95Ms,
  }));

  return (
    <div>
      <PageHeader
        title="Telemetry"
        description="Live health of the platform and the proctoring engine — every number here is measured, not simulated."
      />

      {/* ---- Overall application: is the app itself smooth and responsive? ---- */}
      <h2 className="text-[11px] font-semibold text-sa-accent2 mb-2.5">
        Overall application
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiTile
          label="App frame rate"
          value={fmt(live?.appFps ?? null, ' fps', 1)}
          sub={fpsLabel(live?.appFps ?? null)}
          tone={fpsTone(live?.appFps ?? null)}
        />
        <KpiTile
          label="API latency p50 / p95"
          value={`${fmt(live?.apiLatencyP50Ms ?? null, 'ms')} / ${fmt(live?.apiLatencyP95Ms ?? null, 'ms')}`}
          sub="every admin request, any route"
        />
        <KpiTile
          label="Median ping"
          value={fmt(live?.medianPingMs ?? null, 'ms')}
          sub={live?.medianPingMs === null ? 'no samples yet' : 'socket round-trip'}
          tone={live?.medianPingMs !== null ? 'good' : 'default'}
        />
        <KpiTile
          label="Failed request rate"
          value={fmt(live?.failedRequestRatePct ?? null, '%', 1)}
          tone={live?.failedRequestRatePct && live.failedRequestRatePct > 2 ? 'warn' : 'good'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <Card title="App frame rate — recent history" meta="fps, sampled every 60s">
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="fpsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#A855F7" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#A855F7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps.cartesian} />
                <XAxis dataKey="time" {...gridProps.xAxis} />
                <YAxis {...gridProps.yAxis} domain={[0, 62]} />
                <Tooltip {...tooltipStyle} />
                <Area type="monotone" dataKey="appFps" stroke="#A855F7" strokeWidth={2} fill="url(#fpsFill)" connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState>Collecting samples — check back in a minute.</EmptyState>
          )}
        </Card>

        <Card title="API latency — recent history" meta="ms, p50 / p95">
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="apiFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4E8EFF" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#4E8EFF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps.cartesian} />
                <XAxis dataKey="time" {...gridProps.xAxis} />
                <YAxis {...gridProps.yAxis} />
                <Tooltip {...tooltipStyle} />
                <Area type="monotone" dataKey="apiP95" stroke="#9B9BA5" strokeWidth={1.5} fill="transparent" connectNulls />
                <Area type="monotone" dataKey="apiP50" stroke="#4E8EFF" strokeWidth={2} fill="url(#apiFill)" connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState>Collecting samples — check back in a minute.</EmptyState>
          )}
        </Card>
      </div>

      {/* ---- Proctoring pipeline: candidate-facing camera capture + CV engine ---- */}
      <h2 className="text-[11px] font-semibold text-sa-accent mb-2.5">
        Proctoring pipeline
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiTile label="Active sessions" value={live?.activeSessions ?? '—'} />
        <KpiTile label="Proctoring refresh" value={fmt(live?.refreshFps ?? null, ' fps', 2)} sub="measured, not configured" />
        <KpiTile label="CV latency p50 / p95" value={`${fmt(live?.cvLatencyP50Ms ?? null, 'ms')} / ${fmt(live?.cvLatencyP95Ms ?? null, 'ms')}`} />
      </div>

      {live?.disclaimer && <p className="text-[11.5px] text-sa-ink-faint mb-5 max-w-2xl">{live.disclaimer}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Ping — recent history" meta="ms, sampled every 60s">
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="pingFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4E8EFF" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#4E8EFF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps.cartesian} />
                <XAxis dataKey="time" {...gridProps.xAxis} />
                <YAxis {...gridProps.yAxis} />
                <Tooltip {...tooltipStyle} />
                <Area type="monotone" dataKey="ping" stroke="#4E8EFF" strokeWidth={2} fill="url(#pingFill)" connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState>Collecting samples — check back in a minute.</EmptyState>
          )}
        </Card>

        <Card title="CV engine latency — recent history" meta="ms, p50 / p95">
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="cvFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#A855F7" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#A855F7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps.cartesian} />
                <XAxis dataKey="time" {...gridProps.xAxis} />
                <YAxis {...gridProps.yAxis} />
                <Tooltip {...tooltipStyle} />
                <Area type="monotone" dataKey="cvP95" stroke="#A855F7" strokeWidth={1.5} fill="url(#cvFill)" connectNulls />
                <Area type="monotone" dataKey="cvP50" stroke="#4E8EFF" strokeWidth={2} fill="transparent" connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState>Collecting samples — check back in a minute.</EmptyState>
          )}
        </Card>
      </div>

      {/* ---- System resources: the actual host/process/DB numbers, the same class
           of data PM2's own dashboard shows for these processes ---- */}
      <h2 className="text-[11px] font-semibold text-sa-accent2 mb-2.5 mt-8">
        System resources
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiTile
          label="Host CPU load"
          value={fmt(resources?.host.cpuLoadPct ?? null, '%', 1)}
          sub={`${resources?.host.cpuCores ?? '—'} cores`}
          tone={pctTone(resources?.host.cpuLoadPct ?? null)}
        />
        <KpiTile
          label="Host memory"
          value={fmt(resources?.host.memUsedPct ?? null, '%', 1)}
          sub={`${fmtBytes(resources?.host.memUsedBytes)} / ${fmtBytes(resources?.host.memTotalBytes)}`}
          tone={pctTone(resources?.host.memUsedPct ?? null)}
        />
        <KpiTile
          label="Disk used"
          value={fmt(resources?.host.diskUsedPct ?? null, '%', 1)}
          sub={resources?.host.diskTotalBytes ? `${fmtBytes(resources.host.diskUsedBytes)} / ${fmtBytes(resources.host.diskTotalBytes)}` : 'not available on this host'}
          tone={pctTone(resources?.host.diskUsedPct ?? null)}
        />
        <KpiTile
          label="DB connections"
          value={resources?.dbPool ? resources.dbPool.activeConnections : '—'}
          sub="active, this database"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiTile label="Pending account deletions" value={resources?.backlog.pendingAdminDeletions ?? '—'} sub="scheduled, awaiting grace period" />
        <KpiTile label="Host uptime" value={resources ? fmtUptime(resources.host.uptimeSec * 1000) : '—'} />
      </div>

      <Card title="PM2 processes" meta="cpu / memory / restarts, live">
        {resources?.processes && resources.processes.length > 0 ? (
          <div className="flex flex-col">
            <div className="grid grid-cols-[1.5fr_repeat(4,1fr)] gap-2 text-[11px] text-sa-ink-faint px-1 pb-2">
              <span>Process</span>
              <span>Status</span>
              <span>CPU</span>
              <span>Memory</span>
              <span>Restarts</span>
            </div>
            {resources.processes.map((p) => (
              <div
                key={p.pmId}
                className="grid grid-cols-[1.5fr_repeat(4,1fr)] gap-2 items-center py-2 border-b border-sa-line-soft last:border-0"
              >
                <span className="text-[13px] text-sa-ink truncate">{p.name}</span>
                <StatusPill tone={processStatusTone(p.status)}>{p.status}</StatusPill>
                <span className="text-[13px] text-sa-ink-dim tabular-nums">{p.cpuPct.toFixed(0)}%</span>
                <span className="text-[13px] text-sa-ink-dim tabular-nums">{fmtBytes(p.memBytes)}</span>
                <span className="text-[13px] text-sa-ink-dim tabular-nums">{p.restarts}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>
            {resources ? 'PM2 not reachable from this process — not running under PM2, or the CLI is unavailable.' : 'Collecting…'}
          </EmptyState>
        )}
      </Card>
    </div>
  );
}
