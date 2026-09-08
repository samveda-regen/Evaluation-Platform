import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Mic, Video, MonitorUp, Wifi, Check, X, Settings2 } from 'lucide-react';
import { candidateApi } from '../../services/api';
import { clearCachedStreams, setCachedStreams } from '../../services/devicePermissionService';
import { requestScreenShare, getScreenShareErrorMessage } from '../../services/proctorService';
import { acquireVerifiedCameraStream, type CameraDiagnostics } from '../../services/cameraDeviceService';
import talentstaQLogo from '../../assets/assessment-icons/icons/Talentstaq logo dark.svg';

const TEMP_DISABLE_AUDIO_PROCTORING = true;

interface TestDetails {
  test: {
    id: string;
    testCode: string;
    proctorEnabled: boolean;
    requireCamera: boolean;
    requireMicrophone: boolean;
    requireScreenShare: boolean;
    hasSpeakingQuestion: boolean;
  };
}

type CheckStatus = 'idle' | 'checking' | 'ok' | 'failed' | 'not-required';

/**
 * Page 1 of the normal-browser pre-exam flow: device readiness only (camera,
 * mic, screen share, connection) — the normal-browser counterpart to
 * SebSystemCheck.tsx. No Exit button here (unlike the SEB version, this runs
 * in a regular browser tab, not a locked-down kiosk browser); Back just goes
 * up the browser history, matching this flow's original convention.
 *
 * Next: always /test/id-verification. Server-detection readiness no longer
 * has its own page here — it happens at /test/start
 * (NormalBrowserTestStart.tsx), directly before the exam renders.
 */
