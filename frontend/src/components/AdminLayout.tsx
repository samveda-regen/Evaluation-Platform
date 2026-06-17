import { useEffect, useRef, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../context/authStore';
import { adminApi } from '../services/api';
import { getRealtimeSocket } from '../services/realtimeService';
import {
  LayoutDashboard, ClipboardCheck, BookOpen, MonitorPlay, ShieldCheck, ScanFace,
  Sparkles, Search, X, Bell, ChevronDown, User, LogOut,
  CheckCircle2, PlayCircle, ChevronRight,
  FileText, HelpCircle, Code2, LayoutGrid,
} from 'lucide-react';

type SearchResultType = 'test' | 'mcq' | 'coding' | 'page';

interface SearchResult {
  id: string;
  name: string;
  subtitle: string;
  type: SearchResultType;
  path: string;
}

const STATIC_PAGES = [
  { id: 'dashboard',         name: 'Dashboard',              path: '/admin/dashboard' },
  { id: 'assessments',       name: 'Assessments',            path: '/admin/tests' },
  { id: 'analytics',         name: 'Performance Analytics',  path: '/admin/analytics' },
  { id: 'question-library',  name: 'Question Library',       path: '/admin/repository/question-bank' },
  { id: 'live-proctoring',   name: 'Live Proctoring',        path: '/admin/tests' },
  { id: 'trust-integrity',   name: 'Trust & Integrity',      path: '/admin/trust-reports' },
  { id: 'id-verification',   name: 'ID Verification',        path: '/admin/id-verification-data' },
  { id: 'create-test',       name: 'Create Test',            path: '/admin/tests/new' },
  { id: 'ai-generator',      name: 'AI Test Generator',      path: '/admin/tests/agent' },
];

const navItems = [
  {
    path: '/admin/dashboard',
    label: 'Dashboard',
    matchPrefix: '/admin/dashboard',
    icon: <LayoutDashboard size={16} />,
  },
  {
    path: '/admin/tests',
    label: 'Assessments',
    matchPrefix: '/admin/tests',
    icon: <ClipboardCheck size={16} />,
  },
  {
    path: '/admin/repository/question-bank',
    label: 'Question Library',
    matchPrefix: '/admin/repository',
    icon: <BookOpen size={16} />,
  },
  
  {
    path: '/admin/trust-reports',
    label: 'Trust & Integrity',
    matchPrefix: '/admin/trust-reports',
    icon: <ShieldCheck size={16} />,
  },
  {
    path: '/admin/id-verification-data',
    label: 'ID Verification',
    matchPrefix: '/admin/id-verification-data',
    icon: <ScanFace size={16} />,
  },
];

interface RecentCompletedAttempt {
  id: string;
  status: 'submitted' | 'auto_submitted' | string;
  submittedAt?: string | null;
  candidate: { name: string; email: string };
  test: { id: string; name: string };
}

interface CompletionNotification {
  id: string;
  attemptId: string;
  candidateName: string;
  testName: string;
  testId: string;
  autoSubmit: boolean;
  timestamp: string;
  type?: 'started' | 'completed';
}

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { admin, logoutAdmin, setAdmin } = useAuthStore();
  const [completionPopups, setCompletionPopups] = useState<CompletionNotification[]>([]);
  const completionPopupTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const knownCompletedAttemptIdsRef = useRef<Set<string>>(new Set());
  const completionPollInitializedRef = useRef(false);
  const completionWatchStartedAtRef = useRef(Date.now());

  const [searchQuery, setSearchQuery]     = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen]       = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const [notificationHistory, setNotificationHistory] = useState<CompletionNotification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifUnread, setNotifUnread] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);
  const notifLoadedRef = useRef(false);

  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const initials =
    admin?.name
      ? admin.name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()
      : admin?.email?.slice(0, 2).toUpperCase() || 'AD';

  const handleLogout = () => {
    logoutAdmin();
    navigate('/admin/login');
  };

  const dismissCompletionPopup = (notificationId: string) => {
    const timeoutId = completionPopupTimeoutsRef.current.get(notificationId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      completionPopupTimeoutsRef.current.delete(notificationId);
    }
    setCompletionPopups((prev) => prev.filter((n) => n.id !== notificationId));
  };

  const showCompletionPopup = (notification: CompletionNotification) => {
    setCompletionPopups((prev) => {
      const existing = prev.find((item) => item.attemptId === notification.attemptId);
      if (!existing) return [...prev, notification];
      return prev.map((item) => (item.attemptId === notification.attemptId ? notification : item));
    });

    const existingTimeout = completionPopupTimeoutsRef.current.get(notification.id);
    if (existingTimeout) clearTimeout(existingTimeout);

    const timeoutId = setTimeout(() => {
      completionPopupTimeoutsRef.current.delete(notification.id);
      setCompletionPopups((prev) => prev.filter((item) => item.id !== notification.id));
    }, 8000);
    completionPopupTimeoutsRef.current.set(notification.id, timeoutId);

    setNotificationHistory(prev => {
      const key = notification.type === 'started' ? `started-${notification.attemptId}` : notification.attemptId;
      if (prev.find(n => n.id === key || n.attemptId === notification.attemptId && n.type === notification.type)) return prev;
      return [{ ...notification, id: key }, ...prev];
    });
    setNotifUnread(c => c + 1);
  };

  useEffect(() => {
    if (admin?.id || !localStorage.getItem('adminToken')) return;
    let cancelled = false;
    adminApi.getProfile()
      .then(({ data }) => { if (!cancelled) setAdmin(data.admin); })
      .catch(() => { if (!cancelled) { logoutAdmin(); navigate('/admin/login'); } });
    return () => { cancelled = true; };
  }, [admin?.id, logoutAdmin, navigate, setAdmin]);

  // Load persistent notification history from DB on mount
  useEffect(() => {
    if (!admin?.id || notifLoadedRef.current) return;
    notifLoadedRef.current = true;
    adminApi.getNotifications()
      .then(({ data }) => {
        const rows: CompletionNotification[] = (data.notifications || []).map((n: {
          id: string; attemptId: string | null; testId: string | null;
          testName: string; candidateName: string; autoSubmit: boolean;
          type: string; timestamp: string; isRead: boolean;
        }) => ({
          id: n.id,
          attemptId: n.attemptId ?? '',
          testId: n.testId ?? '',
          testName: n.testName,
          candidateName: n.candidateName,
          autoSubmit: n.autoSubmit,
          type: (n.type === 'started' ? 'started' : 'completed') as 'started' | 'completed',
          timestamp: n.timestamp,
        }));
        setNotificationHistory(rows);
        const unread = rows.filter((n: any) => !n.isRead).length;
        if (unread > 0) setNotifUnread(unread);
      })
      .catch(() => { /* notifications are best-effort */ });
  }, [admin?.id]);

  useEffect(() => {
    if (!admin?.id) return;
    completionWatchStartedAtRef.current = Date.now();
    completionPollInitializedRef.current = false;
    let cancelled = false;
    const socket = getRealtimeSocket();
    socket.emit('admin-join', admin.id);

    adminApi.getTests(1, 1000)
      .then(({ data }) => {
        if (cancelled) return;
        data.tests?.forEach((test: { id: string }) => socket.emit('admin-proctor-join', test.id));
      })
      .catch(() => {});

    const handleTestSubmitted = (payload: {
      testId: string; testName: string; attemptId: string;
      candidateName: string; autoSubmit: boolean; timestamp: string;
    }) => {
      knownCompletedAttemptIdsRef.current.add(payload.attemptId);
      showCompletionPopup({
        id: payload.attemptId,
        attemptId: payload.attemptId,
        candidateName: payload.candidateName,
        testName: payload.testName,
        testId: payload.testId,
        autoSubmit: payload.autoSubmit,
        timestamp: payload.timestamp,
        type: 'completed',
      });
    };

    const handleTestStarted = (payload: {
      testId: string; testName: string; attemptId: string;
      candidateName: string; timestamp: string;
    }) => {
      showCompletionPopup({
        id: `started-${payload.attemptId}`,
        attemptId: payload.attemptId,
        candidateName: payload.candidateName,
        testName: payload.testName,
        testId: payload.testId,
        autoSubmit: false,
        timestamp: payload.timestamp,
        type: 'started',
      });
    };

    socket.on('test-submitted', handleTestSubmitted);
    socket.on('test-started', handleTestStarted);
    return () => {
      cancelled = true;
      socket.off('test-submitted', handleTestSubmitted);
      socket.off('test-started', handleTestStarted);
    };
  }, [admin?.id]);

  useEffect(() => {
    if (!admin?.id) return;
    let cancelled = false;

    const checkCompletedAttempts = async () => {
      try {
        const { data } = await adminApi.getRecentCompletedAttempts(30);
        if (cancelled) return;
        const completedAttempts: RecentCompletedAttempt[] = data.attempts || [];
        const nextKnownIds = new Set(knownCompletedAttemptIdsRef.current);

        if (!completionPollInitializedRef.current) {
          completedAttempts.slice().reverse().forEach((attempt) => {
            nextKnownIds.add(attempt.id);
            const submittedAtTime = attempt.submittedAt ? new Date(attempt.submittedAt).getTime() : 0;
            if (submittedAtTime >= completionWatchStartedAtRef.current) {
              showCompletionPopup({
                id: attempt.id,
                attemptId: attempt.id,
                candidateName: attempt.candidate?.name || attempt.candidate?.email || 'Unknown',
                testName: attempt.test?.name || 'Untitled test',
                testId: attempt.test?.id || '',
                autoSubmit: attempt.status === 'auto_submitted',
                timestamp: attempt.submittedAt || new Date().toISOString(),
              });
            }
          });
          knownCompletedAttemptIdsRef.current = nextKnownIds;
          completionPollInitializedRef.current = true;
          return;
        }

        completedAttempts.slice().reverse().forEach((attempt) => {
          if (nextKnownIds.has(attempt.id)) return;
          nextKnownIds.add(attempt.id);
          showCompletionPopup({
            id: attempt.id,
            attemptId: attempt.id,
            candidateName: attempt.candidate?.name || attempt.candidate?.email || 'Unknown',
            testName: attempt.test?.name || 'Untitled test',
            testId: attempt.test?.id || '',
            autoSubmit: attempt.status === 'auto_submitted',
            timestamp: attempt.submittedAt || new Date().toISOString(),
          });
        });
        knownCompletedAttemptIdsRef.current = nextKnownIds;
      } catch {
        // next poll will retry
      }
    };

    checkCompletedAttempts();
    const intervalId = setInterval(checkCompletedAttempts, 5000);
    return () => { cancelled = true; clearInterval(intervalId); };
  }, [admin?.id]);

  useEffect(() => {
    return () => {
      completionPopupTimeoutsRef.current.forEach((t) => clearTimeout(t));
      completionPopupTimeoutsRef.current.clear();
    };
  }, []);

  /* ── Search: close dropdown when clicking outside ── */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /* ── Notifications: close dropdown when clicking outside ── */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /* ── Profile menu: close dropdown when clicking outside ── */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /* ── Search: debounced query across tests, MCQs, coding questions, and pages ── */
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSearchResults([]); setSearchOpen(false); return; }

    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const [testsRes, mcqsRes, codingsRes] = await Promise.allSettled([
          adminApi.getTests(1, 5, q),
          adminApi.getMCQs(1, 4, q),
          adminApi.getCodings(1, 4, q),
        ]);

        const ql = q.toLowerCase();

        const tests: SearchResult[] = testsRes.status === 'fulfilled'
          ? (testsRes.value.data.tests || []).map((t: { id: string; name: string; testCode?: string }) => ({
              id: t.id,
              name: t.name,
              subtitle: t.testCode || `#${t.id.slice(0, 8).toUpperCase()}`,
              type: 'test' as const,
              path: `/admin/tests/${t.id}`,
            }))
          : [];

        const mcqs: SearchResult[] = mcqsRes.status === 'fulfilled'
          ? (mcqsRes.value.data.questions || []).map((m: { id: string; questionText: string; topic?: string; difficulty?: string }) => ({
              id: m.id,
              name: m.questionText.length > 64 ? m.questionText.slice(0, 64) + '…' : m.questionText,
              subtitle: `MCQ · ${m.topic || 'General'} · ${m.difficulty || 'medium'}`,
              type: 'mcq' as const,
              path: '/admin/repository/question-bank',
            }))
          : [];

        const codings: SearchResult[] = codingsRes.status === 'fulfilled'
          ? (codingsRes.value.data.questions || []).map((c: { id: string; title: string; topic?: string; difficulty?: string }) => ({
              id: c.id,
              name: c.title,
              subtitle: `Coding · ${c.topic || 'General'} · ${c.difficulty || 'medium'}`,
              type: 'coding' as const,
              path: `/admin/coding/${c.id}/edit`,
            }))
          : [];

        const pages: SearchResult[] = STATIC_PAGES
          .filter(p => p.name.toLowerCase().includes(ql))
          .map(p => ({ id: p.id, name: p.name, subtitle: 'Page', type: 'page' as const, path: p.path }));

        const combined = [...tests, ...mcqs, ...codings, ...pages];
        setSearchResults(combined);
        setSearchOpen(true);
      } catch {
        setSearchResults([]);
        setSearchOpen(true);
      } finally {
        setSearchLoading(false);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSearchSelect = (result: SearchResult) => {
    navigate(result.path);
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const TYPE_ICON: Record<SearchResultType, React.ReactNode> = {
    test:   <FileText size={13} color="white" />,
    mcq:    <HelpCircle size={13} color="white" />,
    coding: <Code2 size={13} color="white" />,
    page:   <LayoutGrid size={13} color="white" />,
  };

  const TYPE_BG: Record<SearchResultType, string> = {
    test:   '#111827',
    mcq:    '#4F46E5',
    coding: '#059669',
    page:   '#6B7280',
  };

  const TYPE_LABEL: Record<SearchResultType, string> = {
    test:   'ASSESSMENTS',
    mcq:    'MCQ QUESTIONS',
    coding: 'CODING QUESTIONS',
    page:   'PAGES',
  };

  const relativeTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  const isActiveItem = (matchPrefix: string) => location.pathname.startsWith(matchPrefix);

  return (
    <div className="admin-shell flex h-screen overflow-hidden" style={{ background: '#f4f6fb' }}>

      {/* ── LEFT SIDEBAR ── */}
      <aside
        className="flex flex-col flex-shrink-0 h-full"
        style={{ width: '220px', backgroundColor: '#142340', borderRight: '1px solid #1a2332' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-4" style={{ borderBottom: '1px solid #1a2332' }}>
          <div>
            <p className="text-white text-sm font-semibold leading-tight">TalentstaQ</p>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <p
            className="text-[9px] font-bold tracking-widest uppercase px-2 mb-3"
            style={{ color: '#ffffff' }}
          >
            Workspace
          </p>

          <nav className="space-y-0.5">
            {navItems.map((item) => {
              const active = isActiveItem(item.matchPrefix);
              return (
                <Link
                  key={`${item.path}-${item.label}`}
                  to={item.path}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: active ? 'rgba(227, 158, 30, 0.41)' : 'transparent',
                    color: active ? '#ffffff' : '#ffffff',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(227, 158, 30, 0.2)'; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                >
                  <span style={{ color: active ? '#10B981' : 'currentColor' }}>{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* AI Test Generator — Gemini-style */}
        <div className="mx-3 mb-3">
          <Link
            to="/admin/tests/agent"
            style={{
              textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 12px', borderRadius: '14px', transition: 'background-color 0.18s',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.backgroundColor = 'rgba(139,92,246,0.13)';
              const title = el.querySelector('[data-aititle]') as HTMLElement | null;
              if (title) title.style.color = '#ffffff';
              const glow = el.querySelector('[data-aiglow]') as HTMLElement | null;
              if (glow) glow.style.opacity = '1';
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.backgroundColor = 'transparent';
              const title = el.querySelector('[data-aititle]') as HTMLElement | null;
              if (title) title.style.color = '#C4CAD6';
              const glow = el.querySelector('[data-aiglow]') as HTMLElement | null;
              if (glow) glow.style.opacity = '0.5';
            }}
          >
            {/* Gemini 4-point star with neon glow */}
            <div style={{ position: 'relative', width: '34px', height: '34px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div data-aiglow="" style={{
                position: 'absolute', inset: '-4px', borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(139,92,246,0.6) 0%, rgba(6,182,212,0.3) 55%, transparent 75%)',
                filter: 'blur(6px)', opacity: '0.5', transition: 'opacity 0.2s',
              }} />
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ position: 'relative', zIndex: 1 }}>
                <defs>
                  <linearGradient id="adminAiStar" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#06B6D4" />
                    <stop offset="48%" stopColor="#8B5CF6" />
                    <stop offset="100%" stopColor="#EC4899" />
                  </linearGradient>
                </defs>
                <path d="M12 2 Q13.2 8.8 20 12 Q13.2 15.2 12 22 Q10.8 15.2 4 12 Q10.8 8.8 12 2 Z" fill="url(#adminAiStar)" />
              </svg>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <p data-aititle="" style={{ fontSize: '12px', fontWeight: 600, margin: 0, color: '#C4CAD6', letterSpacing: '0.01em', transition: 'color 0.18s' }}>
                AI Test Generator
              </p>
              <p style={{ fontSize: '10px', color: '#4B5563', margin: '2px 0 0', lineHeight: 1.3 }}>
                Generate from job description
              </p>
            </div>
            <ChevronRight size={11} color="#4B5563" style={{ flexShrink: 0 }} />
          </Link>
        </div>

        {/* User Profile */}
        <div ref={profileRef} style={{ position: 'relative', borderTop: '1px solid #1a2332' }}>
          {/* Profile popup (opens upward) */}
          {profileOpen && (
            <div style={{
              position: 'absolute', bottom: '100%', left: '8px', right: '8px',
              marginBottom: '6px', backgroundColor: 'white', borderRadius: '12px',
              boxShadow: '0 -4px 24px rgba(0,0,0,0.22)', border: '1px solid #E5E7EB',
              overflow: 'hidden', zIndex: 200,
            }}>
              {/* Admin header */}
              <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid #F3F4F6', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: '#10B981', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '12px' }}>
                  {initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: '#111827', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {admin?.name || 'Admin'}
                    </p>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#059669', backgroundColor: '#D1FAE5', padding: '1px 7px', borderRadius: '20px', flexShrink: 0 }}>
                      Admin
                    </span>
                  </div>
                  <p style={{ fontSize: '11px', color: '#6B7280', margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {admin?.companyName
                      ? `${admin.companyName} · ${admin.email}`
                      : admin?.email || ''}
                  </p>
                </div>
              </div>

              {/* Menu items */}
              <div style={{ padding: '5px 0' }}>
                {/* My profile */}
                <button
                  onClick={() => { setProfileOpen(false); navigate('/admin/profile'); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 14px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#EDF0F7'; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                  <User size={15} color="#6B7280" />
                  <div style={{ textAlign: 'left' }}>
                    <p style={{ fontSize: '13px', color: '#374151', margin: 0, fontWeight: 500 }}>My profile</p>
                    <p style={{ fontSize: '11px', color: '#9CA3AF', margin: 0 }}>Personal details & password</p>
                  </div>
                </button>

                {/* Notifications */}
                <button
                  onClick={() => { setProfileOpen(false); setNotifUnread(0); setNotifOpen(true); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 14px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#EDF0F7'; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                  <Bell size={15} color="#6B7280" />
                  <p style={{ fontSize: '13px', color: '#374151', margin: 0, fontWeight: 500, flex: 1, textAlign: 'left' }}>Notifications</p>
                  {notifUnread > 0 && (
                    <span style={{ fontSize: '10px', fontWeight: 700, color: 'white', backgroundColor: '#EF4444', padding: '2px 7px', borderRadius: '20px', flexShrink: 0 }}>
                      {notifUnread > 9 ? '9+' : notifUnread}
                    </span>
                  )}
                </button>
              </div>

              {/* Sign out */}
              <div style={{ borderTop: '1px solid #F3F4F6', padding: '5px 0' }}>
                <button
                  onClick={() => { setProfileOpen(false); handleLogout(); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 14px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#FEF2F2'; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                  <LogOut size={15} color="#EF4444" />
                  <p style={{ fontSize: '13px', color: '#EF4444', margin: 0, fontWeight: 500 }}>Sign out</p>
                </button>
              </div>
            </div>
          )}

          {/* Trigger row */}
          <button
            onClick={() => setProfileOpen(o => !o)}
            className="w-full flex items-center gap-2.5 px-3 py-3 transition-colors"
            style={{ backgroundColor: 'transparent', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
          >
            <div
              className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
              style={{ backgroundColor: '#374151' }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-white text-xs font-medium truncate">
                {admin?.name || 'Admin'}
              </p>
              <p className="text-[10px] truncate" style={{ color: '#6B7280' }}>
                {admin?.companyName || 'Admin'}
              </p>
            </div>
            <ChevronDown
              size={14}
              style={{ color: '#4B5563', flexShrink: 0, transform: profileOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
            />
          </button>
        </div>
      </aside>

      {/* ── MAIN AREA ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: '#f4f6fb' }}>

        {/* Top Bar — hidden on profile page */}
        <header
          className="flex items-center justify-between px-6 flex-shrink-0"
          style={{ display: location.pathname === '/admin/profile' ? 'none' : undefined,
            backgroundColor: 'white',
            borderBottom: '1px solid #F3F4F6',
            height: '52px',
          }}
        >
          {/* Search */}
          <div ref={searchContainerRef} style={{ position: 'relative', flex: 1, maxWidth: '50%' }}>
            <div
              className="flex items-center gap-2 rounded-lg px-3"
              style={{
                backgroundColor: '#EBEDF0',
                border: `1px solid ${searchOpen ? '#10B981' : '#E2E5E9'}`,
                height: '36px',
                width: '100%',
                transition: 'border-color 0.15s',
              }}
            >
              <Search size={14} color="#9CA3AF" style={{ flexShrink: 0 }} />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onFocus={() => { if (searchResults.length > 0) setSearchOpen(true); }}
                onKeyDown={e => {
                  if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); }
                  if (e.key === 'Enter' && searchResults.length === 1) handleSearchSelect(searchResults[0]);
                }}
                placeholder="Search candidates, tests..."
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: '#374151' }}
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); setSearchResults([]); setSearchOpen(false); }}
                  className="icon-btn"
                  style={{ color: '#9CA3AF', lineHeight: 1, flexShrink: 0, background: 'none', border: 'none', padding: '2px' }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Dropdown */}
            {searchOpen && (
              <div
                style={{
                  position: 'absolute', top: '42px', left: 0, zIndex: 100,
                  width: '100%', minWidth: '360px', backgroundColor: 'white',
                  borderRadius: '12px', border: '1px solid #F3F4F6',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.14)', overflow: 'hidden',
                  maxHeight: '480px', overflowY: 'auto',
                }}
              >
                {searchLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '16px' }}>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2" style={{ borderColor: '#10B981' }} />
                    <span style={{ fontSize: '13px', color: '#9CA3AF' }}>Searching…</span>
                  </div>
                ) : searchResults.length === 0 ? (
                  <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                    <p style={{ fontSize: '13px', color: '#9CA3AF', margin: 0 }}>No results for "<strong style={{ color: '#374151' }}>{searchQuery}</strong>"</p>
                  </div>
                ) : (
                  (() => {
                    const types: SearchResultType[] = ['test', 'mcq', 'coding', 'page'];
                    const grouped = types
                      .map(t => ({ type: t, items: searchResults.filter(r => r.type === t) }))
                      .filter(g => g.items.length > 0);
                    return grouped.map(group => (
                      <div key={group.type}>
                        <p style={{
                          padding: '10px 16px 4px',
                          fontSize: '10px', fontWeight: 700, color: '#9CA3AF',
                          letterSpacing: '0.07em', margin: 0,
                          borderTop: group.type !== grouped[0].type ? '1px solid #F9FAFB' : 'none',
                        }}>
                          {TYPE_LABEL[group.type]}
                        </p>
                        {group.items.map(result => (
                          <button
                            key={result.id + result.type}
                            onClick={() => handleSearchSelect(result)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '10px',
                              width: '100%', padding: '9px 16px', textAlign: 'left',
                              backgroundColor: 'transparent', border: 'none', cursor: 'pointer',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#EDF0F7')}
                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                          >
                            <div style={{
                              height: '30px', width: '30px', borderRadius: '8px', flexShrink: 0,
                              backgroundColor: TYPE_BG[result.type],
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              {TYPE_ICON[result.type]}
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <p style={{ fontSize: '13px', fontWeight: 500, color: '#111827', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {result.name}
                              </p>
                              <p style={{ fontSize: '11px', color: '#9CA3AF', margin: 0 }}>{result.subtitle}</p>
                            </div>
                            <ChevronRight size={12} color="#D1D5DB" style={{ flexShrink: 0 }} />
                          </button>
                        ))}
                      </div>
                    ));
                  })()
                )}
              </div>
            )}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-3">
            {/* Notifications Bell */}
            <div ref={notifRef} style={{ position: 'relative' }}>
              <button
                onClick={() => {
                  setNotifOpen(o => !o);
                  if (notifUnread > 0) {
                    setNotifUnread(0);
                    adminApi.markAllNotificationsRead().catch(() => {});
                  }
                }}
                className="icon-btn relative flex items-center justify-center rounded-full"
                style={{ width: '38px', height: '38px', backgroundColor: '#EBEDF0', border: '1px solid #E2E5E9' }}
              >
                <Bell size={19} color="#374151" />
                {notifUnread > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full flex items-center justify-center text-white"
                    style={{ backgroundColor: '#EF4444', fontSize: '8px', fontWeight: 700 }}
                  >
                    {notifUnread > 9 ? '9+' : notifUnread}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div style={{
                  position: 'absolute', top: '40px', right: 0, zIndex: 200,
                  width: '340px', backgroundColor: 'white',
                  borderRadius: '12px', border: '1px solid #F3F4F6',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.14)', overflow: 'hidden',
                }}>
                  <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #F3F4F6' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>Notifications</span>
                    {notificationHistory.length > 0 && (
                      <button
                        onClick={() => {
                          setNotificationHistory([]);
                          setNotifUnread(0);
                          adminApi.clearAllNotifications().catch(() => {});
                        }}
                        style={{ fontSize: '11px', color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                  <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
                    {notificationHistory.length === 0 ? (
                      <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                        <p style={{ fontSize: '13px', color: '#9CA3AF', margin: 0 }}>No notifications yet</p>
                      </div>
                    ) : (
                      notificationHistory.map(n => {
                        const isStarted = n.type === 'started';
                        return (
                          <div key={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 16px', borderBottom: '1px solid #F9FAFB' }}>
                            <div style={{ height: '32px', width: '32px', borderRadius: '50%', flexShrink: 0, backgroundColor: isStarted ? '#DBEAFE' : '#D1FAE5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {isStarted
                                ? <PlayCircle size={14} color="#3B82F6" />
                                : <CheckCircle2 size={14} color="#059669" />
                              }
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontSize: '13px', fontWeight: 500, color: '#111827', margin: 0 }}>
                                {isStarted ? 'Exam Started' : (n.autoSubmit ? 'Test Auto-submitted' : 'Test Completed')}
                              </p>
                              <p style={{ fontSize: '12px', color: '#6B7280', margin: '2px 0 0' }}>
                                <span style={{ fontWeight: 500 }}>{n.candidateName}</span>
                                {isStarted ? ' started ' : (n.autoSubmit ? ' was auto-submitted for ' : ' completed ')}
                                <span style={{ fontWeight: 500 }}>{n.testName}</span>
                              </p>
                              <p style={{ fontSize: '11px', color: '#9CA3AF', margin: '3px 0 0' }}>{relativeTime(n.timestamp)}</p>
                            </div>
                            <button
                              onClick={() => {
                                setNotificationHistory(prev => prev.filter(x => x.id !== n.id));
                                adminApi.deleteNotification(n.id).catch(() => {});
                              }}
                              style={{ color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, lineHeight: 1, fontSize: '16px', padding: '2px' }}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>


          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          <div className="p-6">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Completion / Started Popups */}
      {completionPopups.length > 0 && (
        <div className="fixed right-6 top-16 z-50 flex flex-col gap-3" style={{ width: '320px' }}>
          {completionPopups.map((notification) => {
            const isStarted = notification.type === 'started';
            return (
              <div
                key={notification.id}
                className="flex items-start gap-3 rounded-lg p-4 shadow-lg"
                style={{ backgroundColor: 'white', border: `1px solid ${isStarted ? '#BFDBFE' : '#D1FAE5'}` }}
              >
                <div
                  className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: isStarted ? '#DBEAFE' : '#D1FAE5' }}
                >
                  {isStarted
                    ? <PlayCircle size={16} color="#3B82F6" />
                    : <CheckCircle2 size={16} color="#059669" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: '#111827' }}>
                    {isStarted ? 'Exam Started' : (notification.autoSubmit ? 'Test Auto-submitted' : 'Test Completed')}
                  </p>
                  <p className="mt-0.5 text-sm" style={{ color: '#6B7280' }}>
                    <span className="font-medium">{notification.candidateName}</span>
                    {isStarted ? ' started ' : (notification.autoSubmit ? ' was auto-submitted for ' : ' completed ')}
                    <span className="font-medium">{notification.testName}</span>
                  </p>
                </div>
                <button
                  onClick={() => dismissCompletionPopup(notification.id)}
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded"
                  style={{ color: '#9CA3AF', fontSize: '18px', lineHeight: 1 }}
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
