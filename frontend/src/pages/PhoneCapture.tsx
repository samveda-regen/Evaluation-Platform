/**
 * PhoneCapture - public page opened on the candidate's phone via QR code.
 *
 * Flow:
 *  1. Validate session -> open rear camera
 *  2. Auto-capture when ID is stable in frame (or manual "Capture Now")
 *  3. Preview -> confirm -> upload
 *  4. Poll for admin decision -> show Approved / Rejected screen
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Camera, RotateCcw, Check, ShieldCheck, AlertCircle, Clock, XCircle } from 'lucide-react';

const viteEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env || {};
const API_BASE =
  (typeof viteEnv.VITE_API_BASE_URL === 'string' ? viteEnv.VITE_API_BASE_URL : '') || '/api';

type PageState =
  | 'loading'
  | 'camera'
  | 'preview'
  | 'uploading'
  | 'waiting_approval'
  | 'approved'
  | 'rejected'
  | 'error';

const STABLE_FRAMES_NEEDED = 7;
const SAMPLE_MS            = 300;
const STABILITY_THRESHOLD  = 4;
const CONTENT_VARIANCE_MIN = 150;
const POLL_INTERVAL_MS     = 5000;

function enhanceContrast(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const c = 1.15;
  const b = 8;
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = Math.min(255, Math.max(0, c * (d[i]   - 128) + 128 + b));
    d[i+1] = Math.min(255, Math.max(0, c * (d[i+1] - 128) + 128 + b));
    d[i+2] = Math.min(255, Math.max(0, c * (d[i+2] - 128) + 128 + b));
  }
  ctx.putImageData(img, 0, 0);
}

function getFrameCrop(video: HTMLVideoElement): { x: number; y: number; w: number; h: number } | null {
  const vW = video.videoWidth;
  const vH = video.videoHeight;
  if (!vW || !vH) return null;
  const rect = video.getBoundingClientRect();
  const cW = rect.width;
  const cH = rect.height;
  if (!cW || !cH) return null;

  const videoAspect = vW / vH;
  const containerAspect = cW / cH;
  let scale: number, ox: number, oy: number;

  if (videoAspect > containerAspect) {
    scale = vH / cH; ox = (vW - cW * scale) / 2; oy = 0;
  } else {
    scale = vW / cW; ox = 0; oy = (vH - cH * scale) / 2;
  }

  const fW = cW * 0.88;
  const fH = fW / 1.586;
  const fX = (cW - fW) / 2;
  const fY = (cH - fH) / 2;

  return {
    x: Math.round(fX * scale + ox),
    y: Math.round(fY * scale + oy),
    w: Math.round(fW * scale),
    h: Math.round(fH * scale),
  };
}

export default function PhoneCapture() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [pageState,    setPageState]    = useState<PageState>('loading');
  const [errorMsg,     setErrorMsg]     = useState('');
  const [captured,     setCaptured]     = useState<string | null>(null);
  const [stability,    setStability]    = useState(0);
  const [rejectionMsg, setRejectionMsg] = useState('');

  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const sampleRef   = useRef<HTMLCanvasElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const prevGray    = useRef<Uint8ClampedArray | null>(null);
  const stableCount = useRef(0);
  const samplerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (samplerRef.current) clearInterval(samplerRef.current);
    if (pollRef.current)    clearInterval(pollRef.current);
  }, []);

  const startPolling = useCallback(() => {
    if (!sessionId) return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE}/verification/phone-session/${sessionId}`);
        const d = await r.json() as {
          status?: string;
          verificationStatus?: string;
          rejectionReason?: string;
        };
        if (d.verificationStatus === 'verified') {
          if (pollRef.current) clearInterval(pollRef.current);
          setPageState('approved');
        } else if (d.verificationStatus === 'rejected') {
          if (pollRef.current) clearInterval(pollRef.current);
          setRejectionMsg(d.rejectionReason ?? 'Your verification was not approved.');
          setPageState('rejected');
        }
      } catch { /* retry next tick */ }
    }, POLL_INTERVAL_MS);
  }, [sessionId]);

  const doCapture = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    if (samplerRef.current) { clearInterval(samplerRef.current); samplerRef.current = null; }

    const crop = getFrameCrop(video);
    if (crop && crop.w > 0 && crop.h > 0) {
      canvas.width  = crop.w;
      canvas.height = crop.h;
      const ctx = canvas.getContext('2d');
      if (ctx) { ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h); enhanceContrast(ctx, crop.w, crop.h); }
    } else {
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
    }

    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCaptured(canvas.toDataURL('image/jpeg', 0.95).split(',')[1]);
    setStability(0);
    setPageState('preview');
  }, []);

  const startSampler = useCallback(() => {
    const sCanvas = sampleRef.current;
    if (!sCanvas) return;
    const W = 80, H = Math.round(W / 1.586);
    sCanvas.width = W; sCanvas.height = H;
    const sCtx = sCanvas.getContext('2d', { willReadFrequently: true });
    if (!sCtx) return;

    stableCount.current = 0;
    prevGray.current    = null;

    samplerRef.current = setInterval(() => {
      const video = videoRef.current;
      if (!video || !sCtx) return;
      const crop = getFrameCrop(video);
      if (!crop) return;

      sCtx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
      const px = sCtx.getImageData(0, 0, W, H).data;

      const gray = new Uint8ClampedArray(W * H);
      let sum = 0;
      for (let i = 0; i < gray.length; i++) {
        const p = i * 4;
        gray[i] = Math.round(0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2]);
        sum += gray[i];
      }
      const mean = sum / gray.length;
      let variance = 0;
      for (let i = 0; i < gray.length; i++) variance += (gray[i] - mean) ** 2;
      variance /= gray.length;

      if (prevGray.current) {
        let diff = 0;
        for (let i = 0; i < gray.length; i++) diff += Math.abs(gray[i] - prevGray.current[i]);
        const avgDiff = diff / gray.length;
        const isStable   = avgDiff < STABILITY_THRESHOLD;
        const hasContent = variance > CONTENT_VARIANCE_MIN;

        if (isStable && hasContent) stableCount.current = Math.min(stableCount.current + 1, STABLE_FRAMES_NEEDED);
        else                        stableCount.current = Math.max(0, stableCount.current - 1);

        setStability(stableCount.current / STABLE_FRAMES_NEEDED);
        if (stableCount.current >= STABLE_FRAMES_NEEDED) doCapture();
      }
      prevGray.current = gray;
    }, SAMPLE_MS);
  }, [doCapture]);

  const startCamera = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
      });
      streamRef.current = s;
      setPageState('camera');
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().then(() => setTimeout(startSampler, 800)).catch(() => {});
        }
      });
    } catch {
      setErrorMsg('Camera access denied. Allow camera permissions in your browser settings.');
      setPageState('error');
    }
  }, [startSampler]);

  useEffect(() => {
    if (!sessionId) { setErrorMsg('Invalid link - no session ID found.'); setPageState('error'); return; }

    fetch(`${API_BASE}/verification/phone-session/${sessionId}`)
      .then(r => r.json())
      .then((d: { status?: string }) => {
        if      (d.status === 'waiting')  startCamera();
        else if (d.status === 'complete') { setErrorMsg('This link has already been used.'); setPageState('error'); }
        else                              { setErrorMsg('Link expired or invalid. Please restart on your computer.'); setPageState('error'); }
      })
      .catch(() => { setErrorMsg('Could not connect. Check your internet connection.'); setPageState('error'); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const retake = useCallback(() => {
    setCaptured(null); setStability(0); startCamera();
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
      setPageState('waiting_approval');
      startPolling();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Upload failed. Please try again.');
      setPageState('error');
    }
  }, [captured, sessionId, startPolling]);

  const frameColor = stability > 0.7 ? '#22c55e' : stability > 0.3 ? '#f59e0b' : 'rgba(255,255,255,0.65)';
  const statusText = stability > 0.5 ? 'Hold still...' : 'Place your ID flat inside the frame';

  if (pageState === 'loading') return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" />
    </div>
  );

  if (pageState === 'error') return (
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

  if (pageState === 'waiting_approval') return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="text-center space-y-5 max-w-sm">
        <div className="w-20 h-20 bg-blue-900/40 rounded-full flex items-center justify-center mx-auto">
          <Clock className="w-10 h-10 text-blue-400 animate-pulse" />
        </div>
        <h1 className="text-2xl font-bold text-white">Photo Received</h1>
        <p className="text-gray-400 text-sm leading-relaxed">
          Your ID photo has been submitted and is waiting for admin review.<br />
          This page will update automatically when a decision is made.
        </p>
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 justify-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400" />
            <span className="text-blue-300 text-sm font-medium">Waiting for admin approval...</span>
          </div>
          <p className="text-gray-500 text-xs">Keep this tab open to see the result</p>
        </div>
      </div>
    </div>
  );

  if (pageState === 'approved') return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="text-center space-y-5 max-w-sm">
        <div className="w-20 h-20 bg-green-900/40 rounded-full flex items-center justify-center mx-auto">
          <ShieldCheck className="w-10 h-10 text-green-400" />
        </div>
        <h1 className="text-2xl font-bold text-white">Identity Verified!</h1>
        <p className="text-gray-400 text-sm leading-relaxed">
          Your ID has been approved by the admin. Return to your computer to continue with the exam.
        </p>
        <div className="bg-green-900/20 border border-green-800 rounded-xl p-4">
          <span className="text-green-400 text-sm font-medium">✓ Verification approved</span>
        </div>
      </div>
    </div>
  );

  if (pageState === 'rejected') return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="text-center space-y-5 max-w-sm">
        <div className="w-20 h-20 bg-red-900/40 rounded-full flex items-center justify-center mx-auto">
          <XCircle className="w-10 h-10 text-red-400" />
        </div>
        <h1 className="text-2xl font-bold text-white">Verification Rejected</h1>
        {rejectionMsg && (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-4">
            <p className="text-red-300 text-sm">{rejectionMsg}</p>
          </div>
        )}
        <p className="text-gray-400 text-sm">
          Return to your computer and try submitting your ID again.
        </p>
      </div>
    </div>
  );

  if (pageState === 'uploading') return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-400 mx-auto" />
        <p className="text-white font-medium">Sending photo...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-white font-semibold text-lg">Scan Your ID</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          {pageState === 'camera' ? statusText : 'Check the photo is clear and all text is readable'}
        </p>
      </div>

      <div className="relative flex-1 bg-black overflow-hidden">
        {pageState === 'camera' && (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />

            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className="rounded-xl relative"
                style={{
                  width: '88%', aspectRatio: '1.586',
                  border: `2.5px solid ${frameColor}`,
                  transition: 'border-color 0.25s',
                  boxShadow: stability > 0.7 ? `0 0 0 2px ${frameColor}40` : 'none',
                }}
              >
                {stability > 0 && (
                  <div className="absolute bottom-0 left-0 right-0 h-1.5 rounded-b-xl overflow-hidden bg-black/30">
                    <div className="h-full transition-all duration-200" style={{ width: `${stability * 100}%`, backgroundColor: frameColor }} />
                  </div>
                )}
              </div>
            </div>

            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative" style={{ width: '88%', aspectRatio: '1.586' }}>
                {(['top-0 left-0 border-t-4 border-l-4 rounded-tl-xl',
                   'top-0 right-0 border-t-4 border-r-4 rounded-tr-xl',
                   'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-xl',
                   'bottom-0 right-0 border-b-4 border-r-4 rounded-br-xl'] as const
                ).map((cls, i) => (
                  <div key={i} className={`absolute w-7 h-7 ${cls}`}
                    style={{ borderColor: frameColor, transition: 'border-color 0.25s' }} />
                ))}
              </div>
            </div>

            {stability > 0 && (
              <div className="absolute bottom-28 left-0 right-0 flex justify-center pointer-events-none">
                <div className="bg-black/60 backdrop-blur-sm rounded-full px-4 py-1.5">
                  <span className="text-white text-sm font-medium tracking-wide">
                    {stability >= 1 ? '✓ Capturing...' : `Hold still - ${Math.round(stability * 100)}%`}
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {pageState === 'preview' && captured && (
          <img src={`data:image/jpeg;base64,${captured}`} alt="Captured ID" className="w-full h-full object-contain" />
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={sampleRef} className="hidden" />

      <div className="px-4 pt-4 bg-gray-950" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
        {pageState === 'camera' && (
          <button onClick={doCapture}
            className="w-full flex items-center justify-center gap-2 bg-white text-gray-900 font-semibold py-4 rounded-2xl text-lg active:scale-95 transition-transform">
            <Camera className="w-6 h-6" /> Capture Now
          </button>
        )}
        {pageState === 'preview' && (
          <div className="flex gap-3">
            <button onClick={retake}
              className="flex-1 flex items-center justify-center gap-2 bg-gray-700 text-white font-semibold py-4 rounded-2xl active:scale-95 transition-transform">
              <RotateCcw className="w-5 h-5" /> Retake
            </button>
            <button onClick={confirm}
              className="flex-1 flex items-center justify-center gap-2 bg-green-500 text-white font-semibold py-4 rounded-2xl active:scale-95 transition-transform">
              <Check className="w-5 h-5" /> Looks Good
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