export default function NormalBrowserSystemCheck() {
  const navigate = useNavigate();
  const [testDetails, setTestDetails] = useState<TestDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingDevices, setCheckingDevices] = useState(false);
  const [hasRunOnce, setHasRunOnce] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState({ camera: false, microphone: false, screenShare: false });
  const [cameraFrameIssue, setCameraFrameIssue] = useState(false);
  const [lastCameraDiagnostics, setLastCameraDiagnostics] = useState<CameraDiagnostics | null>(null);
  const [cameraPreviewStream, setCameraPreviewStream] = useState<MediaStream | null>(null);
  const [connectionLatency, setConnectionLatency] = useState<number | null>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);

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
    (async () => {
      try {
        const { data } = await candidateApi.getTestDetails();
        setTestDetails(data);
      } catch {
        toast.error('Failed to load test details');
        navigate('/test/login');
      } finally {
        setLoading(false);
      }
    })();

    const start = performance.now();
    const token = localStorage.getItem('candidateToken');
    fetch('/api/candidate/test', { method: 'HEAD', headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(() => setConnectionLatency(Math.round(performance.now() - start)))
      .catch(() => setConnectionLatency(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const needsSpeakingMic = testDetails?.test.hasSpeakingQuestion ?? false;
  const microphoneRequired =
    (!!testDetails?.test.requireMicrophone && !TEMP_DISABLE_AUDIO_PROCTORING) || needsSpeakingMic;
  const deviceCheckNeeded = !!testDetails?.test.proctorEnabled || needsSpeakingMic;

  const runSystemCheck = async () => {
    if (!testDetails) return;
    setCheckingDevices(true);
    setHasRunOnce(true);
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
      const result = await acquireVerifiedCameraStream({ width: { ideal: 1280 }, height: { ideal: 720 } });
      cameraDiagnostics = result.diagnostics;
      setLastCameraDiagnostics(cameraDiagnostics);
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
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
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
      candidateApi
        .logActivity({
          eventType: 'screenshare_precheck_diagnostics',
          eventData: { ok: screenOk, errorType: screenShareErrorType, errorMessage: screenShareErrorMessage } as unknown as Record<string, unknown>,
        })
        .catch(() => {});
    }

    setDeviceStatus({ camera: cameraOk, microphone: microphoneOk, screenShare: screenOk });
    setCameraFrameIssue(frameIssue);
    setCachedStreams({ cameraStream, microphoneStream: micStream, screenStream, cameraDiagnostics });
    setCameraPreviewStream(cameraOk ? cameraStream : null);

    const ready = cameraOk && microphoneOk && screenOk;
    if (ready) toast.success('Device checks passed');
    else toast.error(cameraErrorMessage || screenShareErrorMessage || 'Required device permissions are not granted', { duration: 8000 });

    setCheckingDevices(false);
  };

  const allChecksOk =
    !!testDetails &&
    (!testDetails.test.requireCamera || deviceStatus.camera) &&
    (!microphoneRequired || deviceStatus.microphone) &&
    (!testDetails.test.requireScreenShare || deviceStatus.screenShare);

  const canProceed = !deviceCheckNeeded || allChecksOk;

  const handleNext = () => {
    if (!testDetails) return;
    navigate('/test/id-verification');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--admin-bg)' }}>
        <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--admin-border)', borderTopColor: 'var(--admin-accent)' }} />
      </div>
    );
  }

  if (!testDetails) return null;
  const { test } = testDetails;

  const tiles: Array<{
    tileKey: string;
    icon: React.ReactNode;
    label: string;
    status: CheckStatus;
    okLabel: string;
    failLabel: string;
    preview?: React.ReactNode;
  }> = [];

  tiles.push({
    tileKey: 'camera',
    icon: <Video className="w-6 h-6" />,
    label: 'Webcam',
    status: !test.requireCamera ? 'not-required' : checkingDevices ? 'checking' : !hasRunOnce ? 'idle' : deviceStatus.camera ? 'ok' : 'failed',
    okLabel: 'Connected',
    failLabel: cameraFrameIssue ? 'No picture' : 'Not detected',
    preview: cameraPreviewStream ? (
      <video ref={setCameraPreviewVideo} autoPlay muted playsInline className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
    ) : undefined,
  });

  tiles.push({
    tileKey: 'microphone',
    icon: <Mic className="w-6 h-6" />,
    label: 'Microphone',
    status: !microphoneRequired ? 'not-required' : checkingDevices ? 'checking' : !hasRunOnce ? 'idle' : deviceStatus.microphone ? 'ok' : 'failed',
    okLabel: 'Detected',
    failLabel: 'Not detected',
  });

  tiles.push({
    tileKey: 'screen',
    icon: <MonitorUp className="w-6 h-6" />,
    label: 'Screen share',
    status: !test.requireScreenShare ? 'not-required' : checkingDevices ? 'checking' : !hasRunOnce ? 'idle' : deviceStatus.screenShare ? 'ok' : 'failed',
    okLabel: 'Granted',
    failLabel: 'Not granted',
  });

  tiles.push({
    tileKey: 'connection',
    icon: <Wifi className="w-6 h-6" />,
    label: 'Connection',
    status: connectionLatency !== null ? 'ok' : 'checking',
    okLabel: connectionLatency !== null ? `Stable · ${connectionLatency}ms` : 'Stable',
    failLabel: 'Checking…',
  });

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--admin-bg)' }}>
      <header className="bg-white border-b" style={{ borderColor: 'var(--admin-border)' }}>
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center">
          <button
            type="button"
            onClick={() => navigate(-1)}
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

      <main className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-3xl">
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-8 pt-8 pb-6 flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--admin-bg)', color: 'var(--admin-accent)' }}
              >
                <Settings2 className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-lg font-bold" style={{ color: 'var(--admin-text)' }}>System check</h1>
                <p className="text-sm" style={{ color: 'var(--admin-text-muted)' }}>
                  Checking your requirements before the assessment
                </p>
              </div>
            </div>

            <div className="px-8 pb-8">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {tiles.map((tile) => (
                  <CheckTile key={tile.tileKey} {...tile} />
                ))}
              </div>

              {test.requireCamera && !checkingDevices && hasRunOnce && !deviceStatus.camera && lastCameraDiagnostics && (
                <div
                  className="mt-4 text-left w-full rounded-lg px-3 py-2"
                  style={{ background: '#FEF2F2', fontSize: '11px', lineHeight: 1.5, color: '#991B1B' }}
                >
                  <div>Devices found: {lastCameraDiagnostics.devicesFound}</div>
                  <div>Device labels: {lastCameraDiagnostics.deviceLabels.join(', ') || '(none)'}</div>
                  <div>Frames verified: {String(lastCameraDiagnostics.framesVerified)}</div>
                </div>
              )}
            </div>

            <div
              className="px-8 py-5 flex items-center justify-between border-t"
              style={{ borderColor: 'var(--admin-border)', background: 'var(--admin-bg)' }}
            >
              <p className="text-xs" style={{ color: 'var(--admin-text-subtle)' }}>
                {deviceCheckNeeded
                  ? 'Camera and microphone permissions stay active for the whole assessment.'
                  : 'No device checks are required for this assessment.'}
              </p>
              {!allChecksOk ? (
                <button
                  type="button"
                  onClick={runSystemCheck}
                  disabled={checkingDevices || !deviceCheckNeeded}
                  className="px-6 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
                  style={{ background: 'var(--admin-accent)', color: 'white' }}
                >
                  {checkingDevices ? 'Checking…' : hasRunOnce ? 'Retry system check' : 'Run system check'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleNext}
                  className="px-6 py-2.5 rounded-lg text-sm font-semibold"
                  style={{ background: 'var(--admin-accent)', color: 'white' }}
                >
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function CheckTile({
  icon,
  label,
  status,
  okLabel,
  failLabel,
  preview,
}: {
  icon: React.ReactNode;
  label: string;
  status: CheckStatus;
  okLabel: string;
  failLabel: string;
  preview?: React.ReactNode;
}) {
  const isOk = status === 'ok' || status === 'not-required';
  const isFailed = status === 'failed';
  const isChecking = status === 'checking';

  return (
    <div className="flex flex-col items-center text-center gap-2">
      <div
        className="relative w-16 h-16 rounded-full flex items-center justify-center overflow-hidden"
        style={{
          background: preview ? '#18181B' : 'var(--admin-bg)',
          color: preview ? 'white' : 'var(--admin-accent)',
          border: isFailed ? '2px solid #FCA5A5' : '2px solid transparent',
        }}
      >
        {preview || icon}
        {isChecking && (
          <span className="absolute inset-0 rounded-full border-2 animate-spin" style={{ borderColor: 'transparent', borderTopColor: 'var(--admin-accent)' }} />
        )}
        {(status === 'ok' || status === 'not-required') && (
          <span className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: '#22C55E' }}>
            <Check className="w-3 h-3 text-white" strokeWidth={3} />
          </span>
        )}
        {isFailed && (
          <span className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: '#EF4444' }}>
            <X className="w-3 h-3 text-white" strokeWidth={3} />
          </span>
        )}
      </div>
      <p className="text-sm font-semibold" style={{ color: 'var(--admin-text)' }}>{label}</p>
      <p className="text-xs" style={{ color: isFailed ? '#DC2626' : 'var(--admin-text-subtle)' }}>
        {status === 'idle' ? 'Pending' : status === 'checking' ? 'Checking…' : isFailed ? failLabel : okLabel}
      </p>
    </div>
  );
}
