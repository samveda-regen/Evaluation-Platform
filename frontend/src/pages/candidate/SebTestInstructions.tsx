import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { candidateApi } from '../../services/api';
import { useTestStore } from '../../context/testStore';
import { useAuthStore } from '../../context/authStore';
import IDVerification from '../../components/IDVerification';
import { clearCachedStreams, getCachedStreams, setCachedStreams } from '../../services/devicePermissionService';
import { requestScreenShare, getScreenShareErrorMessage } from '../../services/proctorService';
import { acquireVerifiedCameraStream, type CameraDiagnostics } from '../../services/cameraDeviceService';
import { DEFAULT_CUSTOM_AI_VIOLATIONS, normalizeCustomAIViolationSelection } from '../../constants/customAIViolations';
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

function getInitials(name?: string | null): string {
  if (!name) return 'U';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join('');
}

export default function TestInstructions() {
  const [testDetails, setTestDetails] = useState<TestDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [verificationComplete, setVerificationComplete] = useState(false);
  const [checkingVerification, setCheckingVerification] = useState(true);
  const [checkingDevices, setCheckingDevices] = useState(false);
  const [deviceReady, setDeviceReady] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState({
    camera: false,
    microphone: false,
    screenShare: false,
  });
  const [cameraPreviewStream, setCameraPreviewStream] = useState<MediaStream | null>(null);
  // True when a camera stream was obtained but never produced a real frame (e.g. an IR/
  // Windows Hello camera got picked, or the driver never warmed up) — distinct from "no
  // camera at all" so the UI can tell the candidate what's actually wrong.
  const [cameraFrameIssue, setCameraFrameIssue] = useState(false);
  // On-screen dump of the last camera-check attempt's raw diagnostics (device count,
  // labels, per-attempt getUserMedia error names) — same idea as the TEMPORARY block in
  // TestInterface.tsx's camera panel. This page has no SEB devtools console on most
  // configs, so a candidate/tester hitting "cannot access camera" here has no way to see
  // *which* failure it actually was (permission denied vs. camera busy vs. SEB's own
  // media-capture gate) without this being visible directly on screen.
  const [lastCameraDiagnostics, setLastCameraDiagnostics] = useState<CameraDiagnostics | null>(null);
  const [connectionLatency, setConnectionLatency] = useState<number | null>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);
  const navigate = useNavigate();
  const setTestData = useTestStore((state) => state.setTestData);
  const candidate = useAuthStore((state) => state.candidate);
  const handleSebExit = () => {
    const sebQuitUrl = localStorage.getItem('sebQuitUrl');

    if (sebQuitUrl) {
      window.location.href = sebQuitUrl;
    }
  };

  // Speaking questions need mic access independent of the (currently disabled) audio-proctoring
  // toggle — these are computed once here and reused everywhere the old inline
  // `test.requireMicrophone && !TEMP_DISABLE_AUDIO_PROCTORING` / `test.proctorEnabled` checks
  // used to gate the device-check flow, so a non-proctored test with a Speaking question still
  // asks for the mic upfront instead of the candidate hitting a prompt mid-exam.
  const needsSpeakingMic = testDetails?.test.hasSpeakingQuestion ?? false;
  const microphoneRequired = (!!testDetails?.test.requireMicrophone && !TEMP_DISABLE_AUDIO_PROCTORING) || needsSpeakingMic;
  const deviceCheckNeeded = !!testDetails?.test.proctorEnabled || needsSpeakingMic;
  const setCameraPreviewVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      cameraPreviewRef.current = el;
      if (el && cameraPreviewStream) {
        el.srcObject = cameraPreviewStream;
        el.play().catch(() => {});
      }
    },
    [cameraPreviewStream],
  );

  useEffect(() => {
    if (cameraPreviewRef.current && cameraPreviewStream) {
      cameraPreviewRef.current.srcObject = cameraPreviewStream;
      cameraPreviewRef.current.play().catch(() => {});
    }
  }, [cameraPreviewStream]);

  useEffect(() => {
    clearCachedStreams(true);
    loadTestDetails();
    measureConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warm up the AI proctoring models (TensorFlow.js WebGL backend + COCO-SSD/BlazeFace) while
  // the candidate is still reading instructions, not after they click Start Test. Loading these
  // models blocks the main thread for several seconds (WebGL shader compilation) — doing it here
  // means that freeze either finishes before Start Test is clicked, or is already well underway
  // by the time the "Setting up your environment" screen (handleStartTest) needs to wait on it.


  const measureConnection = async () => {
    const start = performance.now();
    try {
      const token = localStorage.getItem('candidateToken');
      await fetch('/api/candidate/test', {
        method: 'HEAD',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setConnectionLatency(Math.round(performance.now() - start));
    } catch {
      setConnectionLatency(null);
    }
  };

  const loadTestDetails = async () => {
    try {
      const { data } = await candidateApi.getTestDetails();
      setTestDetails(data);
      const verification = await candidateApi.checkVerificationRequired(data.test.id);
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
    if (deviceCheckNeeded && !deviceReady) {
      toast.error('Complete required device permission checks before starting');
      return;
    }
    if (deviceCheckNeeded && testDetails) {
      const cached = getCachedStreams();
      const missingCamera = testDetails.test.requireCamera && !cached.cameraStream;
      const missingMic = microphoneRequired && !cached.microphoneStream;
      const missingScreen = testDetails.test.requireScreenShare && !cached.screenStream;
      if (missingCamera || missingMic || missingScreen) {
        setDeviceReady(false);
        toast.error('Permissions expired or stopped. Run Device Readiness Check once before starting.');
        return;
      }
    }

    setStarting(true);
    try {
      // Finish the AI-proctoring model warm-up (usually already done from the effect above,
      // triggered while the candidate was reading instructions) before calling startTest(),
      // which stamps the exam's server-side start time — so environment setup never eats into
      // the candidate's actual test duration, and the "Setting up your environment" screen
      // below covers any remaining wait instead of it happening silently once they're timed.
     

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

  const checkDevicePermissions = async () => {
    if (!deviceCheckNeeded || !testDetails) {
      setDeviceReady(true);
      return;
    }
    setCheckingDevices(true);
    const required = testDetails.test;
    let cameraOk = !required.requireCamera;
    let microphoneOk = !microphoneRequired;
    let screenOk = !required.requireScreenShare;
    let cameraStream: MediaStream | null = null;
    let micStream: MediaStream | null = null;
    let screenStream: MediaStream | null = null;
    let screenShareErrorMessage: string | null = null;
    let cameraErrorMessage: string | null = null;
    let frameIssue = false;
    let cameraDiagnostics: CameraDiagnostics | null = null;

    if (required.requireCamera) {
      const result = await acquireVerifiedCameraStream({
        width: { ideal: 1280 },
        height: { ideal: 720 },
      });
      cameraDiagnostics = result.diagnostics;
      setLastCameraDiagnostics(cameraDiagnostics);
      // Fire-and-forget: report this from the pre-check itself, not just at exam start —
      // a candidate whose camera fails here never proceeds to the exam at all, so this is
      // the only chance to see what happened on their machine server-side.
      candidateApi
        .logActivity({ eventType: 'camera_precheck_diagnostics', eventData: cameraDiagnostics as unknown as Record<string, unknown> })
        .catch(() => {});
      if (result.stream) {
        cameraStream = result.stream;
        cameraOk = result.framesVerified;
        frameIssue = !result.framesVerified;
        if (!result.framesVerified) {
          cameraErrorMessage = 'Camera detected but not producing a picture — try a different camera or restart your browser.';
        }
      } else {
        cameraOk = false;
        cameraErrorMessage = 'Could not access camera — please allow camera permissions.';
      }
    }

    if (microphoneRequired) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        microphoneOk = micStream.getAudioTracks().length > 0;
      } catch {
        microphoneOk = false;
      }
    }

    if (required.requireScreenShare) {
      let screenShareErrorType: string | undefined;
      try {
        const displayStream = await requestScreenShare();
        screenOk = !!displayStream && displayStream.getVideoTracks().length > 0;
        screenStream = screenOk ? displayStream : null;
      } catch (err) {
        screenOk = false;
        screenShareErrorMessage = getScreenShareErrorMessage(err);
        screenShareErrorType = err instanceof Error ? err.name : undefined;
      }
      // Same reasoning as the camera diagnostics: report from wherever this ran, not
      // just on eventual success, so a hang on some machine shows up in server logs
      // without needing devtools access to that exact machine.
      candidateApi
        .logActivity({
          eventType: 'screenshare_precheck_diagnostics',
          eventData: {
            ok: screenOk,
            errorType: screenShareErrorType,
            errorMessage: screenShareErrorMessage,
          } as unknown as Record<string, unknown>,
        })
        .catch(() => {});
    }

    setDeviceStatus({ camera: cameraOk, microphone: microphoneOk, screenShare: screenOk });
    setCameraFrameIssue(frameIssue);
    const ready = cameraOk && microphoneOk && screenOk;
    setDeviceReady(ready);

    // Cache and preview whatever individually succeeded — a failing mic or screen share
    // check should never tear down a camera stream that's actually working, and vice
    // versa. The candidate still can't proceed (`ready` gates the Start button) until
    // every required device passes, but retrying one broken device doesn't force
    // re-granting permission for devices that already passed.
    setCachedStreams({ cameraStream, microphoneStream: micStream, screenStream, cameraDiagnostics });
    setCameraPreviewStream(cameraOk ? cameraStream : null);

    if (ready) toast.success('Device permission checks passed');
    else toast.error(
      cameraErrorMessage || screenShareErrorMessage || 'Required device permissions are not granted',
      { duration: 8000 },
    );

    setCheckingDevices(false);
  };

  if (loading || checkingVerification) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--admin-border)' }}>
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  if (!testDetails) return null;

  // Full-page takeover from the moment Start Test is clicked until the candidate lands on the
  // timed assessment page. Covers the AI-proctoring model warm-up (see handleStartTest) with an
  // explicit, expected wait instead of the browser silently freezing ("Page Unresponsive") right
  // as the exam begins — which is what led candidates to close the tab mid-setup.
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
          <p className="text-lg font-semibold text-gray-900">Setting up your environment</p>
          <p className="text-sm text-gray-500 mt-1">
            Please wait a few moments while we prepare your test session…
          </p>
        </div>
      </div>
    );
  }

  const { test } = testDetails;
  const initials = getInitials(candidate?.name);
  const totalQuestions =
    (test.questionCounts?.mcq ?? 0) +
    (test.questionCounts?.coding ?? 0) +
    (test.questionCounts?.behavioral ?? 0);
  const identityVerified = !verificationRequired || verificationComplete;

  const canStart =
    accepted &&
    !starting &&
    (!verificationRequired || verificationComplete) &&
    (!deviceCheckNeeded || deviceReady);

  const allChecksOk =
    (!test.requireCamera || deviceStatus.camera) &&
    (!microphoneRequired || deviceStatus.microphone) &&
    (!test.requireScreenShare || deviceStatus.screenShare);

  return (
    <div className="min-h-screen" style={{ background: 'var(--admin-border)' }}>
      {/* -- Header -- */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
  type="button"
  onClick={handleSebExit}
  className="flex items-center gap-1.5 text-sm font-medium transition-colors"
  style={{ color: '#6B7280' }}
  onMouseEnter={e => (e.currentTarget.style.color = '#111827')}
  onMouseLeave={e => (e.currentTarget.style.color = '#6B7280')}
>
  Exit
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
      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* ID verification gate (shown inline if still pending) */}
        {verificationRequired && !verificationComplete && (
          <div className="bg-white rounded-2xl p-6 shadow-sm mb-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">ID Verification Required</h2>
            <IDVerification
              onVerified={() => {
                setVerificationComplete(true);
                toast.success('Verification completed. You can start the test.');
              }}
              onSkip={() => {
                setVerificationComplete(true);
                toast.error(
                  'ID verification was skipped with admin authorization. Proceed with strict review.',
                );
              }}
              isOptional={false}
            />
          </div>
        )}

        {/* -- Two-column grid -- */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          {/* -- Left: Instructions -- */}
          <div className="bg-white rounded-2xl p-8 shadow-sm">
            <h1 className="text-2xl font-bold text-gray-900">Before you begin</h1>
            <p className="text-sm text-gray-500 mt-1">
              {test.name}
              {test.duration ? ` · ${test.duration} minutes` : ''}
              {totalQuestions > 0 ? ` · ${totalQuestions} questions` : ''}
            </p>

            <div className="mt-6 space-y-5">
              {/* Timed assessment */}
              <div className="flex items-start gap-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: '#FFF6EE' }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-5 h-5 text-amber-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.8}
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">Timed assessment</p>
                  <p className="text-gray-500 text-sm mt-0.5">
                    You have {test.duration} minutes. The test auto-submits when time runs out.
                  </p>
                </div>
              </div>

              {/* Proctored session */}
              <div className="flex items-start gap-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: '#FFF6EE' }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-5 h-5 text-amber-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.8}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">Proctored session</p>
                  <p className="text-gray-500 text-sm mt-0.5">
                    Your camera, microphone and screen are monitored by AI throughout.
                  </p>
                </div>
              </div>

              {/* Full-screen required */}
              <div className="flex items-start gap-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: '#FFF6EE' }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-5 h-5 text-amber-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.8}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">Full-screen required</p>
                  <p className="text-gray-500 text-sm mt-0.5">
                    The test runs in full-screen. Leaving it is recorded as a violation.
                  </p>
                </div>
              </div>

              {/* No external help */}
              <div className="flex items-start gap-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: '#FFF6EE' }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-5 h-5 text-amber-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.8}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">No external help</p>
                  <p className="text-gray-500 text-sm mt-0.5">
                    Switching tabs, copying, or a second person in frame will be flagged.
                  </p>
                </div>
              </div>

              {/* Default mouse cursor required — Safe Exam Browser refuses to start
                  a session if any Windows cursor (e.g. the "Hand" pointer) has been
                  swapped for a custom .cur file outside its own default cursor
                  folders, treating it as a tampering risk and aborting with
                  "Failed to ensure session integrity!" before the exam ever loads. */}
              <div className="flex items-start gap-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: '#FFF6EE' }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-5 h-5 text-amber-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.8}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 3l14 8-6.5 1.5L11 19 5 3z"
                    />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">Default mouse cursor required</p>
                  <p className="text-gray-500 text-sm mt-0.5">
                    If you use a custom cursor theme, Secure Exam Browser will fail to start.
                    Reset it to the Windows default first: Settings → Bluetooth &amp; devices →
                    Mouse → Additional mouse settings → Pointers tab → Scheme:
                    &quot;Windows Default (system scheme)&quot; → Apply.
                  </p>
                </div>
              </div>
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
          </div>

          {/* -- Right: System check -- */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col">
            {/* Camera area */}
            <div
              className="relative flex items-center justify-center"
              style={{ background: '#18181B', minHeight: 200 }}
            >
              {/* CAMERA OK badge */}
              {deviceStatus.camera && (
                <span
                  className="absolute top-3 left-3 text-white text-xs font-semibold px-2 py-0.5 rounded"
                  style={{ background: 'var(--admin-accent)', letterSpacing: '0.05em' }}
                >
                  CAMERA OK
                </span>
              )}

              {cameraPreviewStream ? (
                <div className="relative w-full" style={{ maxHeight: 200 }}>
                  <video
                    ref={setCameraPreviewVideo}
                    autoPlay
                    muted
                    playsInline
                    className="w-full object-cover"
                    style={{ maxHeight: 200, transform: 'scaleX(-1)' }}
                  />
                  {/* Oval face guide */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div
                      className="border-2 border-amber-400 rounded-full opacity-60"
                      style={{ width: '45%', height: '70%' }}
                    />
                  </div>
                </div>
              ) : cameraFrameIssue ? (
                <div className="text-center px-6">
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-2"
                    style={{ background: '#3F3F46' }}
                  >
                    <span className="text-white font-semibold text-xl">{initials}</span>
                  </div>
                  <p className="text-amber-400 text-xs font-medium">
                    Camera detected but no picture — try a different camera or restart your browser
                  </p>
                </div>
              ) : (
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ background: '#3F3F46' }}
                >
                  <span className="text-white font-semibold text-xl">{initials}</span>
                </div>
              )}
            </div>

            {/* System check list */}
            <div className="p-5 flex-1 flex flex-col">
              <p className="font-semibold text-gray-800 text-sm mb-4">System check</p>

              <div className="space-y-3">
                {/* Webcam */}
                <SystemCheckRow
                  icon={
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                    </svg>
                  }
                  label="Webcam"
                  status={
                    !test.requireCamera
                      ? 'not-required'
                      : checkingDevices
                        ? 'checking'
                        : deviceStatus.camera
                          ? 'ok'
                          : 'pending'
                  }
                  okLabel="Connected"
                  pendingLabel={test.requireCamera ? 'Pending' : 'Not required'}
                />

                {/* TEMPORARY diagnostic dump — remove once the SEB camera-access issue is
                    confirmed fixed. Same reasoning as the block in TestInterface.tsx's
                    camera panel: lets whoever's testing on a machine we have no remote
                    access to just screenshot the actual reason instead of the generic
                    "Could not access camera" toast. */}
                {test.requireCamera && !checkingDevices && !deviceStatus.camera && lastCameraDiagnostics && (
                  <div
                    className="text-left w-full rounded px-2 py-1.5"
                    style={{ background: 'rgba(0,0,0,0.85)', fontSize: '10px', lineHeight: 1.4, color: '#F59E0B', fontFamily: 'monospace' }}
                  >
                    <div>devicesFound: {lastCameraDiagnostics.devicesFound}</div>
                    <div>deviceLabels: {lastCameraDiagnostics.deviceLabels.join(', ') || '(none)'}</div>
                    <div>framesVerified: {String(lastCameraDiagnostics.framesVerified)}</div>
                    <div>chosenLabel: {lastCameraDiagnostics.chosenLabel || '(none)'}</div>
                    {lastCameraDiagnostics.attempts.map((a, i) => (
                      <div key={i}>
                        #{i} {a.label} framesOk={String(a.framesOk)} color={a.colorfulness.toFixed(1)}
                        {a.error ? ` error=${a.error}` : ''}
                      </div>
                    ))}
                  </div>
                )}

                {/* Microphone */}
                <SystemCheckRow
                  icon={
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 3a4 4 0 014 4v4a4 4 0 01-8 0V7a4 4 0 014-4z" />
                    </svg>
                  }
                  label="Microphone"
                  status={
                    !microphoneRequired
                      ? 'not-required'
                      : checkingDevices
                        ? 'checking'
                        : deviceStatus.microphone
                          ? 'ok'
                          : 'pending'
                  }
                  okLabel="Detected"
                  pendingLabel={microphoneRequired ? 'Pending' : 'Not required'}
                />

                {/* Screen share */}
                <SystemCheckRow
                  icon={
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  }
                  label="Screen share"
                  status={
                    !test.requireScreenShare
                      ? 'not-required'
                      : checkingDevices
                        ? 'checking'
                        : deviceStatus.screenShare
                          ? 'ok'
                          : 'pending'
                  }
                  okLabel="Granted"
                  pendingLabel={test.requireScreenShare ? 'Pending' : 'Not required'}
                />

                {/* Connection */}
                <SystemCheckRow
                  icon={
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
                    </svg>
                  }
                  label="Connection"
                  status={connectionLatency !== null ? 'ok' : 'checking'}
                  okLabel={connectionLatency !== null ? `Stable · ${connectionLatency}ms` : 'Stable'}
                  pendingLabel="Checking…"
                />
              </div>

              {/* Device check button (shown when proctoring or a Speaking question needs a device check, and not yet ready) */}
              {deviceCheckNeeded && !deviceReady && (
                <button
                  type="button"
                  onClick={checkDevicePermissions}
                  disabled={checkingDevices}
                  className="mt-4 w-full text-sm font-medium py-2 rounded-lg border transition-colors disabled:opacity-50"
                  style={
                    checkingDevices
                      ? { borderColor: '#E5E7EB', color: '#6B7280', background: 'white' }
                      : allChecksOk
                        ? { borderColor: '#A7F3D0', color: '#065F46', background: '#ECFDF5' }
                        : { borderColor: '#FECACA', color: '#991B1B', background: '#FEF2F2' }
                  }
                >
                  {checkingDevices ? 'Checking devices…' : 'Run System Check'}
                </button>
              )}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Divider */}
              <div className="border-t border-gray-100 my-4" />

              {/* Checkbox */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded accent-amber-500 flex-shrink-0"
                />
                <span className="text-xs text-gray-600 leading-relaxed">
                  I have read the instructions and I'm ready to start in full-screen mode.
                </span>
              </label>

              {/* Start button */}
              <button
                onClick={handleStartTest}
                disabled={!canStart}
                className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-opacity"
                style={{
                  background: canStart ? 'var(--admin-accent)' : '#9CA3AF',
                  color: 'white',
                  cursor: canStart ? 'pointer' : 'not-allowed',
                }}
              >
                {starting ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    Start assessment
                  </>
                )}
              </button>

              <p className="text-xs text-gray-400 text-center mt-2">
                Timer starts when you click start
              </p>
            </div>
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

type CheckStatus = 'ok' | 'pending' | 'checking' | 'not-required';

function SystemCheckRow({
  icon,
  label,
  status,
  okLabel,
  pendingLabel,
}: {
  icon: ReactNode;
  label: string;
  status: CheckStatus;
  okLabel: string;
  pendingLabel: string;
}) {
  const isOk = status === 'ok';
  const isChecking = status === 'checking';
  const isNotRequired = status === 'not-required';

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {isChecking ? (
          <span className="text-xs text-gray-400">Checking…</span>
        ) : isNotRequired ? (
          <span className="text-xs text-gray-400">Not required</span>
        ) : (
          <span
            className="text-xs font-medium"
            style={{ color: isOk ? '#059669' : '#DC2626' }}
          >
            {isOk ? okLabel : pendingLabel}
          </span>
        )}
        {(isOk || isNotRequired) && (
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: isOk ? '#A7F3D0' : '#D1D5DB' }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-3 h-3"
              viewBox="0 0 20 20"
              fill={isOk ? '#047857' : '#6B7280'}
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        )}
        {!isOk && !isNotRequired && !isChecking && (
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: '#FCA5A5' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 20 20" fill="#B91C1C">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        )}
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
      {count !== undefined && (
        <p className="text-xs text-gray-400">{count} Q</p>
      )}
    </div>
  );
}
