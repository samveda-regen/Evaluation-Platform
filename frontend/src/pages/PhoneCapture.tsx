/**
 * PhoneCapture — public page opened on the candidate's phone via QR code.
 *
 * Flow:
 *   1. Read sessionId from URL params
 *   2. Validate the session is still waiting
 *   3. Open rear camera (environment facing)
 *   4. Candidate frames their ID and taps Capture
 *   5. Preview → Confirm → POST to /api/verification/phone-upload/:id
 *   6. Show success screen ("Return to your computer")
 *
 * No authentication required — the UUID session ID acts as a one-time token.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Camera, RotateCcw, Check, ShieldCheck, AlertCircle } from 'lucide-react';

const viteEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env || {};
const API_BASE =
  (typeof viteEnv.VITE_API_BASE_URL === 'string' ? viteEnv.VITE_API_BASE_URL : '') || '/api';

type PageState = 'loading' | 'camera' | 'preview' | 'uploading' | 'success' | 'error';

export default function PhoneCapture() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [pageState,  setPageState]  = useState<PageState>('loading');
  const [errorMsg,   setErrorMsg]   = useState('');
  const [captured,   setCaptured]   = useState<string | null>(null);
  const [stream,     setStream]     = useState<MediaStream | null>(null);

  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ── Validate session then start camera ────────────────────────────────────

  useEffect(() => {
    if (!sessionId) {
      setErrorMsg('Invalid link — no session ID found.');
      setPageState('error');
      return;
    }

    fetch(`${API_BASE}/verification/phone-session/${sessionId}`)
      .then(r => r.json())
      .then((data: { status?: string }) => {
        if (data.status === 'waiting') {
          startCamera();
        } else if (data.status === 'complete') {
          setErrorMsg('This link has already been used. Return to your computer.');
          setPageState('error');
        } else {
          setErrorMsg('This link has expired or is invalid. Please restart the verification on your computer.');
          setPageState('error');
        }
      })
      .catch(() => {
        setErrorMsg('Could not connect to the server. Check your internet connection.');
        setPageState('error');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    return () => { stream?.getTracks().forEach(t => t.stop()); };
  }, [stream]);

  // ── Camera ────────────────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    try {
      // Prefer rear camera for document capture
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
      });
      setStream(s);
      setPageState('camera');
      // Give the video element a tick to mount
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch {
      setErrorMsg('Camera access denied. Please allow camera permissions in your browser settings.');
      setPageState('error');
    }
  }, []);

  const capture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const b64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
    setCaptured(b64);
    setPageState('preview');
  }, [stream]);

  const retake = useCallback(() => {
    setCaptured(null);
    startCamera();
  }, [startCamera]);

  const confirm = useCallback(async () => {
    if (!captured || !sessionId) return;
    setPageState('uploading');

    try {
      const res = await fetch(`${API_BASE}/verification/phone-upload/${sessionId}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageData: captured }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Server error ${res.status}`);
      }

      setPageState('success');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Upload failed. Please try again.');
      setPageState('error');
    }
  }, [captured, sessionId]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (pageState === 'loading') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" />
      </div>
    );
  }

  if (pageState === 'error') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-16 h-16 bg-red-900/40 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Cannot Continue</h1>
          <p className="text-gray-400 text-sm">{errorMsg}</p>
        </div>
      </div>
    );
  }

  if (pageState === 'success') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center space-y-5 max-w-sm">
          <div className="w-20 h-20 bg-green-900/40 rounded-full flex items-center justify-center mx-auto">
            <ShieldCheck className="w-10 h-10 text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">Photo Sent!</h1>
          <p className="text-gray-400">
            Your ID photo has been received. Return to your computer to continue the verification.
          </p>
          <div className="bg-gray-800 rounded-xl p-4 text-sm text-gray-300">
            You can close this tab now.
          </div>
        </div>
      </div>
    );
  }

  if (pageState === 'uploading') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-400 mx-auto" />
          <p className="text-white font-medium">Sending photo…</p>
        </div>
      </div>
    );
  }

  // camera or preview state
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">

      {/* Header */}
      <div className="px-4 pt-safe-top pb-3 pt-4">
        <h1 className="text-white font-semibold text-lg">Scan Your ID</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          {pageState === 'camera'
            ? 'Position your ID card flat and fully in frame, then tap Capture'
            : 'Check the photo is clear and all text is readable'}
        </p>
      </div>

      {/* Camera / preview */}
      <div className="relative flex-1 bg-black overflow-hidden">
        {pageState === 'camera' && (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {/* ID card frame overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className="border-2 border-white rounded-xl opacity-70"
                style={{ width: '88%', aspectRatio: '1.586' }}
              />
            </div>
            {/* Corner indicators */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className="relative"
                style={{ width: '88%', aspectRatio: '1.586' }}
              >
                {[
                  'top-0 left-0 border-t-4 border-l-4 rounded-tl-xl',
                  'top-0 right-0 border-t-4 border-r-4 rounded-tr-xl',
                  'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-xl',
                  'bottom-0 right-0 border-b-4 border-r-4 rounded-br-xl',
                ].map((cls, i) => (
                  <div
                    key={i}
                    className={`absolute w-6 h-6 border-primary-400 ${cls}`}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {pageState === 'preview' && captured && (
          <img
            src={`data:image/jpeg;base64,${captured}`}
            alt="Captured ID"
            className="w-full h-full object-contain"
          />
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {/* Action buttons */}
      <div
        className="px-4 pb-safe-bottom pt-4 pb-8 flex gap-3 bg-gray-950"
        style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
      >
        {pageState === 'camera' && (
          <button
            onClick={capture}
            className="flex-1 flex items-center justify-center gap-2 bg-white text-gray-900 font-semibold py-4 rounded-2xl text-lg active:scale-95 transition-transform"
          >
            <Camera className="w-6 h-6" />
            Capture
          </button>
        )}

        {pageState === 'preview' && (
          <>
            <button
              onClick={retake}
              className="flex-1 flex items-center justify-center gap-2 bg-gray-700 text-white font-semibold py-4 rounded-2xl active:scale-95 transition-transform"
            >
              <RotateCcw className="w-5 h-5" />
              Retake
            </button>
            <button
              onClick={confirm}
              className="flex-1 flex items-center justify-center gap-2 bg-green-500 text-white font-semibold py-4 rounded-2xl active:scale-95 transition-transform"
            >
              <Check className="w-5 h-5" />
              Looks Good
            </button>
          </>
        )}
      </div>
    </div>
  );
}
