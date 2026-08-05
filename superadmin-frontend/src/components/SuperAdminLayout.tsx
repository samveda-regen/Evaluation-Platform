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
import regenLogo from '../assets/regen-logo.png';

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
    <div className="min-h-screen bg-sa-void text-sa-ink font-sans flex">
      <aside className="w-60 shrink-0 border-r border-sa-line bg-sa-panel-inset flex flex-col">
        <div className="px-5 py-5">
          <img src={regenLogo} alt="ReGen" className="h-10 w-auto" />
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
        <header className="h-14 shrink-0 border-b border-sa-line bg-sa-panel-inset/60 flex items-center justify-between px-6">
          <span className="text-sm text-sa-ink-dim">Superadmin console</span>
          <span
            className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
              joined
                ? 'text-sa-accent2 bg-sa-accent2-soft'
                : 'text-sa-ink-faint bg-sa-panel-raised'
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
