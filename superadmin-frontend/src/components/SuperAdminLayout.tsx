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
} from 'lucide-react';
import { useSuperAdminStore } from '../context/superAdminStore';
import { getRealtimeSocket } from '../services/realtimeService';

const navItems = [
  { path: '/superadmin/overview', label: 'Overview', icon: LayoutGrid },
  { path: '/superadmin/live-monitor', label: 'Live Monitor', icon: Eye },
  { path: '/superadmin/accounts', label: 'Accounts', icon: Users },
  { path: '/superadmin/audit-log', label: 'Audit Log', icon: History },
  { path: '/superadmin/feature-locks', label: 'Feature Locks', icon: Lock },
  { path: '/superadmin/billing', label: 'Billing', icon: CreditCard },
  { path: '/superadmin/telemetry', label: 'Telemetry', icon: Activity },
  { path: '/superadmin/security', label: 'Security', icon: ShieldCheck },
  { path: '/superadmin/alerts', label: 'Alerts', icon: BellRing },
  { path: '/superadmin/ai-assistant', label: 'AI Assistant', icon: Sparkles },
];

export default function SuperAdminLayout() {
  const { superAdmin, logout } = useSuperAdminStore();
  const navigate = useNavigate();
  const [joined, setJoined] = useState(false);

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

  const handleLogout = () => {
    logout();
    navigate('/superadmin/login');
  };

  return (
    <div
      className="min-h-screen bg-sa-void text-sa-ink font-sans flex relative"
      style={{
        backgroundImage:
          'linear-gradient(rgba(0,240,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(0,240,255,0.035) 1px, transparent 1px)',
        backgroundSize: '38px 38px',
      }}
    >
      <div
        className="pointer-events-none fixed inset-0 opacity-70"
        style={{ background: 'radial-gradient(900px 500px at 8% -8%, rgba(0,240,255,0.08), transparent 60%)' }}
      />

      <aside className="w-56 shrink-0 border-r border-sa-line bg-sa-panel-inset/90 backdrop-blur-sm flex flex-col relative z-10">
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-sa-line-soft">
          <span className="h-2.5 w-2.5 bg-sa-accent shadow-glow-cyan-sm rotate-45" />
          <span className="font-mono text-xs tracking-[0.22em] uppercase text-sa-ink [text-shadow:0_0_12px_rgba(0,240,255,0.4)]">
            Observer
          </span>
        </div>
        <nav className="flex-1 px-3 py-3 flex flex-col gap-1">
          {navItems.map(({ path, label, icon: ItemIcon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                `group flex items-center gap-2.5 rounded-sm px-3 py-2 text-[13px] font-mono tracking-wide border-l-2 transition-all ${
                  isActive
                    ? 'border-sa-accent bg-sa-accent-soft text-sa-ink shadow-[inset_0_0_20px_rgba(0,240,255,0.08)]'
                    : 'border-transparent text-sa-ink-dim hover:text-sa-ink hover:bg-sa-panel hover:border-sa-line-bright'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <ItemIcon size={15} className={isActive ? 'text-sa-accent drop-shadow-[0_0_6px_rgba(0,240,255,0.8)]' : ''} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-sa-line-soft flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-sa-ink truncate font-mono">{superAdmin?.name}</p>
            <p className="text-[11px] text-sa-ink-faint truncate">{superAdmin?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            title="Log out"
            className="shrink-0 rounded-sm p-1.5 text-sa-ink-faint hover:text-sa-critical hover:bg-sa-critical-soft hover:shadow-glow-red transition-all"
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <header className="h-14 border-b border-sa-line bg-sa-panel-raised/80 backdrop-blur-sm flex items-center justify-between px-6">
          <span className="text-xs text-sa-ink-faint font-mono tracking-wide">SUPERADMIN_OBSERVER // console</span>
          <span
            className={`flex items-center gap-2 font-mono text-[10.5px] tracking-[0.1em] uppercase px-3 py-1.5 rounded-full border transition-all ${
              joined
                ? 'text-sa-accent2 bg-sa-accent2-soft border-sa-accent2/50 shadow-glow-magenta'
                : 'text-sa-ink-faint bg-sa-panel-inset border-sa-line'
            }`}
          >
            <Radio size={11} className={joined ? 'animate-pulse' : ''} />
            {joined ? 'Ghost Mode Active' : 'Connecting…'}
          </span>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
