import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutGrid,
  Eye,
  Users,
  History,
  Lock,
  Activity,
  LogOut,
  Radio,
  Sparkles,
  CreditCard,
  ShieldCheck,
  BellRing,
  HardDrive,
  Building2,
  Webhook,
} from 'lucide-react';
import { useSuperAdminStore } from '../context/superAdminStore';
import { useSuperAdminRealtimeStore, type StreamEntry } from '../context/superAdminRealtimeStore';
import { getRealtimeSocket } from '../services/realtimeService';
import { superAdminApi, type LiveTelemetry, type LiveResources, type TelemetrySnapshotEntry } from '../services/superAdminApi';
import regenLogo from '../assets/regen-logo.png';

const navItems = [
  { path: '/superadmin/overview', label: 'Overview', icon: LayoutGrid },
  { path: '/superadmin/live-monitor', label: 'Live Monitor', icon: Eye },
  { path: '/superadmin/accounts', label: 'Accounts', icon: Users },
  { path: '/superadmin/companies', label: 'Companies', icon: Building2 },
  { path: '/superadmin/audit-log', label: 'Audit Log', icon: History },
  { path: '/superadmin/feature-locks', label: 'Feature Locks', icon: Lock },
  { path: '/superadmin/billing', label: 'Billing', icon: CreditCard },
  { path: '/superadmin/storage', label: 'Storage', icon: HardDrive },
  { path: '/superadmin/webhooks', label: 'Webhooks', icon: Webhook },
  { path: '/superadmin/telemetry', label: 'Telemetry', icon: Activity },
  { path: '/superadmin/security', label: 'Security', icon: ShieldCheck },
  { path: '/superadmin/alerts', label: 'Alerts', icon: BellRing },
  { path: '/superadmin/ai-assistant', label: 'AI Assistant', icon: Sparkles },
];

