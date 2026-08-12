import { useEffect, useRef, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../context/authStore';
import api, { adminApi } from '../services/api';
import { getRealtimeSocket } from '../services/realtimeService';
import {
  ChevronRight, ChevronLeft, CheckCircle2, PlayCircle, UserCheck, ShieldCheck,
} from 'lucide-react';
import Icon from './Icon';
import talentstaQLogo from '../assets/assessment-icons/icons/Talentstaq logo dark.svg';
import regenQLogo from '../assets/assessment-icons/icons/regen-q-logo.svg';

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
  { id: 'trust-integrity',   name: 'Trust & Integrity',      path: '/admin/trust-reports' },
  { id: 'id-verification',   name: 'ID Verification',        path: '/admin/id-verification-data' },
  { id: 'live-proctoring',   name: 'Live Proctoring',        path: '/admin/live-proctoring' },
  { id: 'create-test',       name: 'Create Test',            path: '/admin/tests/new' },
  { id: 'ai-generator',      name: 'AI Test Generator',      path: '/admin/tests/agent' },
];

const navItems = [
  {
    path: '/admin/dashboard',
    label: 'Dashboard',
    matchPrefix: '/admin/dashboard',
    icon: <Icon name="dashboard" size={20} />,
  },
  {
    path: '/admin/tests',
    label: 'Assessments',
    matchPrefix: '/admin/tests',
    icon: <Icon name="total-assessments" size={20} />,
  },
  {
    path: '/admin/repository/question-bank',
    label: 'Question Library',
    matchPrefix: '/admin/repository',
    icon: <Icon name="question-library" size={20} />,
  },
  {
    path: '/admin/trust-reports',
    label: 'Trust & Integrity',
    matchPrefix: '/admin/trust-reports',
    icon: <Icon name="trust-and-integrity" size={20} />,
  },
  {
    path: '/admin/id-verification-data',
    label: 'ID Verification',
    matchPrefix: '/admin/id-verification-data',
    icon: <Icon name="id" size={20} />,
  },
  {
    path: '/admin/live-proctoring',
    label: 'Live Proctoring',
    matchPrefix: '/admin/live-proctoring',
    icon: <Icon name="live" size={20} />,
  },
];

// Superadmin Observer: one id per browser tab session, used to group a
// click stream together on the Live Monitor screen.
function getClickSessionId(): string {
  const key = 'observerClickSessionId';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    sessionStorage.setItem(key, id);
  }
  return id;
}

function describeClickTarget(el: Element): { label: string; selector: string } {
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const ariaLabel = el.getAttribute('aria-label');
  const label = ariaLabel || text || el.tagName.toLowerCase();

  const id = el.id ? `#${el.id}` : '';
  const classes = typeof el.className === 'string' && el.className
    ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
    : '';
  const selector = `${el.tagName.toLowerCase()}${id}${classes}`.slice(0, 150);

  return { label, selector };
}

