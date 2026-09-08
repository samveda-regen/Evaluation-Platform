/**
 * IDVerification Component
 *
 * Candidate-facing identity verification flow:
 *   intro → document upload → selfie (3-frame countdown) → processing → result
 *
 * Liveness: 3 frames are captured 1 second apart while a countdown is shown.
 * Frames are sent to the backend as livenessImages for server-side motion check.
 * A static photo held up to the camera produces near-identical frames and fails.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { ShieldCheck, CheckCircle2, ImageIcon, X, Clock, Camera, Smartphone, IdCard, Sun, Lock, ArrowRight, User, Users, Check, ChevronDown, Lightbulb } from 'lucide-react';
import QRCode from 'react-qr-code';
import api from '../services/api';
import WebcamCapture from './WebcamCapture';

interface IDVerificationProps {
  onVerified: () => void;
  onSkip?:    () => void;
  isOptional?: boolean;
}

type Step         = 'intro' | 'document' | 'selfie' | 'processing' | 'result';
type DocumentType = 'national_id' | 'passport' | 'drivers_license' | 'student_id';
type CapturePhase = 'idle' | 'countdown' | 'capturing' | 'done';

interface VerificationResult {
  success: boolean;
  status:  string;
  scores?: { documentAuth: number; faceMatch: number; liveness: number };
  error?:  string;
}

export default function IDVerification({ onVerified, onSkip, isOptional = false }: IDVerificationProps) {
  const [step,          setStep]          = useState<Step>('intro');
  const [documentType,  setDocumentType]  = useState<DocumentType>('national_id');
  const [documentImage, setDocumentImage] = useState<string | null>(null);
  const [selfieImage,   setSelfieImage]   = useState<string | null>(null);
  const [livenessFrames, setLivenessFrames] = useState<string[]>([]);
  const [result,        setResult]        = useState<VerificationResult | null>(null);
  const [cameraStream,  setCameraStream]  = useState<MediaStream | null>(null);
  const [capturePhase,  setCapturePhase]  = useState<CapturePhase>('idle');
  const [countdown,     setCountdown]     = useState<number>(3);

  // Webcam capture modal (for ID document)
  const [showWebcam,    setShowWebcam]    = useState(false);

  // Phone camera session
  const [phoneSessionId, setPhoneSessionId] = useState<string | null>(null);
  const [phoneQRUrl,     setPhoneQRUrl]     = useState('');
  const [phonePolling,   setPhonePolling]   = useState(false);
  const phonePollerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Admin decision polling state
  const [pendingPollState, setPendingPollState] = useState<'idle' | 'polling' | 'verified' | 'rejected'>('idle');
  const [pollRejectionReason, setPollRejectionReason] = useState('');
  const [initialCheckDone, setInitialCheckDone] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // ── Camera helpers ──────────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
      });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch {
      toast.error('Could not access camera — please allow camera permissions');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      setCameraStream(null);
    }
  }, [cameraStream]);

  // ── Phone camera session ───────────────────────────────────────────────────

  const stopPhoneSession = useCallback(() => {
    if (phonePollerRef.current) {
      clearInterval(phonePollerRef.current);
      phonePollerRef.current = null;
    }
    setPhonePolling(false);
    setPhoneSessionId(null);
    setPhoneQRUrl('');
  }, []);

  const startPhoneSession = useCallback(async () => {
    try {
      const res = await api.post<{ sessionId: string }>('/verification/phone-session');
      const { sessionId } = res.data;
      const qrUrl = `${window.location.origin}/phone-capture/${sessionId}`;
      setPhoneSessionId(sessionId);
      setPhoneQRUrl(qrUrl);
      setPhonePolling(true);

      // Poll every 2 seconds until complete or 5 minutes pass
      let elapsed = 0;
      phonePollerRef.current = setInterval(async () => {
        elapsed += 2000;
        if (elapsed > 5 * 60 * 1000) {
          stopPhoneSession();
          toast.error('Phone session expired — please try again');
          return;
        }

        try {
          const poll = await api.get<{ status: string; imageData?: string }>(
            `/verification/phone-session/${sessionId}`
          );
          if (poll.data.status === 'complete' && poll.data.imageData) {
            stopPhoneSession();
            setDocumentImage(poll.data.imageData);
            toast.success('ID photo received from your phone!');
          }
        } catch {
          // ignore transient network errors during polling
        }
      }, 2000);
    } catch {
      toast.error('Could not start phone session — please try again');
    }
  }, [stopPhoneSession]);

  // Cleanup phone session on unmount
  useEffect(() => {
    return () => {
      if (phonePollerRef.current) clearInterval(phonePollerRef.current);
    };
  }, []);

  // ── Admin decision polling ─────────────────────────────────────────────────

  const startStatusPolling = useCallback(() => {
    if (statusPollerRef.current) return;
    setPendingPollState('polling');
    statusPollerRef.current = setInterval(async () => {
      try {
        const res = await api.get<{ status: string; identity?: { rejectionReason?: string | null } }>(
          '/verification/status'
        );
        const { status } = res.data;
        const reason = res.data.identity?.rejectionReason ?? null;
        if (status === 'verified') {
          clearInterval(statusPollerRef.current!);
          statusPollerRef.current = null;
          setPendingPollState('verified');
        } else if (status === 'rejected') {
          clearInterval(statusPollerRef.current!);
          statusPollerRef.current = null;
          setPollRejectionReason(reason ?? 'Your verification was not approved.');
          setPendingPollState('rejected');
        }
      } catch { /* retry next tick */ }
    }, 5000);
  }, []);

  useEffect(() => {
    return () => { if (statusPollerRef.current) clearInterval(statusPollerRef.current); };
  }, []);

  // Check existing verification status on mount — skip re-submission if already pending/rejected
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ status: string; identity?: { rejectionReason?: string | null } }>(
          '/verification/status'
        );
        const { status, identity } = res.data;
        const reason = identity?.rejectionReason ?? null;

        // No identity record means no prior submission — show normal flow
        if (!identity) {
          // fall through to setInitialCheckDone below
        } else if (status === 'verified') {
          onVerified();
          setInitialCheckDone(true);
          return;
        } else if (status === 'pending') {
          setResult({ success: true, status: 'pending' });
          setStep('result');
          startStatusPolling();
        } else if (status === 'rejected') {
          setPollRejectionReason(reason ?? '');
          setPendingPollState('rejected');
          setResult({ success: false, status: 'rejected', error: reason ?? undefined });
          setStep('result');
        }
        // expired / unknown → show normal flow
      } catch { /* ignore — show normal flow */ }
      setInitialCheckDone(true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // Mirror to match the video preview
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.88).split(',')[1];
  }, []);

  // ── 3-frame countdown capture ───────────────────────────────────────────────

  const startCountdownCapture = useCallback(() => {
    const frames: string[] = [];
    setCapturePhase('countdown');
    setCountdown(3);

    let tick = 3;

    const tick_ = () => {
      tick -= 1;
      setCountdown(tick);

      if (tick > 0) {
        captureTimerRef.current = setTimeout(tick_, 1000);
        return;
      }

      // Countdown reached 0 — start capturing frames
      setCapturePhase('capturing');

      const captureNext = (remaining: number) => {
        const frame = captureFrame();
        if (frame) frames.push(frame);

        if (remaining > 1) {
          captureTimerRef.current = setTimeout(() => captureNext(remaining - 1), 900);
        } else {
          // All 3 frames captured
          stopCamera();
          setCapturePhase('done');
          setSelfieImage(frames[frames.length - 1] ?? null);
          setLivenessFrames([...frames]);
        }
      };

      captureNext(3);
    };

    captureTimerRef.current = setTimeout(tick_, 1000);
  }, [captureFrame, stopCamera]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
      stopCamera();
    };
  }, [stopCamera]);

  // ── Document upload ─────────────────────────────────────────────────────────

  const handleDocumentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Please upload a JPEG, PNG, or WebP image');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File must be under 10 MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setDocumentImage((reader.result as string).split(',')[1]);
    };
    reader.readAsDataURL(file);
  };

  // ── Submit ──────────────────────────────────────────────────────────────────

  const submitVerification = async () => {
    if (!documentImage || !selfieImage) {
      toast.error('Please provide both ID document and selfie');
      return;
    }

    setStep('processing');

    try {
      const response = await api.post('/verification/submit', {
        documentType,
        documentImageData: documentImage,
        selfieImageData:   selfieImage,
        livenessImages:    livenessFrames,
      });

      setResult(response.data);
      setStep('result');

      if (response.data.status === 'verified') {
        toast.success('Your ID has been automatically verified!');
      } else if (response.data.status === 'pending') {
        toast('Your ID has been submitted — waiting for admin review', { icon: '⏳' });
        startStatusPolling();
      } else if (!response.data.success) {
        toast.error(response.data.error ?? 'Verification failed');
      }
    } catch (error) {
      console.error('Verification error:', error);
      setResult({ success: false, status: 'rejected', error: 'Failed to process verification. Please try again.' });
      setStep('result');
    }
  };

  // ── Step renderers ──────────────────────────────────────────────────────────

  const requirements = [
    {
      icon: IdCard,
      title: 'Valid Government-issued ID',
      description: "National ID, Passport, or Driver's License",
      bg: '#E7F8EE',
      fg: '#16A34A',
    },
    {
      icon: Camera,
      title: 'Working Webcam',
      description: 'For a quick and clear selfie',
      bg: '#EAF1FE',
      fg: '#1F3556',
    },
    {
      icon: Sun,
      title: 'Good Lighting',
      description: 'Sit in a well-lit area and avoid strong backlighting',
      bg: '#FEF3E2',
      fg: '#D97706',
    },
  ];

  const trustIndicators = [
    { icon: ShieldCheck, label: 'Secure', description: 'Your data is protected' },
    { icon: Users, label: 'Trusted', description: 'Fair for everyone' },
    { icon: Lock, label: 'Private', description: 'Used only to verify you' },
  ];

  const renderIntro = () => (
    <div className="grid grid-cols-1 lg:grid-cols-2">
      {/* Left column — requirements & call to action */}
      <div className="p-6 sm:p-8 lg:p-10">
        <span
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wide"
          style={{ background: '#EAF1FE', color: 'var(--admin-accent)' }}
        >
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
          REQUIRED BEFORE YOU BEGIN
        </span>

        <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: 'var(--admin-text)' }}>
          Verify Your Identity
        </h2>
        <p className="mt-2 text-sm sm:text-base leading-relaxed max-w-md" style={{ color: 'var(--admin-text-muted)' }}>
          To ensure a fair and secure testing environment, we need to verify your identity before you begin.
        </p>

        <div className="mt-5 rounded-2xl overflow-hidden border" style={{ borderColor: 'var(--admin-border-soft)' }}>
          <p
            className="px-5 pt-3 pb-1.5 text-xs font-semibold uppercase tracking-wide"
            style={{ background: 'var(--admin-bg)', color: 'var(--admin-text-subtle)' }}
          >
            You will need
          </p>
          <div className="divide-y" style={{ background: 'var(--admin-bg)' }}>
            {requirements.map((req) => (
              <div key={req.title} className="flex items-center gap-4 px-5 py-3" style={{ borderColor: 'var(--admin-border-soft)' }}>
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: req.bg, color: req.fg }}
                >
                  <req.icon className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--admin-text)' }}>{req.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--admin-text-subtle)' }}>{req.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => setStep('document')}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl text-base font-semibold text-white transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{ background: 'var(--admin-accent)', height: 52 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--admin-accent-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--admin-accent)'; }}
          >
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
            Start Verification
            <ArrowRight className="w-5 h-5" aria-hidden="true" />
          </button>
          {isOptional && onSkip && (
            <button onClick={onSkip} className="btn btn-secondary">Skip</button>
          )}
        </div>

        <p className="mt-3 flex items-center gap-2 text-xs" style={{ color: 'var(--admin-text-subtle)' }}>
          <Lock className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
          Your information is kept private and used only to verify your identity.
        </p>
      </div>

      {/* Right column — trust & security visual */}
      <div
        className="relative flex flex-col justify-center px-6 sm:px-8 lg:px-10 py-6 lg:py-8 overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #EFF4FC 0%, #E4ECFA 100%)' }}
      >
        <div className="relative flex items-center justify-center py-2">
          <div
            className="absolute w-40 h-40 rounded-[2rem] rotate-6"
            style={{ background: 'rgba(31,53,86,0.07)' }}
            aria-hidden="true"
          />
          <div
            className="absolute w-40 h-40 rounded-[2rem] -rotate-3 translate-x-3"
            style={{ background: 'rgba(31,53,86,0.05)' }}
            aria-hidden="true"
          />

          <div className="relative bg-white rounded-2xl shadow-lg p-4 w-56 flex items-center gap-3">
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: '#DCE6FB' }}
            >
              <User className="w-7 h-7" style={{ color: 'var(--admin-accent)' }} aria-hidden="true" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="h-2.5 rounded-full w-full" style={{ background: '#E2E8F0' }} />
              <div className="h-2.5 rounded-full w-4/5" style={{ background: '#E2E8F0' }} />
              <div className="h-2.5 rounded-full w-3/5" style={{ background: '#E2E8F0' }} />
            </div>
            <span
              className="absolute -bottom-3 -right-3 w-9 h-9 rounded-full flex items-center justify-center shadow-md"
              style={{ background: '#22C55E' }}
              aria-hidden="true"
            >
              <Check className="w-5 h-5 text-white" strokeWidth={3} />
            </span>
          </div>
        </div>

        <div className="relative text-center mt-5">
          <h3 className="text-lg font-bold" style={{ color: 'var(--admin-text)' }}>Your identity builds trust</h3>
          <p className="mt-1 text-sm max-w-xs mx-auto" style={{ color: 'var(--admin-text-muted)' }}>
            Helps us maintain integrity and give everyone a fair opportunity.
          </p>
        </div>

        <div className="relative mt-5 grid grid-cols-3 gap-3 text-center">
          {trustIndicators.map((t) => (
            <div key={t.label} className="flex flex-col items-center gap-1.5">
              <t.icon className="w-5 h-5" style={{ color: 'var(--admin-accent)' }} aria-hidden="true" />
              <p className="text-xs font-semibold" style={{ color: 'var(--admin-text)' }}>{t.label}</p>
              <p className="text-[11px] leading-snug" style={{ color: 'var(--admin-text-subtle)' }}>{t.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const documentProgressSteps = [
    { index: 1, label: 'Upload ID' },
    { index: 2, label: 'Verify' },
    { index: 3, label: 'Complete' },
  ];

  const renderDocument = () => (
    <>
      {/* Webcam modal */}
      {showWebcam && (
        <WebcamCapture
          onCapture={img => { setDocumentImage(img); setShowWebcam(false); }}
          onClose={() => setShowWebcam(false)}
        />
      )}

      {/* Phone QR overlay */}
      {phoneSessionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center space-y-5">
            <h3 className="font-semibold text-gray-800 text-lg">Scan with Your Phone</h3>
            <p className="text-gray-500 text-sm">
              Open your phone camera and scan the QR code below. Use your phone to photograph your ID, then return here.
            </p>

            <div className="flex justify-center p-3 bg-white border rounded-xl">
              <QRCode value={phoneQRUrl} size={200} />
            </div>

            {phonePolling && (
              <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse" />
                Waiting for phone…
              </div>
            )}

            <p className="text-xs text-gray-400 break-all">{phoneQRUrl}</p>

            <button
              onClick={stopPhoneSession}
              className="btn btn-secondary w-full"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[60%_40%]">
        {/* Left column — document details */}
        <div className="p-6 sm:p-8 lg:p-10">
          <p className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--admin-accent)' }}>
            Identity Verification
          </p>

          {/* Progress indicator */}
          <div className="mt-3 flex items-center max-w-xs" aria-hidden="true">
            {documentProgressSteps.map((s, i) => (
              <div key={s.label} className={`flex items-center ${i < documentProgressSteps.length - 1 ? 'flex-1' : ''}`}>
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{
                      background: current >= s.index ? 'var(--admin-accent)' : '#E5E9F0',
                      color: current >= s.index ? '#FFFFFF' : '#94A3B8',
                    }}
                  >
                    {s.index}
                  </div>
                  <span
                    className="text-[11px] font-medium whitespace-nowrap"
                    style={{ color: current >= s.index ? 'var(--admin-text)' : 'var(--admin-text-subtle)' }}
                  >
                    {s.label}
                  </span>
                </div>
                {i < documentProgressSteps.length - 1 && (
                  <div className="flex-1 h-px mx-2 mb-4" style={{ background: current > s.index ? 'var(--admin-accent)' : '#E5E9F0' }} />
                )}
              </div>
            ))}
          </div>

          <h2 className="mt-5 text-xl sm:text-2xl font-bold tracking-tight" style={{ color: 'var(--admin-text)' }}>
            Upload Your ID Document
          </h2>
          <p className="mt-1.5 text-sm sm:text-base leading-relaxed" style={{ color: 'var(--admin-text-muted)' }}>
            Take a clear photo of your government-issued ID to verify your identity.
          </p>

          <div className="mt-5">
            <label htmlFor="document-type" className="block text-sm font-medium mb-2" style={{ color: 'var(--admin-text)' }}>
              Document Type
            </label>
            <div className="relative">
              <IdCard
                className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--admin-text-subtle)' }}
                aria-hidden="true"
              />
              <select
                id="document-type"
                value={documentType}
                onChange={e => setDocumentType(e.target.value as DocumentType)}
                className="w-full appearance-none rounded-xl border pl-10 pr-9 text-sm font-medium bg-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                style={{ height: 50, borderColor: 'var(--admin-border)', color: 'var(--admin-text)' }}
              >
                <option value="national_id">National ID Card</option>
                <option value="passport">Passport</option>
                <option value="drivers_license">Driver's License</option>
                <option value="student_id">Student ID</option>
              </select>
              <ChevronDown
                className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--admin-text-subtle)' }}
                aria-hidden="true"
              />
            </div>
          </div>

          {/* File upload drop zone */}
          <div
            className="mt-5 border-2 border-dashed rounded-2xl text-center cursor-pointer transition-colors flex flex-col items-center justify-center px-6"
            style={{
              minHeight: 160,
              borderColor: documentImage ? '#86EFAC' : 'var(--admin-border)',
              background: documentImage ? '#F0FDF4' : 'var(--admin-bg)',
            }}
            onClick={() => fileInputRef.current?.click()}
            onMouseEnter={e => { if (!documentImage) e.currentTarget.style.borderColor = 'var(--admin-accent)'; }}
            onMouseLeave={e => { if (!documentImage) e.currentTarget.style.borderColor = 'var(--admin-border)'; }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleDocumentUpload}
              className="hidden"
              aria-label="Upload ID document"
            />

            {documentImage ? (
              <div className="space-y-3 py-2">
                <img
                  src={`data:image/jpeg;base64,${documentImage}`}
                  alt="ID Document"
                  className="max-h-40 mx-auto rounded-lg"
                />
                <p className="text-sm font-semibold" style={{ color: '#16A34A' }}>Document ready</p>
                <button
                  onClick={e => { e.stopPropagation(); setDocumentImage(null); }}
                  className="text-sm font-medium hover:underline"
                  style={{ color: '#DC2626' }}
                >
                  Remove and upload different image
                </button>
              </div>
            ) : (
              <>
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
                  style={{ background: '#EAF1FE', color: 'var(--admin-accent)' }}
                >
                  <ImageIcon className="w-6 h-6" aria-hidden="true" />
                </div>
                <p className="font-semibold text-sm" style={{ color: 'var(--admin-text)' }}>Click to upload or drag and drop</p>
                <p className="text-xs mt-1" style={{ color: 'var(--admin-text-subtle)' }}>JPEG, PNG, or WebP · max 10 MB</p>
              </>
            )}
          </div>
        </div>

        {/* Right column — capture options, tips, and actions */}
        <div
          className="flex flex-col p-6 sm:p-8 lg:p-10 border-t lg:border-t-0 lg:border-l"
          style={{ background: '#F8FAFC', borderColor: 'var(--admin-border-soft)' }}
        >
          {!documentImage && (
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--admin-text)' }}>Other ways to capture</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setShowWebcam(true)}
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-white p-4 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                  style={{ borderColor: 'var(--admin-border)', minHeight: 92 }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--admin-accent)'; e.currentTarget.style.background = '#EEF4FF'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--admin-border)'; e.currentTarget.style.background = '#FFFFFF'; }}
                >
                  <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: '#EAF1FE', color: 'var(--admin-accent)' }}>
                    <Camera className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <span className="text-sm font-semibold" style={{ color: 'var(--admin-text)' }}>Use Webcam</span>
                  <span className="text-xs" style={{ color: 'var(--admin-text-subtle)' }}>Desktop camera</span>
                </button>

                <button
                  type="button"
                  onClick={startPhoneSession}
                  disabled={phonePolling}
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-white p-4 text-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                  style={{ borderColor: 'var(--admin-border)', minHeight: 92 }}
                  onMouseEnter={e => { if (!e.currentTarget.disabled) { e.currentTarget.style.borderColor = 'var(--admin-accent)'; e.currentTarget.style.background = '#EEF4FF'; } }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--admin-border)'; e.currentTarget.style.background = '#FFFFFF'; }}
                >
                  <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: '#EAF1FE', color: 'var(--admin-accent)' }}>
                    <Smartphone className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <span className="text-sm font-semibold" style={{ color: 'var(--admin-text)' }}>Use Phone</span>
                  <span className="text-xs" style={{ color: 'var(--admin-text-subtle)' }}>Scan QR code</span>
                </button>
              </div>
            </div>
          )}

          <div className={documentImage ? '' : 'mt-5'}>
            <div className="rounded-xl border px-4 py-3 flex gap-2.5" style={{ background: '#FEF9E7', borderColor: '#FDE9B8' }}>
              <Lightbulb className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#B45309' }} aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold" style={{ color: '#92400E' }}>Tips</p>
                <ul className="mt-1 space-y-0.5 text-xs leading-relaxed list-disc list-inside" style={{ color: '#92400E' }}>
                  <li>Ensure all text is readable</li>
                  <li>Avoid glare or reflections</li>
                  <li>Include all four corners of your ID</li>
                  <li>Use a well-lit area</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-auto pt-5">
            <div className="h-px w-full mb-4" style={{ background: 'var(--admin-border-soft)' }} />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep('intro')}
                className="flex-1 inline-flex items-center justify-center rounded-xl border text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                style={{ height: 50, borderColor: 'var(--admin-border)', color: 'var(--admin-text)', background: '#FFFFFF' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F1F5F9'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#FFFFFF'; }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!documentImage) { toast.error('Please provide your ID document'); return; }
                  setCapturePhase('idle');
                  setSelfieImage(null);
                  setLivenessFrames([]);
                  setStep('selfie');
                  startCamera();
                }}
                disabled={!documentImage}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                style={{ height: 50, background: 'var(--admin-accent)' }}
                onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = 'var(--admin-accent-hover)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--admin-accent)'; }}
              >
                Continue
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  const renderSelfie = () => {
    const isCounting  = capturePhase === 'countdown';
    const isCapturing = capturePhase === 'capturing';
    const isDone      = capturePhase === 'done';

    return (
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-xl font-bold text-gray-800">Take a Selfie</h2>
          <p className="text-gray-600 mt-1">
            {isDone
              ? 'Selfie captured — review and continue'
              : 'Position your face within the frame, then click Capture'}
          </p>
        </div>

        {/* Camera / preview */}
        <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
          {!isDone ? (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />

              {/* Face guide oval */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-44 h-56 border-2 border-white border-dashed rounded-full opacity-40" />
              </div>

              {/* Countdown overlay */}
              {(isCounting || isCapturing) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 gap-3">
                  <div className="text-white text-7xl font-black leading-none">
                    {isCounting ? countdown : <span className="text-5xl">📸</span>}
                  </div>
                  <p className="text-white text-sm font-medium">
                    {isCounting ? 'Get ready…' : 'Capturing 3 frames…'}
                  </p>
                </div>
              )}
            </>
          ) : (
            // Preview of last captured frame
            <img
              src={`data:image/jpeg;base64,${selfieImage}`}
              alt="Selfie preview"
              className="w-full h-full object-cover scale-x-[-1]"
            />
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />

        {/* Liveness frame indicator */}
        {isDone && livenessFrames.length > 0 && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3">
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
            <span className="text-sm text-green-700">
              {livenessFrames.length} frames captured for liveness check
            </span>
          </div>
        )}

        {!isDone && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            <strong>Tips:</strong> Look directly at the camera with good lighting. Stay still during the countdown.
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => {
              if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
              stopCamera();
              setSelfieImage(null);
              setLivenessFrames([]);
              setCapturePhase('idle');
              setStep('document');
            }}
            className="btn btn-secondary"
            disabled={isCounting || isCapturing}
          >
            Back
          </button>

          {!isDone ? (
            <button
              onClick={startCountdownCapture}
              disabled={isCounting || isCapturing}
              className="btn btn-primary flex-1"
            >
              {isCounting || isCapturing ? (
                <span className="flex items-center gap-2 justify-center">
                  <Clock className="w-4 h-4 animate-spin" />
                  {isCounting ? `Starting in ${countdown}…` : 'Capturing…'}
                </span>
              ) : (
                'Capture Selfie'
              )}
            </button>
          ) : (
            <>
              <button
                onClick={() => {
                  setSelfieImage(null);
                  setLivenessFrames([]);
                  setCapturePhase('idle');
                  startCamera();
                }}
                className="btn btn-secondary"
              >
                Retake
              </button>
              <button onClick={submitVerification} className="btn btn-primary flex-1">
                Verify Identity
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderProcessing = () => (
    <div className="text-center py-12 space-y-4">
      <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary-600 mx-auto" />
      <h2 className="text-xl font-bold text-gray-800">Verifying Your Identity</h2>
      <p className="text-gray-600">Comparing face and document — this takes a few seconds…</p>
    </div>
  );

  const renderResult = () => {
    // ── Verified — either auto-approved on submit, or by an admin after polling ──
    if (pendingPollState === 'verified' || result?.status === 'verified') {
      const wasAutoVerified = result?.status === 'verified' && pendingPollState !== 'verified';
      return (
        <div className="text-center space-y-6">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <ShieldCheck className="w-10 h-10 text-green-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-green-600">Identity Verified!</h2>
            <p className="text-gray-600 mt-2">
              {wasAutoVerified
                ? 'Your identity was automatically verified. You may now begin the test.'
                : 'Admin has approved your identity. You may now begin the test.'}
            </p>
          </div>
          {result?.scores && (
            <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-3 gap-4 text-sm">
              {[
                { label: 'Document', value: result.scores.documentAuth },
                { label: 'Face Match', value: result.scores.faceMatch },
                { label: 'Liveness', value: result.scores.liveness },
              ].map(s => (
                <div key={s.label}>
                  <p className="text-gray-500">{s.label}</p>
                  <p className="font-bold text-lg text-green-600">{s.value}%</p>
                </div>
              ))}
            </div>
          )}
          <button onClick={onVerified} className="btn btn-primary w-full">
            Continue to Test
          </button>
        </div>
      );
    }

    // ── Admin rejected ──────────────────────────────────────────────────────
    if (pendingPollState === 'rejected' || result?.status === 'rejected') {
      const reason = pollRejectionReason || result?.error;
      return (
        <div className="text-center space-y-6">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto">
            <X className="w-10 h-10 text-red-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-red-600">Verification Rejected</h2>
            <p className="text-gray-600 mt-2">
              {reason ?? 'Your verification was not approved. Please try again.'}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => {
                setDocumentImage(null);
                setSelfieImage(null);
                setLivenessFrames([]);
                setResult(null);
                setCapturePhase('idle');
                setPendingPollState('idle');
                setPollRejectionReason('');
                setStep('intro');
              }}
              className="btn btn-primary flex-1"
            >
              Try Again
            </button>
            {isOptional && onSkip && (
              <button onClick={onSkip} className="btn btn-secondary">Skip</button>
            )}
          </div>
        </div>
      );
    }

    // ── Pending — waiting for admin ─────────────────────────────────────────
    if (result?.status === 'pending') {
      const handleResubmit = async () => {
        setCancelling(true);
        try {
          await api.delete('/verification/my-submission');
          // Stop polling and reset all state back to intro
          if (statusPollerRef.current) { clearInterval(statusPollerRef.current); statusPollerRef.current = null; }
          setResult(null);
          setPendingPollState('idle');
          setPollRejectionReason('');
          setDocumentImage(null);
          setSelfieImage(null);
          setLivenessFrames([]);
          setCapturePhase('idle');
          setStep('intro');
        } catch {
          toast.error('Could not cancel submission — please try again');
        } finally {
          setCancelling(false);
        }
      };

      return (
        <div className="text-center space-y-6">
          <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto">
            <Clock className="w-10 h-10 text-yellow-600 animate-pulse" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-yellow-600">Under Review</h2>
            <p className="text-gray-600 mt-2">
              Your ID has been submitted and is awaiting admin approval.
              This page will update automatically when a decision is made.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
            <div className="w-4 h-4 rounded-full border-2 border-t-transparent border-yellow-500 animate-spin" />
            Waiting for admin approval…
          </div>
          <button
            onClick={handleResubmit}
            disabled={cancelling}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-colors disabled:opacity-50"
          >
            {cancelling ? (
              <>
                <div className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent border-gray-500 animate-spin" />
                Cancelling…
              </>
            ) : (
              'Submit a different photo'
            )}
          </button>
          {isOptional && onSkip && (
            <button onClick={onSkip} className="btn btn-secondary w-full">
              Continue without verification
            </button>
          )}
        </div>
      );
    }

    // ── Generic failure ─────────────────────────────────────────────────────
    return (
      <div className="text-center space-y-6">
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto">
          <X className="w-10 h-10 text-red-600" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-red-600">Verification Failed</h2>
          <p className="text-gray-600 mt-2">
            {result?.error ?? 'We could not verify your identity. Please try again.'}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {
              setDocumentImage(null);
              setSelfieImage(null);
              setLivenessFrames([]);
              setResult(null);
              setCapturePhase('idle');
              setStep('intro');
            }}
            className="btn btn-primary flex-1"
          >
            Try Again
          </button>
          {isOptional && onSkip && (
            <button onClick={onSkip} className="btn btn-secondary">Skip</button>
          )}
        </div>
      </div>
    );
  };

  // ── Progress dots ───────────────────────────────────────────────────────────

  const stepIndex: Record<Step, number> = { intro: 0, document: 1, selfie: 2, processing: 3, result: 4 };
  const current = stepIndex[step];

  if (!initialCheckDone) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-lg mx-auto flex items-center justify-center" style={{ minHeight: 200 }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div
      className={
        step === 'intro' || step === 'document'
          ? 'bg-white rounded-3xl shadow-sm overflow-hidden max-w-5xl mx-auto'
          : 'bg-white rounded-xl shadow-lg p-8 max-w-lg mx-auto'
      }
    >
      {step !== 'intro' && step !== 'document' && step !== 'result' && (
        <div className="flex items-center justify-center mb-6">
          {[1, 2, 3].map((dot, i) => (
            <div key={dot} className="contents">
              <div className={`w-3 h-3 rounded-full ${current >= dot ? 'bg-primary-600' : 'bg-gray-300'}`} />
              {i < 2 && (
                <div className={`w-16 h-1 ${current > dot ? 'bg-primary-600' : 'bg-gray-300'}`} />
              )}
            </div>
          ))}
        </div>
      )}

      {step === 'intro'       && renderIntro()}
      {step === 'document'    && renderDocument()}
      {step === 'selfie'      && renderSelfie()}
      {step === 'processing'  && renderProcessing()}
      {step === 'result'      && renderResult()}
    </div>
  );
}
