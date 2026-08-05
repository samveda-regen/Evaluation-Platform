import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users, Eye, Lock, AlertTriangle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  superAdminApi,
  type AdminAccountSummary,
  type AdminActionLogEntry,
  type LiveTelemetry,
  type FeatureFlag,
  type OverviewTrends,
} from '../../services/superAdminApi';
import { getRealtimeSocket } from '../../services/realtimeService';
import { Card, StatCard, EmptyState, PageHeader, StatusPill } from './components';

const tooltipStyle = {
  contentStyle: { background: '#1A1A1F', border: '1px solid #3A3A42', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#9B9BA5' },
};
const gridProps = {
  cartesian: { stroke: '#1D1D22', vertical: false as const },
  xAxis: { tick: { fill: '#68686F', fontSize: 10 }, axisLine: { stroke: '#26262C' }, tickLine: false as const, minTickGap: 30 },
  yAxis: { tick: { fill: '#68686F', fontSize: 10 }, axisLine: false as const, tickLine: false as const, width: 28 },
};

export default function SuperAdminOverview() {
  const [admins, setAdmins] = useState<AdminAccountSummary[]>([]);
  const [recentActions, setRecentActions] = useState<AdminActionLogEntry[]>([]);
  const [live, setLive] = useState<LiveTelemetry | null>(null);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [trends, setTrends] = useState<OverviewTrends | null>(null);

  const load = useCallback(async () => {
    const [accountsRes, actionsRes, telemetryRes, flagsRes, trendsRes] = await Promise.allSettled([
      superAdminApi.listAccounts(),
      superAdminApi.getActionLog({ limit: 8 }),
      superAdminApi.getLiveTelemetry(),
      superAdminApi.listFeatureFlags(),
      superAdminApi.getOverviewTrends(30),
    ]);
    if (accountsRes.status === 'fulfilled') setAdmins(accountsRes.value.data.admins);
    if (actionsRes.status === 'fulfilled') setRecentActions(actionsRes.value.data.entries);
    if (telemetryRes.status === 'fulfilled') setLive(telemetryRes.value.data);
    if (flagsRes.status === 'fulfilled') setFlags(flagsRes.value.data.flags);
    if (trendsRes.status === 'fulfilled') setTrends(trendsRes.value.data);
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 15000);
    const socket = getRealtimeSocket();
    const onAction = () => void load();
    socket.on('admin-action', onAction);
    return () => {
      clearInterval(interval);
      socket.off('admin-action', onAction);
    };
  }, [load]);

  const onlineCount = admins.filter((a) => a.status === 'online').length;
  const lockedFlags = flags.filter((f) => !f.enabled);
  const failedRate = live?.failedRequestRatePct ?? 0;

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Headline numbers across the whole platform, updated live."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="Admins online" value={onlineCount} sub={`of ${admins.length} total`} icon={Users} tone="default" />
        <StatCard label="Active proctoring sessions" value={live?.activeSessions ?? '—'} icon={Eye} tone="good" />
        <StatCard
          label="Locked features"
          value={lockedFlags.length}
          sub={lockedFlags.length > 0 ? lockedFlags.map((f) => f.label).join(', ') : 'none locked'}
          icon={Lock}
          tone={lockedFlags.length > 0 ? 'warn' : 'good'}
        />
        <StatCard
          label="Failed request rate"
          value={live ? `${failedRate.toFixed(1)}%` : '—'}
          icon={AlertTriangle}
          tone={failedRate > 2 ? 'critical' : 'good'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Recent admin activity" meta={<Link to="/superadmin/audit-log" className="text-sa-accent">view all</Link>}>
          <div className="flex flex-col">
            {recentActions.map((row) => (
              <div key={row.id} className="flex items-center gap-2.5 py-1.5 border-b border-sa-line-soft last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-sa-ink truncate">{row.adminEmail}</div>
                  <div className="text-[12px] text-sa-ink-faint truncate">{row.method} {row.path}</div>
                </div>
                <StatusPill tone={row.statusCode >= 500 ? 'critical' : row.statusCode >= 400 ? 'warn' : 'good'}>
                  {row.statusCode}
                </StatusPill>
              </div>
            ))}
            {recentActions.length === 0 && <EmptyState>No activity yet.</EmptyState>}
          </div>
        </Card>

        <Card title="Accounts" meta={<Link to="/superadmin/accounts" className="text-sa-accent">manage</Link>}>
          <div className="flex flex-col">
            {admins.slice(0, 8).map((a) => (
              <div key={a.id} className="flex items-center gap-2.5 py-1.5 border-b border-sa-line-soft last:border-0">
                <span className={`h-1.5 w-1.5 rounded-full ${a.status === 'online' ? 'bg-sa-good' : 'bg-sa-ink-faint'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-sa-ink truncate">{a.name}</div>
                  <div className="text-[11.5px] text-sa-ink-faint truncate">{a.email}</div>
                </div>
                <span className="text-[12px] text-sa-ink-faint shrink-0">{a.ownedContent.tests} tests</span>
              </div>
            ))}
            {admins.length === 0 && <EmptyState>No admin accounts yet.</EmptyState>}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card title="Active admins per day" meta="last 30 days">
          {trends && trends.activeAdminsPerDay.length > 1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={trends.activeAdminsPerDay}>
                <defs>
                  <linearGradient id="activeAdminsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4E8EFF" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#4E8EFF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps.cartesian} />
                <XAxis dataKey="date" {...gridProps.xAxis} tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
                <YAxis allowDecimals={false} {...gridProps.yAxis} />
                <Tooltip {...tooltipStyle} />
                <Area type="monotone" dataKey="activeAdmins" stroke="#4E8EFF" strokeWidth={2} fill="url(#activeAdminsFill)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState>Not enough data yet.</EmptyState>
          )}
        </Card>

        <Card title="Tests created per week" meta="last ~30 days">
          {trends && trends.testsCreatedPerWeek.length > 1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={trends.testsCreatedPerWeek}>
                <defs>
                  <linearGradient id="testsPerWeekFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#A855F7" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#A855F7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps.cartesian} />
                <XAxis dataKey="weekStart" {...gridProps.xAxis} tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
                <YAxis allowDecimals={false} {...gridProps.yAxis} />
                <Tooltip {...tooltipStyle} />
                <Area type="monotone" dataKey="count" stroke="#A855F7" strokeWidth={2} fill="url(#testsPerWeekFill)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState>Not enough data yet.</EmptyState>
          )}
        </Card>
      </div>
    </div>
  );
}
