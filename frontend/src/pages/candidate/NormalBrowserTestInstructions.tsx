import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { candidateApi } from '../../services/api';
import { getCachedStreams } from '../../services/devicePermissionService';
import talentstaQLogo from '../../assets/assessment-icons/icons/Talentstaq logo dark.svg';

interface TestDetails {
  test: {
    id: string;
    testCode: string;
    name: string;
    description?: string;
    instructions?: string;
    duration: number;
    totalMarks: number;
    passingMarks?: number;
    negativeMarking: number;
    maxViolations: number;
    proctorEnabled: boolean;
    requireCamera: boolean;
    requireMicrophone: boolean;
    requireScreenShare: boolean;
    assessmentMode: 'SEB' | 'NORMAL_BROWSER';
    hasSpeakingQuestion: boolean;
    customAIViolations?: string[];
    questionCounts?: { mcq?: number; coding?: number; behavioral?: number };
  };
  attempt: {
    id: string;
    startTime: string;
    status: string;
    violations: number;
  };
}

const TEMP_DISABLE_AUDIO_PROCTORING = true;

/**
 * Page 4 (final) of the normal-browser pre-exam flow — the normal-browser
 * counterpart to SebTestInstructions.tsx. Instructions, the terms checkbox,
 * and the Start button only — device/detection readiness and identity
 * verification are handled by the three pages before this one
 * (NormalBrowserSystemCheck.tsx, NormalBrowserTestStart.tsx's "Setting up"
 * gate, NormalBrowserIdVerification.tsx), which a candidate must pass
 * through first — this page just trusts that work is done (with a
 * redirect-back safety net below for verification, and the
 * streams-still-cached check in handleStartTest for devices) rather than
 * re-doing or re-rendering any of it.
 */
