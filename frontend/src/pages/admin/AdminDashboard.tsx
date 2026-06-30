import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { format } from 'date-fns';
import { Sparkles, ClipboardCheck, Activity, Users, Database, ChevronRight } from 'lucide-react';
import Icon from '../../components/Icon';

interface DashboardStats {
  totalTests: number;
  activeTests: number;
  totalAttempts: number;
  totalQuestions: number;
}

interface RecentAttempt {
  id: string;
  startTime: string;
  status: string;
  score?: number;
  candidate: { name: string; email: string };
  test: { name: string };
}

const AVATAR_COLORS = [
  '#8B5CF6', '#7C3AED', '#EF4444', 'var(--admin-accent)', '#F97316',
  'var(--admin-accent)', '#EC4899', 'var(--admin-data-blue)', '#84CC16', 'var(--admin-accent)',
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

function WeeklyBarChart({ data }: { data: { label: string; value: number }[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="flex items-end gap-2 mt-4" style={{ height: '140px' }}>
      {data.map((day, i) => {
        const barPct = (day.value / max) * 80;
        return (
          <div
            key={day.label}
            className="flex flex-col items-center justify-end flex-1 gap-1 h-full"
            style={{ position: 'relative' }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            {hovered === i && (
              <div style={{
                position: 'absolute',
                bottom: `calc(${barPct}% + 34px)`,
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'var(--admin-text)',
                color: 'white',
                borderRadius: '6px',
                padding: '5px 10px',
                fontSize: '11px',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                zIndex: 20,
                pointerEvents: 'none',
                lineHeight: 1.5,
              }}>
                <div style={{ textAlign: 'center' }}>{day.label}</div>
                <div style={{ textAlign: 'center', color: 'var(--admin-accent-disabled)' }}>{day.value} attempt{day.value !== 1 ? 's' : ''}</div>
                <div style={{
                  position: 'absolute', bottom: '-5px', left: '50%',
                  transform: 'translateX(-50%)', width: 0, height: 0,
                  borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
                  borderTop: '5px solid var(--admin-text)',
                }} />
              </div>
            )}
            <div
              className="w-full rounded-t-md"
              style={{
                height: `${barPct}%`,
                backgroundColor: hovered === i ? 'var(--admin-accent-hover)' : 'var(--admin-accent)',
                minHeight: '4px',
                transition: 'background-color 0.1s',
                cursor: 'default',
              }}
            />
            <span className="text-xs" style={{ color: 'var(--admin-text-subtle)' }}>{day.label}</span>
            <span className="text-[10px]" style={{ color: '#D1D5DB' }}>{day.value}</span>
          </div>
        );
      })}
    </div>
  );
}

function IntegrityDonut({ percentage, clean, flagged }: { percentage: number; clean: number; flagged: number }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const r = 40;
  const circumference = 2 * Math.PI * r;
  const dash = (Math.min(percentage, 100) / 100) * circumference;
  const strokeColor = percentage >= 80 ? 'var(--admin-accent)' : percentage >= 50 ? '#F97316' : '#EF4444';
  const trackColor  = percentage >= 80 ? 'var(--admin-accent-disabled)' : percentage >= 50 ? '#FFF7ED' : '#FEF2F2';
  const total = clean + flagged;
  const cleanPct = total > 0 ? Math.round((clean / total) * 100) : 0;
  const flaggedPct = total > 0 ? Math.round((flagged / total) * 100) : 0;
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ cursor: 'default' }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {showTooltip && (
        <div style={{
          position: 'absolute',
          bottom: '110px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'var(--admin-text)',
          color: 'white',
          borderRadius: '8px',
          padding: '10px 14px',
          fontSize: '11px',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          zIndex: 20,
          pointerEvents: 'none',
          lineHeight: '1.7',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          <div style={{ fontWeight: 700, marginBottom: '4px', color: 'var(--admin-border)' }}>Integrity Breakdown</div>
          <div><span style={{ color: 'var(--admin-accent)' }}>?</span> Clean: {clean.toLocaleString()} ({cleanPct}%)</div>
          <div><span style={{ color: '#F87171' }}>?</span> Flagged: {flagged.toLocaleString()} ({flaggedPct}%)</div>
          <div style={{ borderTop: '1px solid var(--admin-text-muted)', marginTop: '5px', paddingTop: '5px' }}>
            Avg Trust Score: <span style={{ color: 'var(--admin-accent-disabled)', fontWeight: 700 }}>{percentage}%</span>
          </div>
          <div style={{
            position: 'absolute', bottom: '-5px', left: '50%',
            transform: 'translateX(-50%)', width: 0, height: 0,
            borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
            borderTop: '5px solid var(--admin-text)',
          }} />
        </div>
      )}
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke={trackColor} strokeWidth="9" strokeLinecap="butt"/>
        <circle
          cx="50" cy="50" r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth="9"
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="butt"
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-xl font-bold" style={{ color: 'var(--admin-text)' }}>{percentage}%</div>
        <div className="text-[9px] font-medium" style={{ color: 'var(--admin-text-subtle)' }}>AVG TRUST</div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; dot: string; label: string; pulse?: boolean }> = {
    submitted:      { bg: 'var(--admin-accent-soft)', color: 'var(--admin-accent-hover)', dot: 'var(--admin-accent)', label: 'Submitted' },
    auto_submitted: { bg: '#FFF7ED', color: '#C2410C', dot: '#F97316', label: 'Auto-submitted' },
    in_progress:    { bg: 'var(--admin-accent-soft)', color: 'var(--admin-accent-hover)', dot: 'var(--admin-accent)', label: 'In progress', pulse: true },
    flagged:        { bg: '#FFF1F2', color: '#DC2626', dot: '#EF4444', label: 'Flagged', pulse: true },
  };
  const c = config[status] ?? config.submitted;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1"
      style={{ backgroundColor: c.bg, color: c.color }}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full flex-shrink-0${c.pulse ? ' animate-pulse-dot' : ''}`}
        style={{ backgroundColor: c.dot }}
      />
      {c.label}
    </span>
  );
}

const DEFAULT_WEEK: { label: string; value: number }[] = [
  'Sun','Mon','Tue','Wed','Thu','Fri','Sat'
].map(label => ({ label, value: 0 }));

const headerActionStyle: React.CSSProperties = {
  width: '132px',
  justifyContent: 'center',
};

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentAttempts, setRecentAttempts] = useState<RecentAttempt[]>([]);
  const [weeklyData, setWeeklyData] = useState<{ label: string; value: number }[]>(DEFAULT_WEEK);
  const [integrity, setIntegrity] = useState({ flagged: 0, clean: 0, avgTrustScore: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadDashboard(); }, []);

  const loadDashboard = async () => {
    try {
      const { data } = await adminApi.getDashboard();
      setStats(data.stats);
      const attempts: RecentAttempt[] = data.recentAttempts ?? [];
      setRecentAttempts(attempts);

      if (data.weeklyAttempts?.length) {
        setWeeklyData(data.weeklyAttempts);
      } else {
        // Fallback: bucket recentAttempts by day-of-week for the last 7 days
        const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const now = Date.now();
        const fallback = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(now - (6 - i) * 86_400_000);
          const dayStart = new Date(d); dayStart.setHours(0,0,0,0);
          const dayEnd   = new Date(d); dayEnd.setHours(23,59,59,999);
          const value = attempts.filter(a => {
            const t = new Date(a.startTime).getTime();
            return t >= dayStart.getTime() && t <= dayEnd.getTime();
          }).length;
          return { label: DAY_LABELS[d.getDay()], value };
        });
        if (fallback.some(d => d.value > 0)) setWeeklyData(fallback);
      }

      if (data.integrityStats) setIntegrity(data.integrityStats);
    } catch {
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  const today = new Date();
  const dateLabel = format(today, "EEEE, d MMMM yyyy");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: 'var(--admin-accent)' }} />
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: 'var(--admin-bg)', margin: '-24px', padding: '24px', minHeight: 'calc(100vh - 52px)' }}>

      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--admin-text)', margin: 0 }}>Dashboard</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--admin-text-muted)' }}>
            {dateLabel} - Here's what's happening across your assessments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/admin/tests/agent"
            className="btn btn-secondary"
            style={headerActionStyle}
          >
            <Sparkles size={13} />
            AI Generate
          </Link>
          <Link
            to="/admin/tests/new"
            className="btn btn-primary"
            style={headerActionStyle}
          >
            + Create Test
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">

        {/* Total Tests */}
        <Link to="/admin/tests" className="stat-card block rounded-xl p-5" style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', textDecoration: 'none' }}>
          <div className="flex items-start justify-between">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--admin-accent-soft)' }}>
              <ClipboardCheck size={18} color="var(--admin-accent-hover)" />
            </div>
          </div>
          <div className="mt-4">
            <p className="text-3xl font-bold" style={{ color: 'var(--admin-text)' }}>{stats?.totalTests ?? 0}</p>
            <p className="text-sm mt-1" style={{ color: 'var(--admin-text-muted)' }}>Total assessments</p>
          </div>
        </Link>

        {/* Active Tests */}
        <Link to="/admin/tests" className="stat-card block rounded-xl p-5" style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', textDecoration: 'none' }}>
          <div className="flex items-start justify-between">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--admin-accent-soft)' }}>
              <Activity size={18} color="var(--admin-accent-hover)" />
            </div>
          </div>
          <div className="mt-4">
            <p className="text-3xl font-bold" style={{ color: 'var(--admin-text)' }}>{stats?.activeTests ?? 0}</p>
            <p className="text-sm mt-1" style={{ color: 'var(--admin-text-muted)' }}>Active assessments</p>
          </div>
        </Link>

        {/* Total Attempts */}
        <Link to="/admin/analytics" className="stat-card block rounded-xl p-5" style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', textDecoration: 'none' }}>
          <div className="flex items-start justify-between">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--admin-accent-soft)' }}>
              <Users size={18} color="var(--admin-accent-hover)" />
            </div>
          </div>
          <div className="mt-4">
            <p className="text-3xl font-bold" style={{ color: 'var(--admin-text)' }}>{(stats?.totalAttempts ?? 0).toLocaleString()}</p>
            <p className="text-sm mt-1" style={{ color: 'var(--admin-text-muted)' }}>Total attempts</p>
          </div>
        </Link>

        {/* Question Library */}
        <Link to="/admin/repository/question-bank" className="stat-card block rounded-xl p-5" style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', textDecoration: 'none' }}>
          <div className="flex items-start justify-between">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--admin-accent-soft)' }}>
              <Database size={18} color="var(--admin-accent-hover)" />
            </div>
          </div>
          <div className="mt-4">
            <p className="text-3xl font-bold" style={{ color: 'var(--admin-text)' }}>{stats?.totalQuestions ?? 0}</p>
            <p className="text-sm mt-1" style={{ color: 'var(--admin-text-muted)' }}>Question library</p>
          </div>
        </Link>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">

        {/* Attempts this week */}
        <div
          className="lg:col-span-2 rounded-xl p-5"
          style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}
        >
          <div className="flex items-start justify-between">
            <div>
              <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--admin-text)', margin: 0 }}>Attempts this week</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--admin-text-subtle)' }}>Daily completed attempts</p>
            </div>
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1"
              style={{ backgroundColor: 'var(--admin-accent-disabled)', color: 'var(--admin-accent-hover)' }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--admin-accent)' }} />
              Live
            </span>
          </div>
          <WeeklyBarChart data={weeklyData} />
        </div>

        {/* Integrity Health */}
        <div
          className="rounded-xl p-5 flex flex-col"
          style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}
        >
          <div className="flex items-center justify-between mb-3">
            <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--admin-text)', margin: 0 }}>Integrity health</p>
            <Icon name="integrity-health" size={20} />
          </div>
          <div className="flex justify-center my-2">
            <IntegrityDonut percentage={integrity.avgTrustScore} clean={integrity.clean} flagged={integrity.flagged} />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--admin-accent-soft)' }}>
              <p className="font-bold text-lg" style={{ color: 'var(--admin-accent-hover)' }}>{integrity.clean.toLocaleString()}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--admin-text-muted)' }}>Clean</p>
            </div>
            <div className="rounded-xl p-3 text-center" style={{ backgroundColor: '#FFF7ED' }}>
              <p className="font-bold text-lg" style={{ color: '#EF4444' }}>{integrity.flagged}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--admin-text-muted)' }}>Flagged</p>
            </div>
          </div>
          {/* View trust reports ? /admin/trust-reports */}
          <Link
            to="/admin/trust-reports"
            className="inline-flex items-center gap-1 text-sm font-medium mt-4"
            style={{ color: 'var(--admin-accent)' }}
          >
            View trust reports <ChevronRight size={14} />
          </Link>
        </div>
      </div>

      {/* Recent Attempts */}
      <div
        className="rounded-xl p-5"
        style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--admin-text)', margin: 0 }}>Recent attempts</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--admin-text-subtle)' }}>Latest candidate submissions across all tests</p>
          </div>
          <Link to="/admin/all-attempts" className="text-sm font-medium" style={{ color: 'var(--admin-accent)' }}>
            <span className="inline-flex items-center gap-1">View all <ChevronRight size={14} /></span>
          </Link>
        </div>

        {recentAttempts.length === 0 ? (
          <p className="text-sm py-4" style={{ color: 'var(--admin-text-muted)' }}>No attempts yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--admin-border)' }}>
                  {['CANDIDATE', 'TEST', 'WHEN', 'STATUS', 'SCORE', ''].map((h, i) => (
                    <th
                      key={i}
                      className="pb-3 text-left text-xs font-semibold tracking-wider"
                      style={{ color: 'var(--admin-text-subtle)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentAttempts.map((attempt) => (
                  <tr key={attempt.id} style={{ borderBottom: '1px solid #F9FAFB' }}>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                          style={{ backgroundColor: getAvatarColor(attempt.candidate.name) }}
                        >
                          {getInitials(attempt.candidate.name)}
                        </div>
                        <p className="text-sm font-medium whitespace-nowrap" style={{ color: 'var(--admin-text)' }}>
                          {attempt.candidate.name}
                        </p>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <p className="text-sm whitespace-nowrap" style={{ color: 'var(--admin-text-muted)' }}>{attempt.test.name}</p>
                    </td>
                    <td className="py-3 pr-4">
                      <p className="text-sm whitespace-nowrap" style={{ color: 'var(--admin-text-muted)' }}>
                        {format(new Date(attempt.startTime), 'MMM d, h:mm a')}
                      </p>
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={attempt.status} />
                    </td>
                    <td className="py-3 pr-4">
                      <p className="text-sm font-medium" style={{ color: 'var(--admin-text)' }}>
                        {attempt.score != null ? `${attempt.score}%` : '-'}
                      </p>
                    </td>
                    {/* Individual attempt ? /admin/attempts/:id */}
                    <td className="py-3">
                      <Link
                        to={`/admin/attempts/${attempt.id}`}
                        className="flex items-center justify-center h-7 w-7 rounded-full transition-colors"
                        style={{ backgroundColor: '#F9FAFB' }}
                      >
                        <ChevronRight size={13} color="var(--admin-text-subtle)" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
