import { useEffect, useState, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { toast } from 'react-hot-toast';
import { superAdminApi, type LiveTelemetry, type TelemetrySnapshotEntry } from '../../services/superAdminApi';
import { getRealtimeSocket } from '../../services/realtimeService';
import { Card, KpiTile, PageHeader, EmptyState } from './components';

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

  // One-time fetch for immediate paint; everything after this arrives live
  // over the socket (telemetry-tick / telemetry-snapshot) — no polling.
  useEffect(() => {
    void loadLive();
    void loadHistory();
  }, [loadLive, loadHistory]);

  useEffect(() => {
    const socket = getRealtimeSocket();

    const handleTick = (payload: LiveTelemetry) => setLive(payload);
    const handleSnapshot = (snapshot: TelemetrySnapshotEntry) => {
      setHistory((prev) => [...prev, snapshot].slice(-MAX_HISTORY_POINTS));
    };

    socket.on('telemetry-tick', handleTick);
    socket.on('telemetry-snapshot', handleSnapshot);

    return () => {
      socket.off('telemetry-tick', handleTick);
      socket.off('telemetry-snapshot', handleSnapshot);
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
    </div>
  );
}