interface QueuedClickEvent {
  sessionId: string;
  eventType: string;
  targetLabel?: string;
  targetSelector?: string;
  route?: string;
  x?: number;
  y?: number;
  clientTimestamp: string;
}

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
  candidateId?: string;
  testName: string;
  testId: string;
  autoSubmit: boolean;
  timestamp: string;
  type?: 'started' | 'completed' | 'verification_pending' | 'verification_auto_verified';
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
  const notifiedHistoryKeysRef = useRef<Set<string>>(new Set());
  const notificationAudioRef = useRef<HTMLAudioElement | null>(null);
  const clickQueueRef = useRef<QueuedClickEvent[]>([]);

  useEffect(() => {
    const audio = new Audio('/sounds/pen_pop.mp3');
    audio.volume = 0.5;
    notificationAudioRef.current = audio;

    // Browsers block programmatic audio.play() until the page has registered a real
    // user gesture (a socket event doesn't count). Priming playback on the first
    // click/keydown "unlocks" audio for the rest of the session so later notification
    // sounds — fired from async socket/poll handlers — aren't silently blocked.
    const unlockAudio = () => {
      audio.play().then(() => audio.pause()).catch(() => {});
      audio.currentTime = 0;
    };
    document.addEventListener('click', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });
    return () => {
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
    };
  }, []);

  const playNotificationSound = () => {
    const audio = notificationAudioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play().catch((err) => {
      console.warn('Notification sound blocked by the browser (needs a user interaction on the page first):', err);
    });
  };

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
    const historyKey = notification.type === 'started' ? `started-${notification.attemptId}` : notification.attemptId;
    if (!notifiedHistoryKeysRef.current.has(historyKey)) {
      notifiedHistoryKeysRef.current.add(historyKey);
      playNotificationSound();
    }

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
    }, 5000);
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
          testName: string; candidateName: string; candidateId: string | null; autoSubmit: boolean;
          type: string; timestamp: string; isRead: boolean;
        }) => ({
          id: n.id,
          attemptId: n.attemptId ?? '',
          testId: n.testId ?? '',
          testName: n.testName,
          candidateName: n.candidateName,
          candidateId: n.candidateId ?? undefined,
          autoSubmit: n.autoSubmit,
          type: (n.type === 'started' || n.type === 'verification_pending' || n.type === 'verification_auto_verified' ? n.type : 'completed') as 'started' | 'completed' | 'verification_pending' | 'verification_auto_verified',
          timestamp: n.timestamp,
        }));
        setNotificationHistory(rows);
        rows.forEach(r => notifiedHistoryKeysRef.current.add(r.id));
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

    const handleVerificationPending = (payload: {
      candidateId: string; candidateName: string; attemptId: string; timestamp: string;
    }) => {
      showCompletionPopup({
        id: `verification_pending-${payload.attemptId}`,
        attemptId: payload.attemptId,
        candidateId: payload.candidateId,
        candidateName: payload.candidateName,
        testName: '',
        testId: '',
        autoSubmit: false,
        timestamp: payload.timestamp,
        type: 'verification_pending',
      });
    };

    const handleVerificationAutoVerified = (payload: {
      candidateId: string; candidateName: string; attemptId: string; timestamp: string;
    }) => {
      showCompletionPopup({
        id: `verification_auto_verified-${payload.attemptId}`,
        attemptId: payload.attemptId,
        candidateId: payload.candidateId,
        candidateName: payload.candidateName,
        testName: '',
        testId: '',
        autoSubmit: false,
        timestamp: payload.timestamp,
        type: 'verification_auto_verified',
      });
    };

    socket.on('test-submitted', handleTestSubmitted);
    socket.on('test-started', handleTestStarted);
    socket.on('verification-pending', handleVerificationPending);
    socket.on('verification-auto-verified', handleVerificationAutoVerified);

    // Real round-trip latency probe for the Superadmin Observer's live
    // telemetry — Socket.io doesn't expose transport RTT to app code, so
    // this measures it explicitly via an app-level echo.
    const handleLatencyPong = (sentAt: number) => {
      socket.emit('report-latency', Date.now() - sentAt);
    };
    socket.on('latency-pong', handleLatencyPong);
    const pingInterval = setInterval(() => {
      socket.emit('latency-ping', Date.now());
    }, 10000);
    socket.emit('latency-ping', Date.now());

    return () => {
      cancelled = true;
      socket.off('test-submitted', handleTestSubmitted);
      socket.off('test-started', handleTestStarted);
      socket.off('verification-pending', handleVerificationPending);
      socket.off('verification-auto-verified', handleVerificationAutoVerified);
      socket.off('latency-pong', handleLatencyPong);
      clearInterval(pingInterval);
    };
  }, [admin?.id]);

  // Superadmin Observer: real browser-rendered frame rate, measured via
  // requestAnimationFrame — this is "how smooth does the app actually
  // feel," distinct from proctoring's camera-frame refresh rate. Reported
  // every 5s so the Observer's Telemetry screen reflects genuine UI
  // performance, not a guess.
  useEffect(() => {
    if (!admin?.id) return;

    const socket = getRealtimeSocket();
    let frameCount = 0;
    let windowStart = performance.now();
    let rafId: number;

    const tick = (now: number) => {
      frameCount += 1;
      const elapsed = now - windowStart;
      if (elapsed >= 5000) {
        // A backgrounded tab suspends rAF, so a huge elapsed gap here means
        // the tab was hidden, not that rendering was slow — skip that
        // sample rather than reporting a misleadingly low fps.
        if (elapsed < 15000) {
          const fps = (frameCount / elapsed) * 1000;
          socket.emit('report-app-fps', Math.round(fps * 100) / 100);
        }
        frameCount = 0;
        windowStart = now;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, [admin?.id]);

  // Superadmin Observer: silent, best-effort click/navigation capture.
  // Every click anywhere in the admin app is queued and batch-flushed —
  // this supplements the server-guaranteed AdminActionLog (which only sees
  // requests that actually hit the network) with UI-level interaction
  // fidelity for the Live Monitor screen.
  useEffect(() => {
    if (!admin?.id) return;

    const MAX_QUEUE_SIZE = 500;
    const sessionId = getClickSessionId();

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const { label, selector } = target
        ? describeClickTarget(target)
        : { label: 'unknown', selector: 'unknown' };

      clickQueueRef.current.push({
        sessionId,
        eventType: 'click',
        targetLabel: label,
        targetSelector: selector,
        route: window.location.pathname,
        x: event.clientX,
        y: event.clientY,
        clientTimestamp: new Date().toISOString(),
      });

      if (clickQueueRef.current.length > MAX_QUEUE_SIZE) {
        clickQueueRef.current.splice(0, clickQueueRef.current.length - MAX_QUEUE_SIZE);
      }
    };

    const flush = () => {
      if (clickQueueRef.current.length === 0) return;
      const batch = clickQueueRef.current;
      clickQueueRef.current = [];
      adminApi.reportClicks(batch).catch(() => {
        // Best-effort: put the batch back (capped) so the next tick retries.
        clickQueueRef.current = [...batch, ...clickQueueRef.current].slice(-MAX_QUEUE_SIZE);
      });
    };

    const flushViaBeacon = () => {
      if (clickQueueRef.current.length === 0 || typeof navigator.sendBeacon !== 'function') return;
      const token = localStorage.getItem('adminToken');
      if (!token) return;
      const url = `${api.defaults.baseURL}/admin/activity/click/beacon?token=${encodeURIComponent(token)}`;
      const blob = new Blob([JSON.stringify({ events: clickQueueRef.current })], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
      clickQueueRef.current = [];
    };

    const handleVisibilityChange = () => {
      if (document.hidden) flushViaBeacon();
    };

    document.addEventListener('click', handleClick, { capture: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flushViaBeacon);
    const flushIntervalId = setInterval(flush, 2000);

    return () => {
      document.removeEventListener('click', handleClick, { capture: true });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flushViaBeacon);
      clearInterval(flushIntervalId);
      flush();
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

  /* -- Search: close dropdown when clicking outside -- */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /* -- Notifications: close dropdown when clicking outside -- */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /* -- Profile menu: close dropdown when clicking outside -- */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /* -- Search: debounced query across tests, MCQs, coding questions, and pages -- */
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
    test:   <Icon name="total-assessments" size={17} />,
    mcq:    <Icon name="mcq-questions" size={17} />,
    coding: <Icon name="coding" size={17} />,
    page:   <Icon name="dashboard" size={17} />,
  };

  const TYPE_BG: Record<SearchResultType, string> = {
    test:   'var(--admin-accent-soft)',
    mcq:    'var(--admin-accent-soft)',
    coding: 'var(--admin-accent-soft)',
    page:   'var(--admin-hover)',
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
    <div className="admin-shell flex h-screen overflow-hidden" style={{ background: 'var(--admin-bg)' }}>

      {/* -- LEFT SIDEBAR -- */}
      <aside
        className="admin-sidebar flex flex-col flex-shrink-0 h-full"
        data-collapsed={sidebarCollapsed}
        style={{
          width: sidebarCollapsed ? '72px' : '240px',
          backgroundColor: '#ffffff',
          borderRight: '1px solid #E2E6EE',
          transition: 'width 0.22s ease',
        }}
      >
        {/* Logo */}
        <div
          className="flex items-center"
          style={{
            height: '52px',
            borderBottom: '1px solid #E2E6EE',
            justifyContent: sidebarCollapsed ? 'center' : 'space-between',
            padding: sidebarCollapsed ? '0 10px' : '0 12px 0 14px',
            position: 'relative',
          }}
        >
          {!sidebarCollapsed && (
            <img src={talentstaQLogo} alt="TalentstaQ" style={{ height: '34px', width: 'auto', minWidth: 0 }} />
          )}
          <button
            type="button"
            className="icon-btn"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setSidebarCollapsed(v => !v)}
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--admin-text-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              position: sidebarCollapsed ? 'static' : 'absolute',
              right: sidebarCollapsed ? undefined : '12px',
            }}
          >
            {sidebarCollapsed ? (
              <img src={regenQLogo} alt="TalentstaQ" style={{ height: '34px', width: '34px' }} />
            ) : (
              <ChevronLeft size={15} />
            )}
          </button>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4" style={{ paddingLeft: sidebarCollapsed ? '10px' : '12px', paddingRight: sidebarCollapsed ? '10px' : '12px' }}>
          {!sidebarCollapsed && (
            <p
              className="text-[9px] font-bold tracking-widest uppercase px-2 mb-3"
              style={{ color: 'var(--admin-text-subtle)', fontFamily: 'var(--font-mono)' }}
            >
              Workspace
            </p>
          )}

          <nav className="space-y-0.5">
            {navItems.map((item) => {
              const active = isActiveItem(item.matchPrefix);
              return (
                <Link
                  key={`${item.path}-${item.label}`}
                  to={item.path}
                  title={sidebarCollapsed ? item.label : undefined}
                  className="flex items-center rounded-lg text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: active ? 'var(--admin-nav-active)' : 'transparent',
                    color: active ? 'white' : 'var(--admin-text-muted)',
                    gap: sidebarCollapsed ? 0 : '12px',
                    justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                    padding: sidebarCollapsed ? '10px 0' : '10px 12px',
                  }}
                  onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--admin-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--admin-text)'; } }}
                  onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--admin-text-muted)'; } }}
                >
                  <span style={{ color: 'currentColor', display: 'inline-flex' }}>{item.icon}</span>
                  {!sidebarCollapsed && item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* User Profile */}
        <div ref={profileRef} style={{ position: 'relative', borderTop: '1px solid #E2E6EE' }}>
          {/* Profile popup (opens upward) */}
          {profileOpen && (
            <div style={{
              position: 'absolute', bottom: '100%', left: sidebarCollapsed ? '8px' : '8px', right: sidebarCollapsed ? 'auto' : '8px',
              width: sidebarCollapsed ? '220px' : undefined,
              marginBottom: '6px', backgroundColor: 'white', borderRadius: '12px',
              boxShadow: '0 -4px 24px rgba(31,53,86,0.18)', border: '1px solid var(--admin-border)',
              overflow: 'hidden', zIndex: 200,
            }}>
              {/* Admin header */}
              <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--admin-border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'var(--admin-accent)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '12px' }}>
                  {initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--admin-text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {admin?.name || 'Admin'}
                    </p>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#C45F20', backgroundColor: '#FFF0E5', padding: '1px 7px', borderRadius: '20px', flexShrink: 0 }}>
                      Admin
                    </span>
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--admin-text-muted)', margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--admin-hover)'; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                  <Icon name="my-profile" size={16} />
                  <div style={{ textAlign: 'left' }}>
                    <p style={{ fontSize: '13px', color: 'var(--admin-text-muted)', margin: 0, fontWeight: 500 }}>My profile</p>
                    <p style={{ fontSize: '11px', color: 'var(--admin-text-subtle)', margin: 0 }}>Personal details & password</p>
                  </div>
                </button>

                {/* Notifications */}
                <button
                  onClick={() => { setProfileOpen(false); setNotifUnread(0); setNotifOpen(true); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 14px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--admin-hover)'; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                  <Icon name="notification" size={16} />
                  <p style={{ fontSize: '13px', color: 'var(--admin-text-muted)', margin: 0, fontWeight: 500, flex: 1, textAlign: 'left' }}>Notifications</p>
                  {notifUnread > 0 && (
                    <span style={{ fontSize: '10px', fontWeight: 700, color: 'white', backgroundColor: '#EF4444', padding: '2px 7px', borderRadius: '20px', flexShrink: 0 }}>
                      {notifUnread > 9 ? '9+' : notifUnread}
                    </span>
                  )}
                </button>
              </div>

              {/* Sign out */}
              <div style={{ borderTop: '1px solid var(--admin-border)', padding: '5px 0' }}>
                <button
                  onClick={() => { setProfileOpen(false); handleLogout(); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 14px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#FEF2F2'; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                  <Icon name="logout" size={16} />
                  <p style={{ fontSize: '13px', color: '#EF4444', margin: 0, fontWeight: 500 }}>Sign out</p>
                </button>
              </div>
            </div>
          )}

          {/* Trigger row */}
          <button
            onClick={() => setProfileOpen(o => !o)}
            title={sidebarCollapsed ? (admin?.name || 'Admin') : undefined}
            className="w-full flex items-center transition-colors"
            style={{
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              gap: sidebarCollapsed ? 0 : '10px',
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              padding: sidebarCollapsed ? '12px 0' : '12px',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--admin-bg)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
          >
            <div
              className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
              style={{ backgroundColor: 'var(--admin-accent)' }}
            >
              {initials}
            </div>
            {!sidebarCollapsed && (
              <>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-xs font-medium truncate" style={{ color: 'var(--admin-text)' }}>
                    {admin?.name || 'Admin'}
                  </p>
                  <p className="text-[10px] truncate" style={{ color: 'var(--admin-text-muted)' }}>
                    {admin?.companyName || 'Admin'}
                  </p>
                </div>
                <Icon
                  name="chevron-down"
                  size={14}
                  style={{ flexShrink: 0, transform: profileOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', opacity: 0.5 }}
                />
              </>
            )}
          </button>
        </div>
      </aside>

      {/* -- MAIN AREA -- */}
      <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: 'var(--admin-bg)' }}>

        {/* Top Bar — hidden on profile page */}
        <header
          className="flex items-center justify-between gap-3 px-6 flex-shrink-0"
          style={{ display: location.pathname === '/admin/profile' ? 'none' : undefined,
            position: 'sticky',
            top: 0,
            zIndex: 40,
            backgroundColor: 'white',
            borderBottom: '1px solid var(--admin-border)',
            height: '52px',
          }}
        >
          <span
            style={{
              flexShrink: 0,
              color: 'var(--admin-text)',
              fontSize: '18px',
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: '0',
            }}
          >
            <span style={{ color: '#F27A32' }}>{admin?.companyName || 'Admin'}&apos;s</span>{' '}
            <span style={{ color: 'var(--admin-text)' }}>Workspace</span>
          </span>

          {/* Search */}
          <div ref={searchContainerRef} style={{ position: 'relative', flex: '0 1 360px', maxWidth: '360px', marginLeft: 'auto' }}>
            <div
              className="flex items-center gap-2 rounded-lg px-3"
              style={{
                backgroundColor: 'var(--admin-surface-soft)',
                border: `1px solid ${searchOpen ? 'var(--admin-accent)' : 'var(--admin-border)'}`,
                height: '36px',
                width: '100%',
                transition: 'border-color 0.15s',
              }}
            >
              <Icon name="search" size={14} style={{ color: 'var(--admin-text-subtle)', flexShrink: 0 }} />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onFocus={() => { if (searchResults.length > 0) setSearchOpen(true); }}
                onKeyDown={e => {
                  if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); }
                  if (e.key === 'Enter' && searchResults.length === 1) handleSearchSelect(searchResults[0]);
                }}
                placeholder="Search candidates, tests..."
                className="admin-top-search-input flex-1 bg-transparent text-sm outline-none"
                style={{ color: 'var(--admin-text)', fontSize: '14px', lineHeight: '20px', outline: 'none', boxShadow: 'none' }}
              />
            </div>

            {/* Dropdown */}
            {searchOpen && (
              <div
                style={{
                  position: 'absolute', top: '42px', left: 0, zIndex: 100,
                  width: '100%', minWidth: '360px', backgroundColor: 'white',
                  borderRadius: '12px', border: '1px solid var(--admin-border)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.14)', overflow: 'hidden',
                  maxHeight: '480px', overflowY: 'auto',
                }}
              >
                {searchLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '16px' }}>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2" style={{ borderColor: 'var(--admin-accent)' }} />
                    <span style={{ fontSize: '13px', color: 'var(--admin-text-subtle)' }}>Searching…</span>
                  </div>
                ) : searchResults.length === 0 ? (
                  <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                    <p style={{ fontSize: '13px', color: 'var(--admin-text-subtle)', margin: 0 }}>No results for "<strong style={{ color: 'var(--admin-text-muted)' }}>{searchQuery}</strong>"</p>
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
                          fontSize: '10px', fontWeight: 700, color: 'var(--admin-text-subtle)',
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
                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--admin-accent-soft)')}
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
                              <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--admin-text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {result.name}
                              </p>
                              <p style={{ fontSize: '11px', color: 'var(--admin-text-subtle)', margin: 0 }}>{result.subtitle}</p>
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
          <div className="flex items-center gap-2">
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
                className="icon-btn relative flex items-center justify-center"
                style={{ width: '38px', height: '38px', borderRadius: '8px', backgroundColor: 'transparent', border: '1px solid transparent', color: 'var(--admin-button-primary)' }}
              >
                <Icon name="bell" size={20} />
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
                  borderRadius: '12px', border: '1px solid var(--admin-border)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.14)', overflow: 'hidden',
                }}>
                  <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--admin-border)' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--admin-text)' }}>Notifications</span>
                    <button
                      type="button"
                      disabled={notificationHistory.length === 0}
                      onClick={() => {
                        if (notificationHistory.length === 0) return;
                        setNotificationHistory([]);
                        setNotifUnread(0);
                        adminApi.clearAllNotifications().catch(() => {});
                      }}
                      style={{
                        height: '28px',
                        padding: '0 10px',
                        borderRadius: 'var(--admin-control-radius)',
                        border: '1px solid var(--admin-border)',
                        backgroundColor: notificationHistory.length === 0 ? 'var(--admin-surface-soft)' : 'white',
                        color: notificationHistory.length === 0 ? 'var(--admin-text-subtle)' : 'var(--admin-text-muted)',
                        cursor: notificationHistory.length === 0 ? 'not-allowed' : 'pointer',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                    >
                      Clear all
                    </button>
                  </div>
                  <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
                    {notificationHistory.length === 0 ? (
                      <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                        <p style={{ fontSize: '13px', color: 'var(--admin-text-subtle)', margin: 0 }}>No notifications yet</p>
                      </div>
                    ) : (
                      notificationHistory.map(n => {
                        const isStarted = n.type === 'started';
                        const isVerificationPending = n.type === 'verification_pending';
                        const isAutoVerified = n.type === 'verification_auto_verified';
                        return (
                          <div key={n.id}
                            onClick={() => {
                              if (!isVerificationPending && !isAutoVerified) return;
                              setNotifOpen(false);
                              navigate(`/admin/id-verification-data?candidateId=${n.candidateId ?? ''}`);
                            }}
                            style={{
                              display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 16px',
                              borderBottom: '1px solid #F9FAFB', cursor: (isVerificationPending || isAutoVerified) ? 'pointer' : 'default',
                            }}
                          >
                            <div style={{ height: '32px', width: '32px', borderRadius: '50%', flexShrink: 0, backgroundColor: isStarted ? 'var(--admin-accent-disabled)' : 'var(--admin-accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {isVerificationPending
                                ? <UserCheck size={14} color="var(--admin-accent-hover)" />
                                : isAutoVerified
                                  ? <ShieldCheck size={14} color="#059669" />
                                  : isStarted
                                    ? <PlayCircle size={14} color="var(--admin-accent)" />
                                    : <CheckCircle2 size={14} color="var(--admin-accent-hover)" />
                              }
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--admin-text)', margin: 0 }}>
                                {isVerificationPending ? 'ID Verification' : isAutoVerified ? 'ID Auto-Verified' : isStarted ? 'Exam Started' : (n.autoSubmit ? 'Test Auto-submitted' : 'Test Completed')}
                              </p>
                              <p style={{ fontSize: '12px', color: 'var(--admin-text-muted)', margin: '2px 0 0' }}>
                                <span style={{ fontWeight: 500 }}>{n.candidateName}</span>
                                {isVerificationPending
                                  ? ' waiting for approval of ID Verification'
                                  : isAutoVerified
                                    ? ' was automatically ID-verified — no action needed'
                                    : isStarted ? ' started ' : (n.autoSubmit ? ' was auto-submitted for ' : ' completed ')}
                                {!isVerificationPending && !isAutoVerified && <span style={{ fontWeight: 500 }}>{n.testName}</span>}
                              </p>
                              <p style={{ fontSize: '11px', color: 'var(--admin-text-subtle)', margin: '3px 0 0' }}>{relativeTime(n.timestamp)}</p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setNotificationHistory(prev => prev.filter(x => x.id !== n.id));
                                adminApi.deleteNotification(n.id).catch(() => {});
                              }}
                              style={{ color: 'var(--admin-text-subtle)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, lineHeight: 1, fontSize: '16px', padding: '2px' }}
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

            {/* User Details */}
            <div className="flex items-center gap-2 pl-3 border-l" style={{ borderColor: 'var(--admin-border)' }}>
              <button
                onClick={() => navigate('/admin/profile')}
                className="flex items-center justify-center h-8 w-8 rounded-full flex-shrink-0 hover:bg-gray-100"
                style={{ backgroundColor: 'var(--admin-accent-soft)' }}
              >
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--admin-accent)' }}>
                  {initials}
                </span>
              </button>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          <div className="admin-page">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Completion / Started Popups */}
      {completionPopups.length > 0 && (
        <div className="fixed right-6 top-16 z-50 flex flex-col gap-3" style={{ width: '320px' }}>
          {completionPopups.map((notification) => {
            const isStarted = notification.type === 'started';
            const isVerificationPending = notification.type === 'verification_pending';
            const isAutoVerified = notification.type === 'verification_auto_verified';
            return (
              <div
                key={notification.id}
                onClick={() => {
                  if (!isVerificationPending && !isAutoVerified) return;
                  dismissCompletionPopup(notification.id);
                  navigate(`/admin/id-verification-data?candidateId=${notification.candidateId ?? ''}`);
                }}
                className="flex items-start gap-3 rounded-lg p-4 shadow-lg"
                style={{
                  backgroundColor: 'white', border: '1px solid var(--admin-accent-disabled)',
                  cursor: (isVerificationPending || isAutoVerified) ? 'pointer' : 'default',
                }}
              >
                <div
                  className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: isStarted ? 'var(--admin-accent-disabled)' : 'var(--admin-accent-soft)' }}
                >
                  {isVerificationPending
                    ? <UserCheck size={16} color="var(--admin-accent-hover)" />
                    : isAutoVerified
                      ? <ShieldCheck size={16} color="#059669" />
                      : isStarted
                        ? <PlayCircle size={16} color="var(--admin-accent)" />
                        : <CheckCircle2 size={16} color="var(--admin-accent-hover)" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: 'var(--admin-text)' }}>
                    {isVerificationPending ? 'ID Verification' : isAutoVerified ? 'ID Auto-Verified' : isStarted ? 'Exam Started' : (notification.autoSubmit ? 'Test Auto-submitted' : 'Test Completed')}
                  </p>
                  <p className="mt-0.5 text-sm" style={{ color: 'var(--admin-text-muted)' }}>
                    <span className="font-medium">{notification.candidateName}</span>
                    {isVerificationPending
                      ? ' waiting for approval of ID Verification'
                      : isAutoVerified
                        ? ' was automatically ID-verified — no action needed'
                        : isStarted ? ' started ' : (notification.autoSubmit ? ' was auto-submitted for ' : ' completed ')}
                    {!isVerificationPending && !isAutoVerified && <span className="font-medium">{notification.testName}</span>}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={(e) => { e.stopPropagation(); dismissCompletionPopup(notification.id); }}
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-gray-100"
                  style={{ color: 'var(--admin-text-subtle)', fontSize: '18px', lineHeight: 1 }}
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
