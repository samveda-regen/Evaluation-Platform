import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { BrainCircuit, ScanFace, ShieldCheck, Sparkles } from 'lucide-react';
import { candidateApi } from '../../services/api';
import { useTestStore } from '../../context/testStore';
import { getCachedStreams } from '../../services/devicePermissionService';
import { DEFAULT_CUSTOM_AI_VIOLATIONS, normalizeCustomAIViolationSelection } from '../../constants/customAIViolations';
import talentstaQLogo from '../../assets/assessment-icons/icons/Talentstaq logo dark.svg';
import TestInterface from './TestInterface';

const TEMP_DISABLE_AUDIO_PROCTORING = true;

interface TestDetails {
  test: {
    id: string;
    testCode: string;
    name: string;
    duration: number;
    totalMarks: number;
    negativeMarking: number;
    maxViolations: number;
    proctorEnabled: boolean;
    requireCamera: boolean;
    requireMicrophone: boolean;
    requireScreenShare: boolean;
    hasSpeakingQuestion: boolean;
    customAIViolations?: string[];
    violationPopupSettings?: unknown;
    showTimer?: boolean;
    autoSubmitOnTimeout?: boolean;
  };
  attempt: {
    id: string;
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
 * Mounted at /test/start for normal-browser tests instead of TestInterface
 * directly — the normal-browser counterpart to SebTestStart.tsx. That page
 * primes in-browser models per candidate; this mode never runs detection
 * client-side (detectionMode is always 'server' for NORMAL_BROWSER tests),
 * so there's nothing per-candidate to warm up here — this just polls
 * whether the shared python_cv_service backend is up (mostly useful for
 * catching it being down/mid-deploy), capped at 60s, before calling
 * startTest() and rendering the exam. Diagnostic only — the exam runs the
 * same either way, there's no client-side fallback to switch to.
 */
export default function NormalBrowserTestStart() {
  const navigate = useNavigate();
  const setTestData = useTestStore((state) => state.setTestData);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(0);
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
      let testDetails: TestDetails;
      try {
        const { data } = await candidateApi.getTestDetails();
        testDetails = data;
      } catch {
        toast.error('Failed to load test details');
        navigate('/test/login');
        return;
      }

      const needsSpeakingMic = testDetails.test.hasSpeakingQuestion ?? false;
      const microphoneRequired =
        (!!testDetails.test.requireMicrophone && !TEMP_DISABLE_AUDIO_PROCTORING) || needsSpeakingMic;
      const deviceCheckNeeded = !!testDetails.test.proctorEnabled || needsSpeakingMic;

      if (deviceCheckNeeded) {
        const cached = getCachedStreams();
        const missingCamera = testDetails.test.requireCamera && !cached.cameraStream;
        const missingMic = microphoneRequired && !cached.microphoneStream;
        const missingScreen = testDetails.test.requireScreenShare && !cached.screenStream;
        if (missingCamera || missingMic || missingScreen) {
          toast.error('Device permissions expired — please run the system check again.', { duration: 6000 });
          navigate('/test/system-check');
          return;
        }
      }

      if (testDetails.test.requireCamera) {
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
      }

      try {
        const { data } = await candidateApi.startTest();
        const savedAnswers = await candidateApi.getSavedAnswers();
        setTestData({
          testId: data.test.id,
          testCode: testDetails.test.testCode,
          attemptId: testDetails.attempt.id,
          testName: data.test.name,
          duration: data.test.duration,
          totalMarks: data.test.totalMarks,
          negativeMarking: data.test.negativeMarking,
          maxViolations: data.test.maxViolations,
          proctorEnabled: data.test.proctorEnabled,
          requireCamera: data.test.requireCamera,
          requireMicrophone: microphoneRequired,
          requireScreenShare: data.test.requireScreenShare,
          assessmentMode: 'NORMAL_BROWSER',
          customAIViolations: normalizeCustomAIViolationSelection(
            data.test.customAIViolations || DEFAULT_CUSTOM_AI_VIOLATIONS,
          ),
          violationPopupSettings: (() => {
            try {
              const raw = data.test.violationPopupSettings;
              const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
              if (
                parsed &&
                typeof parsed.enabled === 'boolean' &&
                typeof parsed.durationSeconds === 'number'
              ) {
                return { enabled: parsed.enabled, durationSeconds: parsed.durationSeconds };
              }
            } catch {
              /* ignore */
            }
            return { enabled: false, durationSeconds: 2 };
          })(),
          startTime: new Date(data.startTime),
          questions: data.questions,
          initialViolations: 0,
          showTimer: data.test.showTimer,
          autoSubmitOnTimeout: data.test.autoSubmitOnTimeout,
        });
        if (
          savedAnswers.data.mcqAnswers.length > 0 ||
          savedAnswers.data.codingAnswers.length > 0 ||
          savedAnswers.data.behavioralAnswers.length > 0 ||
          (savedAnswers.data.communicationAnswers?.length ?? 0) > 0
        ) {
          useTestStore
            .getState()
            .loadSavedAnswers(
              savedAnswers.data.mcqAnswers,
              savedAnswers.data.codingAnswers,
              savedAnswers.data.behavioralAnswers,
              savedAnswers.data.communicationAnswers ?? [],
            );
        }
        setReady(true);
      } catch (error: unknown) {
        const err = error as { response?: { data?: { error?: string } } };
        toast.error(err.response?.data?.error || 'Failed to start test');
        navigate('/test/instructions');
      }
    })();
  }, [navigate, setTestData]);

  if (ready) return <TestInterface />;

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
              className="absolute inset-0 rounded-full border-2 animate-spin"
              style={{ borderColor: 'transparent', borderTopColor: 'var(--admin-accent)' }}
            />
            <Icon key={step} className="w-8 h-8 animate-[icon-pop_0.4s_ease]" style={{ color: 'var(--admin-accent)' }} />
          </div>

          <div>
            <p className="text-base font-semibold" style={{ color: 'var(--admin-text)' }}>
              Getting your environment ready
            </p>
            <p className="text-sm mt-1" style={{ color: 'var(--admin-text-muted)', minHeight: '20px' }}>
              {MESSAGES[step]}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