export default function TestInstructions() {
  const [testDetails, setTestDetails] = useState<TestDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [verificationComplete, setVerificationComplete] = useState(false);
  const [checkingVerification, setCheckingVerification] = useState(true);
  const navigate = useNavigate();

  // Speaking questions need mic access independent of the (currently disabled) audio-proctoring
  // toggle — kept here (not just in NormalBrowserSystemCheck.tsx) because handleStartTest's
  // cached-stream check below needs the same definition to know what "still granted" means.
  const needsSpeakingMic = testDetails?.test.hasSpeakingQuestion ?? false;
  const microphoneRequired =
    (!!testDetails?.test.requireMicrophone && !TEMP_DISABLE_AUDIO_PROCTORING) || needsSpeakingMic;
  const deviceCheckNeeded = !!testDetails?.test.proctorEnabled || needsSpeakingMic;

  useEffect(() => {
    loadTestDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTestDetails = async () => {
    try {
      const { data } = await candidateApi.getTestDetails();
      setTestDetails(data);
      const verification = await candidateApi.checkVerificationRequired(data.test.id);
      // Safety net: this page trusts NormalBrowserIdVerification.tsx already handled
      // verification, but a candidate reaching this page directly (bookmarked URL,
      // browser back/forward) without having done so gets bounced back there rather
      // than seeing a broken Start button with no way to satisfy it.
      if (verification.data.required && !verification.data.canProceed) {
        navigate('/test/id-verification', { replace: true });
        return;
      }
      setVerificationRequired(verification.data.required);
      setVerificationComplete(verification.data.canProceed);
    } catch {
      toast.error('Failed to load test details');
      navigate('/test/login');
    } finally {
      setLoading(false);
      setCheckingVerification(false);
    }
  };

  // startTest()/setTestData() no longer happen here — they've moved to
  // NormalBrowserTestStart.tsx, which runs after this button navigates, so
  // that the server-side start time (and the candidate's exam timer) is
  // stamped only once the "Setting up your environment" gate there actually
  // clears, not at the moment this button is clicked. This is just validation.
  const handleStartTest = () => {
    if (!accepted) {
      toast.error('Please accept the terms and conditions');
      return;
    }
    if (verificationRequired && !verificationComplete) {
      toast.error('Identity verification is required before starting this test');
      return;
    }
    if (deviceCheckNeeded && testDetails) {
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

    navigate('/test/start');
  };

  if (loading || checkingVerification) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--admin-border)' }}>
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  if (!testDetails) return null;

  const { test } = testDetails;
  const totalQuestions =
    (test.questionCounts?.mcq ?? 0) +
    (test.questionCounts?.coding ?? 0) +
    (test.questionCounts?.behavioral ?? 0);
  const identityVerified = !verificationRequired || verificationComplete;

  const canStart = accepted && (!verificationRequired || verificationComplete);

  return (
    <div className="min-h-screen" style={{ background: 'var(--admin-border)' }}>
      {/* -- Header -- */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-1.5 text-sm font-medium transition-colors"
              style={{ color: '#6B7280' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#111827')}
              onMouseLeave={e => (e.currentTarget.style.color = '#6B7280')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <div className="h-5 w-px bg-gray-200" />
            <div className="flex items-center gap-3">
              <img src={talentstaQLogo} alt="TalentstaQ" style={{ height: '34px', width: 'auto' }} />
            </div>
          </div>
          {identityVerified && (
            <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--admin-accent)' }}>
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: 'var(--admin-accent)' }}
              />
              Identity verified
            </div>
          )}
        </div>
      </header>

      {/* -- Body -- */}
      <main className="max-w-3xl mx-auto px-6 py-8">
        {/* -- Instructions -- */}
        <div className="bg-white rounded-2xl p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900">Before you begin</h1>
          <p className="text-sm text-gray-500 mt-1">
            {test.name}
            {test.duration ? ` · ${test.duration} minutes` : ''}
            {totalQuestions > 0 ? ` · ${totalQuestions} questions` : ''}
          </p>

          <div className="mt-6 space-y-5">
            <InstructionRow
              path="M12 7v5l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              title="Timed assessment"
              description={`You have ${test.duration} minutes. The test auto-submits when time runs out.`}
            />
            <InstructionRow
              path="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              title="Proctored session"
              description="Your camera, microphone and screen are monitored by AI throughout."
            />
            <InstructionRow
              path="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              title="Full-screen required"
              description="The test runs in full-screen. Leaving it is recorded as a violation."
            />
            <InstructionRow
              path="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              title="No external help"
              description="Switching tabs, copying, or a second person in frame will be flagged."
            />
          </div>

          {/* Custom instructions */}
          {test.instructions && (
            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                Additional Instructions
              </p>
              <pre className="whitespace-pre-wrap font-sans text-sm text-gray-600">
                {test.instructions}
              </pre>
            </div>
          )}

          {/* Checkbox + Start */}
          <div className="mt-8 pt-6 border-t border-gray-100">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded accent-amber-500 flex-shrink-0"
              />
              <span className="text-sm text-gray-600 leading-relaxed">
                I have read the instructions and I&apos;m ready to start.
              </span>
            </label>

            <button
              onClick={handleStartTest}
              disabled={!canStart}
              className="mt-4 w-full sm:w-auto flex items-center justify-center gap-2 py-3 px-8 rounded-xl font-semibold text-sm transition-opacity"
              style={{
                background: canStart ? 'var(--admin-accent)' : '#9CA3AF',
                color: 'white',
                cursor: canStart ? 'pointer' : 'not-allowed',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              Start assessment
            </button>

            <p className="text-xs text-gray-400 mt-2">Timer starts when you click start</p>
          </div>
        </div>

        {/* -- Question mix card -- */}
        <div className="bg-white rounded-2xl p-6 mt-6 shadow-sm">
          <p className="font-semibold text-gray-800 mb-5">Question mix</p>
          <div className="flex flex-wrap gap-8">
            <QuestionMixItem
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              }
              color="var(--admin-accent-hover)"
              bg="#FFF6EE"
              label="Multiple choice"
              count={test.questionCounts?.mcq}
            />
            <QuestionMixItem
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
              }
              color="#C2410C"
              bg="#FFF6EE"
              label="Coding"
              count={test.questionCounts?.coding}
            />
            <QuestionMixItem
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              }
              color="var(--admin-accent-hover)"
              bg="#FFF6EE"
              label="Behavioral"
              count={test.questionCounts?.behavioral}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

/* -- Helper components -- */

function InstructionRow({ path, title, description }: { path: string; title: string; description: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#FFF6EE' }}>
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d={path} />
        </svg>
      </div>
      <div>
        <p className="font-semibold text-gray-900 text-sm">{title}</p>
        <p className="text-gray-500 text-sm mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function QuestionMixItem({
  icon,
  color,
  bg,
  label,
  count,
}: {
  icon: React.ReactNode;
  color: string;
  bg: string;
  label: string;
  count?: number;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center"
        style={{ background: bg, color }}
      >
        {icon}
      </div>
      <p className="text-sm font-medium text-gray-700 text-center">{label}</p>
      <p className="text-xs text-gray-400 text-center">{count ?? 0} questions</p>
    </div>
  );
}
