import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { BrainCircuit, ScanFace, ShieldCheck, Sparkles, Check } from 'lucide-react';
import { candidateApi } from '../../services/api';
import { checkClientDetectionReadiness } from '../../services/clientDetectionReadiness';
import { useTestStore } from '../../context/testStore';
import talentstaQLogo from '../../assets/assessment-icons/icons/Talentstaq logo dark.svg';

// Cycled together: icon at ICONS[n] pairs with message at MESSAGES[n]. Purely
// cosmetic — real state is just "still checking" vs "done" — so the exact
// wording/order doesn't need to track actual load progress.
const ICONS = [BrainCircuit, ScanFace, ShieldCheck, Sparkles];
const MESSAGES = [
  'Setting up your environment…',
  'Calibrating detection models…',
  'Verifying proctoring signals…',
  'Almost ready…',
];
const CYCLE_MS = 1800;

/**
 * Page 2 of the SEB pre-exam flow: warms up the in-browser proctoring models
 * (yolo26n + MediaPipe gaze, see clientDetectionReadiness.ts), capped at 60s.
 * Whether that succeeds or not, this page always reaches "Ready" and moves
 * on — a candidate whose browser can't run the models still takes the exam,
 * just with server-side detection instead (testStore's forceServerDetection,
 * read by useProctoring.ts). Only reached when the test actually requires a
 * camera; SebSystemCheck.tsx skips straight to /test/instructions otherwise.
 */
function handleSebExit() {
  const sebQuitUrl = localStorage.getItem('sebQuitUrl');
  if (sebQuitUrl) {
    window.location.href = sebQuitUrl;
  }
}

export default function SebEnvironmentSetup() {
  const navigate = useNavigate();
  const setForceServerDetection = useTestStore((state) => state.setForceServerDetection);
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
      // Confirm we still have an authenticated candidate session (this page
      // is reached mid-flow, not straight after login) before doing any work.
      try {
        await candidateApi.getTestDetails();
      } catch {
        toast.error('Session expired — please log in again');
        navigate('/test/login');
        return;
      }

      const clientReady = await checkClientDetectionReadiness();
      setForceServerDetection(!clientReady);
      setReady(true);

      // Brief hold on the "Ready" state so it doesn't flash past unnoticed
      // when the models load quickly (the common case).
      window.setTimeout(() => navigate('/test/instructions'), 700);
    })();
  }, [navigate, setForceServerDetection]);

  const Icon = ICONS[step];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--admin-bg)' }}>
      <header className="bg-white border-b" style={{ borderColor: 'var(--admin-border)' }}>
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate('/test/system-check')}
              className="flex items-center gap-1.5 text-sm font-medium transition-colors"
              style={{ color: '#6B7280' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#111827')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}
            >
              Back
            </button>
            <div className="h-5 w-px bg-gray-200" />
            <img src={talentstaQLogo} alt="TalentstaQ" style={{ height: '30px', width: 'auto' }} />
          </div>
          <button
            type="button"
            onClick={handleSebExit}
            className="text-sm font-medium transition-colors"
            style={{ color: '#6B7280' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#111827')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}
          >
            Exit
          </button>
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
              {ready ? 'Taking you to the instructions…' : MESSAGES[step]}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
