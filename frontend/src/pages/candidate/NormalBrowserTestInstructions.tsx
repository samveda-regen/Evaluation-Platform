import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { ChevronLeft, Clock, Eye, Lock, AlertTriangle, ClipboardCheck, Code2, MessageSquare, Languages } from 'lucide-react';
import { candidateApi } from '../../services/api';
import { useTestStore } from '../../context/testStore';
import { getCachedStreams } from '../../services/devicePermissionService';
import { DEFAULT_CUSTOM_AI_VIOLATIONS, normalizeCustomAIViolationSelection } from '../../constants/customAIViolations';
import TestInstructionsCard, { type InstructionItem, type QuestionMixEntry } from './TestInstructionsCard';
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
    questionCounts?: { mcq?: number; coding?: number; behavioral?: number; communication?: number };
  };
  attempt: {
    id: string;
    startTime: string;
    status: string;
    violations: number;
  };
}

/**
 * Page 4 (final) of the normal-browser pre-exam flow — the normal-browser
 * counterpart to SebTestInstructions.tsx. Instructions, the terms checkbox,
 * and the Start button only — device/detection readiness and identity
 * verification are handled by the three pages before this one
 * (NormalBrowserSystemCheck.tsx, NormalBrowserEnvironmentSetup.tsx,
 * NormalBrowserIdVerification.tsx), which a candidate must pass through
 * first — this page just trusts that work is done (with a redirect-back
 * safety net below for verification, and the streams-still-cached check in
 * handleStartTest for devices) rather than re-doing or re-rendering any of it.
 */
export default function TestInstructions() {
  const [testDetails, setTestDetails] = useState<TestDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [verificationComplete, setVerificationComplete] = useState(false);
  const [checkingVerification, setCheckingVerification] = useState(true);
  const navigate = useNavigate();
  const setTestData = useTestStore((state) => state.setTestData);

  // Mirrors the test's own requireMicrophone setting (plus speaking questions, which
  // always need mic access regardless) — kept here (not just in
  // NormalBrowserSystemCheck.tsx) because handleStartTest's cached-stream check below
  // needs the same definition to know what "still granted" means. This only decides
  // whether the mic gets requested/published (audio ends up in the recording);
  // audio-based VIOLATION analysis is a separate, independent switch inside
  // useProctoring.ts, unaffected by this value.
  const needsSpeakingMic = testDetails?.test.hasSpeakingQuestion ?? false;
  const microphoneRequired = !!testDetails?.test.requireMicrophone || needsSpeakingMic;
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

  const handleStartTest = async () => {
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

    setStarting(true);
    try {
      const { data } = await candidateApi.startTest();
      const savedAnswers = await candidateApi.getSavedAnswers();
      setTestData({
        testId: data.test.id,
        testCode: testDetails!.test.testCode,
        attemptId: testDetails!.attempt.id,
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
      navigate('/test/start');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to start test');
      setStarting(false);
    }
  };

  if (loading || checkingVerification) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--admin-border)' }}>
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  if (!testDetails) return null;

  if (starting) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-6 px-4"
        style={{ background: 'var(--admin-border)' }}
      >
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-4 border-amber-200" />
          <div className="absolute inset-0 rounded-full border-4 border-amber-500 border-t-transparent animate-spin" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-900">Starting your assessment</p>
          <p className="text-sm text-gray-500 mt-1">Just a moment…</p>
        </div>
      </div>
    );
  }

  const { test } = testDetails;
  const totalQuestions =
    (test.questionCounts?.mcq ?? 0) +
    (test.questionCounts?.coding ?? 0) +
    (test.questionCounts?.behavioral ?? 0) +
    (test.questionCounts?.communication ?? 0);
  const identityVerified = !verificationRequired || verificationComplete;

  const canStart = accepted && !starting && (!verificationRequired || verificationComplete);

  const instructionItems: InstructionItem[] = [
    {
      key: 'timed',
      icon: <Clock className="w-5 h-5" aria-hidden="true" />,
      title: 'Timed assessment',
      description: `You have ${test.duration} minutes. The test auto-submits when time runs out.`,
      tone: 'orange',
    },
    {
      key: 'proctored',
      icon: <Eye className="w-5 h-5" aria-hidden="true" />,
      title: 'Proctored session',
      description: 'Your camera, microphone and screen are monitored by AI throughout.',
      tone: 'blue',
    },
    {
      key: 'fullscreen',
      icon: <Lock className="w-5 h-5" aria-hidden="true" />,
      title: 'Full-screen required',
      description: 'The test runs in full-screen. Leaving it is recorded as a violation.',
      tone: 'blue',
    },
    {
      key: 'no-help',
      icon: <AlertTriangle className="w-5 h-5" aria-hidden="true" />,
      title: 'No external help',
      description: 'Switching tabs, copying, or a second person in frame will be flagged.',
      tone: 'amber',
    },
  ];

  const questionMix: QuestionMixEntry[] = [
    { key: 'mcq', icon: <ClipboardCheck className="w-5 h-5" aria-hidden="true" />, label: 'Multiple choice', count: test.questionCounts?.mcq },
    { key: 'coding', icon: <Code2 className="w-5 h-5" aria-hidden="true" />, label: 'Coding', count: test.questionCounts?.coding },
    { key: 'behavioral', icon: <MessageSquare className="w-5 h-5" aria-hidden="true" />, label: 'Behavioral', count: test.questionCounts?.behavioral },
    { key: 'communication', icon: <Languages className="w-5 h-5" aria-hidden="true" />, label: 'Communication', count: test.questionCounts?.communication },
  ].filter((entry) => (entry.count ?? 0) > 0);

  return (
    <div className="min-h-screen" style={{ background: '#F3F6FB' }}>
      {/* -- Header -- */}
      <header className="bg-white border-b" style={{ borderColor: 'var(--admin-border-soft)' }}>
        <div className="max-w-[1160px] mx-auto px-6 sm:px-10 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-1 text-sm font-medium transition-colors rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{ color: '#6B7280' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#111827')}
              onMouseLeave={e => (e.currentTarget.style.color = '#6B7280')}
              aria-label="Go back"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              Back
            </button>
            <div className="h-5 w-px bg-gray-200" />
            <img src={talentstaQLogo} alt="TalentstaQ" style={{ height: '28px', width: 'auto' }} />
          </div>
          {identityVerified && (
            <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--admin-text-subtle)' }}>
              <span className="w-2 h-2 rounded-full" style={{ background: '#22C55E' }} aria-hidden="true" />
              Identity verified
            </div>
          )}
        </div>
      </header>

      {/* -- Body -- */}
      <main className="px-4 sm:px-6 py-6 sm:py-8">
        <TestInstructionsCard
          testName={test.name}
          duration={test.duration}
          totalQuestions={totalQuestions}
          instructionItems={instructionItems}
          customInstructions={test.instructions}
          accepted={accepted}
          onAcceptedChange={setAccepted}
          checkboxLabel="I have read the instructions and I'm ready to start."
          canStart={canStart}
          onStart={handleStartTest}
          questionMix={questionMix}
        />
      </main>
    </div>
  );
}
