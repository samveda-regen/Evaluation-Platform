import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { BrainCircuit, ScanFace, ShieldCheck, Sparkles } from 'lucide-react';
import { candidateApi } from '../../services/api';
import { useTestStore } from '../../context/testStore';
import { checkClientDetectionReadiness } from '../../services/clientDetectionReadiness';
import { getCachedStreams } from '../../services/devicePermissionService';
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
  'Calibrating detection models…',
  'Verifying proctoring signals…',
  'Almost ready…',
];
const CYCLE_MS = 1800;
const FRAME_WAIT_TIMEOUT_MS = 5000;

function waitForVideoFrame(video: HTMLVideoElement, timeoutMs: number): Promise<boolean> {
  if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const onReady = () => {
      cleanup();
      resolve(true);
    };
    function cleanup() {
      window.clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('loadeddata', onReady);
    }
    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('loadeddata', onReady);
  });
}

/**
 * Page 2 of the SEB pre-exam flow (System Check → here → ID Verification →
 * Instructions → Start Assessment). Warms up the in-browser proctoring
 * models AND runs one real inference pass through each against the
 * candidate's own camera feed (clientDetectionReadiness.ts) — that real
 * inference call is what actually pays onnxruntime-web/MediaPipe's
 * first-call WASM graph-compile cost, not just loading the models, which is
 * why this is here rather than after Start Assessment: it happens well
 * before the exam timer starts (startTest() isn't called until the
 * Instructions page's Start button, same as before this feature existed),
 * and the warm session/landmarker objects persist in memory across the
 * ID-Verification/Instructions navigation that follows (no page reload
 * happens — this is client-side routing) all the way into the real exam.
 *
 * Always reaches "done" and moves on regardless of outcome — a candidate
 * whose browser can't run the models still takes the exam, just with
 * server-side detection instead (testStore's forceServerDetection, read by
 * useProctoring.ts). Only reached when the test requires a camera;
 * SebSystemCheck.tsx skips straight to /test/id-verification otherwise.
 */
export default function SebEnvironmentSetup() {
  const navigate = useNavigate();
  const setForceServerDetection = useTestStore((state) => state.setForceServerDetection);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
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

      let hadFrame = false;
      if (testDetails.test.requireCamera) {
        // Reuses SebSystemCheck.tsx's already-granted stream (this page follows it
        // immediately, so it's still fresh) rather than acquiring a new one — a second
        // concurrent getUserMedia() call here would be redundant, and critically this
        // stream must stay alive and NOT be stopped: useProctoring.ts reuses this exact
        // cached stream later for the real exam, so stopping it here would leave the
        // candidate's camera dead once the exam actually starts.
        const cameraStream = getCachedStreams().cameraStream;

        let primeSource: HTMLVideoElement | undefined;
        if (cameraStream && videoRef.current) {
          videoRef.current.srcObject = cameraStream;
          try {
            await videoRef.current.play();
          } catch {
            /* autoplay blocked in rare configs — priming just gets skipped below */
          }
          const gotFrame = await waitForVideoFrame(videoRef.current, FRAME_WAIT_TIMEOUT_MS);
          if (gotFrame) {
            primeSource = videoRef.current;
            hadFrame = true;
          }
        }

        const clientReady = await checkClientDetectionReadiness(primeSource);
        setForceServerDetection(!clientReady);

        // Diagnostic — see whether priming actually ran against a real frame or got
        // skipped, without needing devtools access to whatever machine hit this.
        candidateApi
          .logActivity({
            eventType: 'model_priming_diagnostics',
            eventData: {
              hadFrame,
              clientReady,
              durationMs: Math.round(performance.now() - startedAt),
            },
          })
          .catch(() => {});
      }

      setReady(true);
      window.setTimeout(() => navigate('/test/id-verification'), 500);
    })();
  }, [navigate, setForceServerDetection]);

  const Icon = ICONS[step];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--admin-bg)' }}>
      {/* Hidden — exists only so the priming step above has a real <video> element
          to read camera frames from; never shown to the candidate. */}
      <video ref={videoRef} muted playsInline style={{ display: 'none' }} />

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
