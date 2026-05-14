import { useEffect, useRef, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../context/authStore';
import { adminApi } from '../services/api';
import { getRealtimeSocket } from '../services/realtimeService';

const navItems = [
  { path: '/admin/dashboard', label: 'Candidates', matchPrefix: '/admin/dashboard' },
  { path: '/admin/tests', label: 'Tests', matchPrefix: '/admin/tests' },
  { path: '/admin/repository/question-bank', label: 'Library', matchPrefix: '/admin/repository' },
  { path: '/admin/trust-reports', label: 'Insights', matchPrefix: '/admin/trust-reports' },
];

interface RecentCompletedAttempt {
  id: string;
  status: 'submitted' | 'auto_submitted' | string;
  submittedAt?: string | null;
  candidate: {
    name: string;
    email: string;
  };
  test: {
    id: string;
    name: string;
  };
}

interface CompletionNotification {
  id: string;
  attemptId: string;
  candidateName: string;
  testName: string;
  testId: string;
  autoSubmit: boolean;
  timestamp: string;
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
  const initials =
    admin?.name
      ? admin.name
          .split(' ')
          .map(part => part[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()
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
    setCompletionPopups((prev) => prev.filter((notification) => notification.id !== notificationId));
  };

  const showCompletionPopup = (notification: CompletionNotification) => {
    setCompletionPopups((prev) => {
      const existingNotification = prev.find((item) => item.attemptId === notification.attemptId);
      if (!existingNotification) {
        return [...prev, notification];
      }
      return prev.map((item) => (item.attemptId === notification.attemptId ? notification : item));
    });

    const existingTimeoutId = completionPopupTimeoutsRef.current.get(notification.id);
    if (existingTimeoutId) {
      clearTimeout(existingTimeoutId);
    }
    const timeoutId = setTimeout(() => {
      completionPopupTimeoutsRef.current.delete(notification.id);
      setCompletionPopups((prev) => prev.filter((item) => item.id !== notification.id));
    }, 8000);
    completionPopupTimeoutsRef.current.set(notification.id, timeoutId);
  };

  useEffect(() => {
    if (admin?.id || !localStorage.getItem('adminToken')) return;

    let cancelled = false;

    adminApi.getProfile()
      .then(({ data }) => {
        if (!cancelled) {
          setAdmin(data.admin);
        }
      })
      .catch(() => {
        if (!cancelled) {
          logoutAdmin();
          navigate('/admin/login');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [admin?.id, logoutAdmin, navigate, setAdmin]);

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
        data.tests?.forEach((test: { id: string }) => {
          socket.emit('admin-proctor-join', test.id);
        });
      })
      .catch(() => {
        // Admin-room notifications still work if this fallback subscription fails.
      });

    const handleTestSubmitted = (payload: {
      testId: string;
      testName: string;
      attemptId: string;
      candidateName: string;
      autoSubmit: boolean;
      timestamp: string;
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
      });
    };

    socket.on('test-submitted', handleTestSubmitted);

    return () => {
      cancelled = true;
      socket.off('test-submitted', handleTestSubmitted);
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
          completedAttempts
            .slice()
            .reverse()
            .forEach((attempt) => {
              nextKnownIds.add(attempt.id);

              const submittedAtTime = attempt.submittedAt
                ? new Date(attempt.submittedAt).getTime()
                : 0;

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

        completedAttempts
          .slice()
          .reverse()
          .forEach((attempt) => {
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
        // The next poll will retry. Existing socket notifications can still arrive.
      }
    };

    checkCompletedAttempts();
    const intervalId = setInterval(checkCompletedAttempts, 5000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [admin?.id]);

  useEffect(() => {
    return () => {
      completionPopupTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      completionPopupTimeoutsRef.current.clear();
    };
  }, []);

  const isActiveItem = (matchPrefix: string) => location.pathname.startsWith(matchPrefix);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-[#111827] bg-[#0b1220] text-white">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-6 px-6 py-3">
          <Link to="/" className="flex items-center gap-2" aria-label="Home" title="Home">
            <div className="flex h-9 w-9 items-center justify-center rounded bg-emerald-500 text-xs font-bold text-[#0b1220]">
              R
            </div>
            <span className="text-sm font-semibold tracking-wide">Regen</span>
          </Link>

          <nav className="hide-scrollbar flex-1 overflow-x-auto overflow-y-hidden">
            <ul className="flex items-center gap-6 whitespace-nowrap text-sm">
              {navItems.map(item => (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`relative pb-2 transition ${
                      isActiveItem(item.matchPrefix)
                        ? 'text-white after:absolute after:-bottom-[11px] after:left-0 after:h-[3px] after:w-full after:bg-emerald-400'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-[#151f32] px-3 py-1.5 text-sm text-slate-300">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-slate-400">
                <path
                  d="M21 21l-4.3-4.3m1.3-5.2a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <input
                placeholder="Search candidate"
                className="w-48 bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold uppercase">
                {initials}
              </div>
              <button
                onClick={handleLogout}
                className="text-xs font-semibold text-slate-300 hover:text-white"
                title="Sign out"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-7xl p-6">
          <Outlet />
        </div>
      </main>

      {completionPopups.length > 0 && (
        <div className="fixed right-6 top-20 z-50 flex w-[calc(100vw-3rem)] max-w-sm flex-col gap-3 sm:w-80">
          {completionPopups.map((notification) => (
            <div
              key={notification.id}
              className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-white p-4 text-slate-900 shadow-lg animate-slide-in-right"
            >
              <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M5 13l4 4L19 7" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {notification.autoSubmit ? 'Test Auto-submitted' : 'Test Completed'}
                </p>
                <p className="mt-0.5 text-sm text-slate-600">
                  <span className="font-medium">{notification.candidateName}</span>
                  {notification.autoSubmit ? ' was auto-submitted for ' : ' completed '}
                  <span className="font-medium">{notification.testName}</span>
                </p>
                <p className="mt-1 truncate text-xs text-slate-400">Test ID: {notification.testId}</p>
              </div>
              <button
                onClick={() => dismissCompletionPopup(notification.id)}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-[0px] leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Dismiss"
              >
                <span aria-hidden="true" className="text-lg">&times;</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
