import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Mic, Video, MonitorUp, Wifi, ChevronLeft } from 'lucide-react';
import { candidateApi } from '../../services/api';
import { clearCachedStreams, setCachedStreams } from '../../services/devicePermissionService';
import { requestScreenShare, getScreenShareErrorMessage } from '../../services/proctorService';
import { acquireVerifiedCameraStream, type CameraDiagnostics } from '../../services/cameraDeviceService';
import SystemCheckCard, { type SystemCheckTile } from './SystemCheckCard';
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

/**
 * Page 1 of the normal-browser pre-exam flow: device readiness only (camera,
 * mic, screen share, connection) — the normal-browser counterpart to
 * SebSystemCheck.tsx. No Exit button here (unlike the SEB version, this runs
 * in a regular browser tab, not a locked-down kiosk browser); Back just goes
 * up the browser history, matching this flow's original convention.
 *
 * Next: /test/environment-setup (server-side detection readiness) when this
 * test uses a camera, or straight to /test/id-verification when it doesn't.
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
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'ok' | 'failed'>('checking');
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
      .then(() => {
        setConnectionLatency(Math.round(performance.now() - start));
        setConnectionStatus('ok');
      })
      .catch(() => {
        setConnectionLatency(null);
        setConnectionStatus('failed');
      });
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
    navigate(testDetails.test.requireCamera ? '/test/environment-setup' : '/test/id-verification');
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

  const tiles: SystemCheckTile[] = [];

  tiles.push({
    tileKey: 'camera',
    icon: <Video className="w-6 h-6" />,
    label: 'Webcam',
    status: !test.requireCamera ? 'not-required' : checkingDevices ? 'checking' : !hasRunOnce ? 'idle' : deviceStatus.camera ? 'ok' : 'failed',
    okLabel: 'Connected',
    failLabel: cameraFrameIssue ? 'No picture' : 'Not detected',
    okDescription: 'Your webcam is working properly.',
    failDescription: cameraFrameIssue
      ? 'Camera detected but not producing a picture. Try a different camera or restart your browser.'
      : 'Could not access your camera. Please allow camera permissions and try again.',
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
    okDescription: 'Your microphone is working properly.',
    failDescription: 'Could not detect your microphone. Please allow microphone permissions and try again.',
  });

  tiles.push({
    tileKey: 'screen',
    icon: <MonitorUp className="w-6 h-6" />,
    label: 'Screen share',
    status: !test.requireScreenShare ? 'not-required' : checkingDevices ? 'checking' : !hasRunOnce ? 'idle' : deviceStatus.screenShare ? 'ok' : 'failed',
    okLabel: 'Granted',
    failLabel: 'Not granted',
    okDescription: 'Screen sharing permission is enabled.',
    failDescription: 'Screen sharing permission was not granted. Please allow screen sharing and try again.',
  });

  tiles.push({
    tileKey: 'connection',
    icon: <Wifi className="w-6 h-6" />,
    label: 'Connection',
    status: connectionStatus === 'ok' ? 'ok' : connectionStatus === 'failed' ? 'failed' : 'checking',
    okLabel: connectionLatency !== null ? `Stable · ${connectionLatency}ms` : 'Stable',
    failLabel: 'Unstable',
    okDescription: 'Your internet connection is stable.',
    failDescription: 'We could not verify your connection. Please check your internet and try again.',
  });

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ background: '#F3F6FB' }}>
      <div
        className="pointer-events-none absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(circle, #DCE6FB 0%, transparent 70%)' }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-40 -left-40 w-[28rem] h-[28rem] rounded-full opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(circle, #E3F4E9 0%, transparent 70%)' }}
        aria-hidden="true"
      />

      <header className="relative bg-white border-b shadow-sm" style={{ borderColor: 'var(--admin-border-soft)' }}>
        <div className="max-w-[1180px] mx-auto px-6 sm:px-10 py-4 sm:py-5 flex items-center">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 text-sm font-medium transition-colors rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{ color: '#6B7280' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#111827')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}
            aria-label="Go back"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            Back
          </button>
          <div className="h-5 w-px bg-gray-200 mx-4" />
          <img src={talentstaQLogo} alt="TalentstaQ" style={{ height: '28px', width: 'auto' }} />
        </div>
      </header>

      <main className="relative flex-1 flex items-start justify-center px-4 sm:px-6 py-8 sm:py-12">
        <SystemCheckCard
          tiles={tiles}
          allChecksOk={allChecksOk}
          deviceCheckNeeded={deviceCheckNeeded}
          checkingDevices={checkingDevices}
          hasRunOnce={hasRunOnce}
          onRunCheck={runSystemCheck}
          onNext={handleNext}
          cameraDiagnostics={lastCameraDiagnostics}
          showCameraDiagnostics={!!test.requireCamera && !checkingDevices && hasRunOnce && !deviceStatus.camera}
        />
      </main>
    </div>
  );
}