export default function SuperAdminLayout() {
  const { superAdmin, logout } = useSuperAdminStore();
  const navigate = useNavigate();
  const [joined, setJoined] = useState(false);
  const {
    setLive,
    setHistory,
    appendHistorySnapshot,
    setResources,
    setOnlineAdminIds,
    markAdminOnline,
    markAdminOffline,
    pushStreamEntry,
  } = useSuperAdminRealtimeStore();

  useEffect(() => {
    const token = localStorage.getItem('superAdminToken');
    if (!token) return;

    const socket = getRealtimeSocket();
    const handleAccepted = () => setJoined(true);
    const handleRejected = () => setJoined(false);

    socket.on('superadmin-join-accepted', handleAccepted);
    socket.on('superadmin-join-rejected', handleRejected);
    socket.emit('superadmin-join', token);

    return () => {
      socket.off('superadmin-join-accepted', handleAccepted);
      socket.off('superadmin-join-rejected', handleRejected);
    };
  }, []);

  // Everything below is attached once, here, rather than inside the
  // individual pages that display it — this component stays mounted for the
  // whole authenticated session (React Router keeps a route's parent layout
  // alive across its child routes), so telemetry/resources/activity keep
  // accumulating in the store no matter which section is currently open.
  useEffect(() => {
    superAdminApi.getLiveTelemetry().then(({ data }) => setLive(data)).catch(() => {});
    superAdminApi.getTelemetryHistory(120).then(({ data }) => setHistory(data.snapshots)).catch(() => {});
    superAdminApi.getLiveResources().then(({ data }) => setResources(data)).catch(() => {});
    superAdminApi
      .listAccounts()
      .then(({ data }) => {
        setOnlineAdminIds(new Set(data.admins.filter((a) => a.status === 'online').map((a) => a.id)));
      })
      .catch(() => {});

    const socket = getRealtimeSocket();

    const handleTelemetryTick = (payload: LiveTelemetry) => setLive(payload);
    const handleTelemetrySnapshot = (snapshot: TelemetrySnapshotEntry) => appendHistorySnapshot(snapshot);
    const handleResourcesTick = (payload: LiveResources) => setResources(payload);
    const handleAdminOnline = (payload: { adminId: string }) => markAdminOnline(payload.adminId);
    const handleAdminOffline = (payload: { adminId: string }) => markAdminOffline(payload.adminId);
    const handleAdminAction = (row: { id: string; createdAt: string; adminEmail: string; method: string; path: string; statusCode: number }) => {
      pushStreamEntry({
        id: row.id,
        time: row.createdAt,
        adminEmail: row.adminEmail,
        kind: 'action',
        detail: `${row.method} ${row.path} · ${row.statusCode}`,
      });
    };
    const handleAdminClickBatch = (payload: {
      adminEmail: string;
      events: Array<{ id?: string; eventType: string; targetLabel?: string; route?: string; clientTimestamp: string }>;
    }) => {
      payload.events.forEach((e, i) => {
        const entry: StreamEntry = {
          id: `${payload.adminEmail}-${e.clientTimestamp}-${i}`,
          time: e.clientTimestamp,
          adminEmail: payload.adminEmail,
          kind: 'click',
          detail: `clicked "${e.targetLabel || 'unknown'}" on ${e.route || ''}`,
        };
        pushStreamEntry(entry);
      });
    };

    socket.on('telemetry-tick', handleTelemetryTick);
    socket.on('telemetry-snapshot', handleTelemetrySnapshot);
    socket.on('resources-tick', handleResourcesTick);
    socket.on('admin-online', handleAdminOnline);
    socket.on('admin-offline', handleAdminOffline);
    socket.on('admin-action', handleAdminAction);
    socket.on('admin-click-batch', handleAdminClickBatch);

    return () => {
      socket.off('telemetry-tick', handleTelemetryTick);
      socket.off('telemetry-snapshot', handleTelemetrySnapshot);
      socket.off('resources-tick', handleResourcesTick);
      socket.off('admin-online', handleAdminOnline);
      socket.off('admin-offline', handleAdminOffline);
      socket.off('admin-action', handleAdminAction);
      socket.off('admin-click-batch', handleAdminClickBatch);
    };
  }, [appendHistorySnapshot, markAdminOffline, markAdminOnline, pushStreamEntry, setHistory, setLive, setOnlineAdminIds, setResources]);

  const handleLogout = () => {
    logout();
    navigate('/superadmin/login');
  };

  return (
    <div className="min-h-screen bg-sa-void text-sa-ink font-sans flex">
      <aside className="w-60 shrink-0 border-r border-sa-line bg-sa-panel-inset flex flex-col">
        <div className="px-5 py-5">
          <div className="inline-flex bg-white rounded-lg p-1.5">
            <img src={regenLogo} alt="ReGen" className="h-9 w-auto" />
          </div>
        </div>
        <nav className="flex-1 px-3 py-2 flex flex-col gap-0.5 overflow-y-auto">
          {navItems.map(({ path, label, icon: ItemIcon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors ${
                  isActive
                    ? 'bg-sa-panel-raised text-sa-ink'
                    : 'text-sa-ink-dim hover:text-sa-ink hover:bg-sa-panel-raised/60'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <ItemIcon size={16} className={isActive ? 'text-sa-accent' : 'text-sa-ink-faint'} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-3 border-t border-sa-line-soft flex items-center gap-2.5">
          <span className="h-8 w-8 shrink-0 rounded-full bg-sa-panel-raised border border-sa-line flex items-center justify-center text-xs font-semibold text-sa-ink-dim">
            {superAdmin?.name?.[0]?.toUpperCase() ?? 'A'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-sa-ink truncate leading-tight">{superAdmin?.name}</p>
            <p className="text-[11.5px] text-sa-ink-faint truncate leading-tight">{superAdmin?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            title="Log out"
            className="shrink-0 rounded-lg p-1.5 text-sa-ink-faint hover:text-sa-critical hover:bg-sa-critical-soft transition-colors"
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 border-b border-sa-line bg-gradient-to-r from-sa-panel-inset via-sa-panel-inset to-sa-panel-raised/50 flex items-center justify-between px-6">
          <span className="text-lg font-bold text-sa-ink">
            Superadmin Console
          </span>
          <span
            className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
              joined
                ? 'text-sa-good bg-sa-good-soft border-sa-good/40 shadow-[0_0_14px_2px_rgba(34,197,94,0.55)]'
                : 'text-sa-ink-faint bg-sa-panel-raised border-transparent'
            }`}
          >
            <Radio size={11} className={joined ? 'animate-pulse' : ''} />
            {joined ? 'Ghost mode active' : 'Connecting…'}
          </span>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
