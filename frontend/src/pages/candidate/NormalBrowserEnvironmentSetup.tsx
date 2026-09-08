import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { BrainCircuit, ScanFace, ShieldCheck, Sparkles } from 'lucide-react';
import { candidateApi } from '../../services/api';
import talentstaQLogo from '../../assets/assessment-icons/icons/Talentstaq logo dark.svg';

interface TestDetails {
  test: {
    id: string;
    requireCamera: boolean;
  };
}

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
 * Page 2 of the normal-browser pre-exam flow — the normal-browser
 * counterpart to SebEnvironmentSetup.tsx. That page primes in-browser models
 * per candidate; this mode never runs detection client-side (detectionMode
 * is always 'server' for NORMAL_BROWSER tests), so there's nothing
 * per-candidate to warm up here — this just polls whether the shared
 * python_cv_service backend is up (mostly useful for catching it being
 * down/mid-deploy), capped at 60s, before moving on to ID Verification.
 * Diagnostic only — the exam runs the same either way, there's no
 * client-side fallback to switch to.
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
      const startedAt = performance.now();
      let testDetails: TestDetails;
      try {
        const { data } = await candidateApi.getTestDetails();
        testDetails = data;
      } catch {
        toast.error('Session expired — please log in again');
        navigate('/test/login');
        return;
      }

      if (testDetails.test.requireCamera) {
        const deadline = Date.now() + MAX_WAIT_MS;
        let becameReady = false;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          try {
            const { data } = await candidateApi.getServerDetectionReadiness();
            if (data.ready) {
              becameReady = true;
              break;
            }
          } catch {
            // Treated the same as "not ready yet" — keep polling until the deadline.
          }
          if (Date.now() >= deadline) break;
          await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
        }

        candidateApi
          .logActivity({
            eventType: 'server_detection_readiness_diagnostics',
            eventData: { becameReady, durationMs: Math.round(performance.now() - startedAt) },
          })
          .catch(() => {});
      }

      setReady(true);
      window.setTimeout(() => navigate('/test/id-verification'), 500);
    })();
  }, [navigate]);

  const Icon = ICONS[step];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--admin-bg)' }}>
      <header className="bg-white border-b" style={{ borderColor: 'var(--admin-border)' }}>
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center">
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
            <Icon key={step} className="w-8 h-8 animate-[icon-pop_0.4s_ease]" style={{ color: 'var(--admin-accent)' }} />
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
