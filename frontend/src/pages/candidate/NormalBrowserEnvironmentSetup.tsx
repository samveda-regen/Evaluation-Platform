import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { BrainCircuit, ScanFace, ShieldCheck, Sparkles, Check } from 'lucide-react';
import { candidateApi } from '../../services/api';
import talentstaQLogo from '../../assets/assessment-icons/icons/Talentstaq logo dark.svg';

// Cycled together: icon at ICONS[n] pairs with message at MESSAGES[n]. Purely
// cosmetic — real state is just "still checking" vs "done" — so the exact
// wording/order doesn't need to track actual readiness progress.
const ICONS = [BrainCircuit, ScanFace, ShieldCheck, Sparkles];
const MESSAGES = [
  'Setting up your environment…',
  'Checking detection service status…',
  'Verifying proctoring signals…',
  'Almost ready…',
];
const CYCLE_MS = 1800;
const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MS = 60000;

/**
 * Page 2 of the normal-browser pre-exam flow — the normal-browser counterpart
 * to SebEnvironmentSetup.tsx. That page warms up in-browser models per
 * candidate; this mode never runs detection client-side (the backend always
 * sets detectionMode: 'server' for NORMAL_BROWSER tests), so there's nothing
 * per-candidate to warm up. Instead this polls whether the shared
 * python_cv_service backend is actually up and has its model loaded
 * (getServerDetectionReadiness, proxying its /health endpoint) — mostly
 * useful for catching the service being down/mid-deploy rather than a real
 * per-candidate wait, since that model loads once at process startup, not
 * per request. Capped at 60s; whether or not it comes back ready, this page
 * always reaches "Ready" and moves on — the exam runs the same either way,
 * this is diagnostic/UX only, not a mode switch (there's no client-side
 * fallback to switch to in this mode).
 */
export default function NormalBrowserEnvironmentSetup() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const ranRef = useRef(false);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setStep((s) => (s + 1) % MESSAGES.length);
    }, CYCLE_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      try {
        await candidateApi.getTestDetails();
      } catch {
        toast.error('Session expired — please log in again');
        navigate('/test/login');
        return;
      }

      const deadline = Date.now() + MAX_WAIT_MS;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const { data } = await candidateApi.getServerDetectionReadiness();
          if (data.ready) break;
        } catch {
          // Treated the same as "not ready yet" — keep polling until the deadline.
        }
        if (Date.now() >= deadline) break;
        await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
      }

      setReady(true);
      window.setTimeout(() => navigate('/test/id-verification'), 700);
    })();
  }, [navigate]);

  const Icon = ICONS[step];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--admin-bg)' }}>
      <header className="bg-white border-b" style={{ borderColor: 'var(--admin-border)' }}>
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center">
          <button
            type="button"
            onClick={() => navigate('/test/system-check')}
            className="flex items-center gap-1.5 text-sm font-medium transition-colors"
            style={{ color: '#6B7280' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#111827')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="h-5 w-px bg-gray-200 mx-4" />
          <img src={talentstaQLogo} alt="TalentstaQ" style={{ height: '30px', width: 'auto' }} />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-6 text-center">
          <div
            className="relative w-20 h-20 rounded-full flex items-center justify-center"
            style={{ background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.06)' }}
          >
            <div
              className="absolute inset-0 rounded-full border-2"
              style={{ borderColor: 'var(--admin-border)', borderTopColor: 'var(--admin-accent)' }}
              key={ready ? 'ring-done' : 'ring-spin'}
            >
              {!ready && (
                <div
                  className="absolute inset-0 rounded-full border-2 animate-spin"
                  style={{ borderColor: 'transparent', borderTopColor: 'var(--admin-accent)' }}
                />
              )}
            </div>
            {ready ? (
              <Check className="w-8 h-8" style={{ color: 'var(--admin-accent)' }} strokeWidth={2.5} />
            ) : (
              <Icon key={step} className="w-8 h-8 animate-[icon-pop_0.4s_ease]" style={{ color: 'var(--admin-accent)' }} />
            )}
          </div>

          <div>
            <p className="text-base font-semibold" style={{ color: 'var(--admin-text)' }}>
              {ready ? 'Ready' : 'Getting your environment ready'}
            </p>
            <p className="text-sm mt-1" style={{ color: 'var(--admin-text-muted)', minHeight: '20px' }}>
              {ready ? 'Taking you to the next step…' : MESSAGES[step]}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
