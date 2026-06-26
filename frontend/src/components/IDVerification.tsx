import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { ShieldCheck, CheckCircle2, ImageIcon, X, Clock } from 'lucide-react';
import { candidateApi } from '../services/api';

interface IDVerificationProps {
  onVerified: () => void;
  onSkip?: () => void;
  isOptional?: boolean;
}

type Step = 'intro' | 'document' | 'selfie' | 'processing' | 'result';
type DocumentType = 'national_id' | 'passport' | 'drivers_license' | 'student_id';
type PendingPollState = 'pending' | 'verified' | 'rejected';

interface VerificationResult {
  success: boolean;
  status: string;
  error?: string;
  rejectionReason?: string;
}

const POLL_INTERVAL_MS = 5000;

export default function IDVerification({
  onVerified,
  onSkip,
  isOptional = false,
}: IDVerificationProps) {
  const [step,               setStep]               = useState<Step>('intro');
  const [documentType,       setDocumentType]       = useState<DocumentType>('national_id');
  const [documentImage,      setDocumentImage]      = useState<string | null>(null);
  const [selfieImage,        setSelfieImage]        = useState<string | null>(null);
  const [result,             setResult]             = useState<VerificationResult | null>(null);
  const [cameraStream,       setCameraStream]       = useState<MediaStream | null>(null);
  const [pendingPollState,   setPendingPollState]   = useState<PendingPollState | null>(null);
  const [pollRejectionReason,setPollRejectionReason]= useState('');
  const [initialCheckDone,   setInitialCheckDone]   = useState(false);
  const [cancelling,         setCancelling]         = useState(false);

  const videoRef       = useRef<HTMLVideoElement>(null);
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const statusPollerRef= useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (statusPollerRef.current) clearInterval(statusPollerRef.current);
  }, []);

  const startStatusPolling = useCallback(() => {
    if (statusPollerRef.current) clearInterval(statusPollerRef.current);
    statusPollerRef.current = setInterval(async () => {
      try {
        const { data } = await candidateApi.getVerificationStatus();
        const status = data.status ?? data.verificationStatus;
        if (status === 'verified' || status === 'approved') {
          if (statusPollerRef.current) clearInterval(statusPollerRef.current);
          setPendingPollState('verified');
          onVerified();
        } else if (status === 'rejected' || status === 'mismatch') {
          if (statusPollerRef.current) clearInterval(statusPollerRef.current);
          setPollRejectionReason(data.rejectionReason || 'Your verification was not approved.');
          setPendingPollState('rejected');
        }
      } catch { /* retry next tick */ }
    }, POLL_INTERVAL_MS);
  }, [onVerified]);

  // On mount: check for existing pending/verified/rejected state
  useEffect(() => {
    const checkExistingStatus = async () => {
      try {
        const { data } = await candidateApi.getVerificationStatus();
        const status = data.status ?? data.verificationStatus;
        if (status === 'verified' || status === 'approved') {
          onVerified();
          return;
        } else if (status === 'pending') {
          setResult({ success: false, status: 'pending' });
          setPendingPollState('pending');
          setStep('result');
          startStatusPolling();
          return;
        } else if (status === 'rejected' || status === 'mismatch') {
          setResult({ success: false, status: 'rejected' });
          setPendingPollState('rejected');
          setPollRejectionReason(data.rejectionReason || 'Your verification was not approved.');
          setStep('result');
          return;
        }
      } catch { /* no existing record - normal flow */ }
      setInitialCheckDone(true);
    };
    void checkExistingStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      toast.error('Failed to access camera');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  }, [cameraStream]);

  const capturePhoto = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, []);

  const handleDocumentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Please upload a valid image file (JPEG, PNG, or WebP)');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setDocumentImage(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleCaptureSelfie = () => {
    const image = capturePhoto();
    if (image) { setSelfieImage(image); stopCamera(); }
  };

  const submitVerification = async () => {
    if (!documentImage || !selfieImage) {
      toast.error('Please provide both ID document and selfie');
      return;
    }
    setStep('processing');
    try {
      const response = await candidateApi.submitVerification({
        documentType,
        documentImageData: documentImage,
        selfieImageData: selfieImage,
      });
      setResult({ success: false, status: response.data.status || 'pending' });
      setStep('result');
      setPendingPollState('pending');
      startStatusPolling();
    } catch {
      setResult({ success: false, status: 'error', error: 'Failed to process verification. Please try again.' });
      setStep('result');
    }
  };

  const handleResubmit = async () => {
    setCancelling(true);
    try {
      await candidateApi.cancelMyPendingVerification();
    } catch { /* ignore if no pending record */ }
    if (statusPollerRef.current) clearInterval(statusPollerRef.current);
    setDocumentImage(null);
    setSelfieImage(null);
    setResult(null);
    setPendingPollState(null);
    setPollRejectionReason('');
    setStep('intro');
    setCancelling(false);
    setInitialCheckDone(true);
  };

  // Loading guard - don't show form until initial status check completes
  if (!initialCheckDone && !result) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-amber-500" />
      </div>
    );
  }

  const renderStep = () => {
    switch (step) {
      case 'intro':
        return (
          <div className="text-center space-y-6">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto" style={{ background: '#FFF6EE' }}>
              <ShieldCheck className="w-10 h-10" style={{ color: 'var(--admin-accent)' }} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Identity Verification</h2>
              <p className="text-gray-600 mt-2">
                To ensure test integrity, we need to verify your identity before you begin.
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 text-left space-y-3">
              <p className="font-medium text-gray-700">You will need:</p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-amber-500" />
                  A valid government-issued ID (National ID, Passport, or Driver's License)
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-amber-500" />
                  A working webcam for taking a selfie
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-amber-500" />
                  Good lighting conditions
                </li>
              </ul>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setStep('document')}
                className="flex-1 py-3 rounded-xl font-semibold text-sm text-white"
                style={{ background: 'var(--admin-accent)' }}
              >
                Start Verification
              </button>
              {isOptional && onSkip && (
                <button
                  onClick={onSkip}
                  className="px-5 py-3 rounded-xl font-semibold text-sm text-gray-600 border border-gray-200 hover:bg-gray-50"
                >
                  Skip
                </button>
              )}
            </div>
          </div>
        );

      case 'document':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-800">Upload Your ID Document</h2>
              <p className="text-gray-600 mt-1">Please upload a clear photo of your government-issued ID</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Document Type</label>
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value as DocumentType)}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 outline-none"
                style={{ background: 'white' }}
              >
                <option value="national_id">National ID Card</option>
                <option value="passport">Passport</option>
                <option value="drivers_license">Driver's License</option>
                <option value="student_id">Student ID</option>
              </select>
            </div>
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                documentImage ? 'border-amber-400 bg-amber-50' : 'border-gray-300 hover:border-amber-300'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleDocumentUpload}
                className="hidden"
              />
              {documentImage ? (
                <div className="space-y-3">
                  <img src={`data:image/jpeg;base64,${documentImage}`} alt="ID Document" className="max-h-48 mx-auto rounded" />
                  <p className="text-amber-600 font-medium">Document uploaded</p>
                  <button onClick={(e) => { e.stopPropagation(); setDocumentImage(null); }} className="text-sm text-red-600 hover:text-red-800">
                    Remove and upload different image
                  </button>
                </div>
              ) : (
                <>
                  <ImageIcon className="w-12 h-12 mx-auto text-gray-400" />
                  <p className="mt-2 text-gray-600">Click to upload or drag and drop</p>
                  <p className="text-sm text-gray-400">JPEG, PNG, or WebP (max 10MB)</p>
                </>
              )}
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              <strong>Tips:</strong> Ensure all text is readable, avoid glare, and include all four corners of the document.
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep('intro')} className="px-5 py-3 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50">
                Back
              </button>
              <button
                onClick={() => { if (!documentImage) { toast.error('Please upload your ID document'); return; } setStep('selfie'); startCamera(); }}
                disabled={!documentImage}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--admin-accent)' }}
              >
                Continue
              </button>
            </div>
          </div>
        );

      case 'selfie':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-800">Take a Selfie</h2>
              <p className="text-gray-600 mt-1">Position your face within the frame and click capture</p>
            </div>
            <div className="relative bg-gray-900 rounded-xl overflow-hidden aspect-video">
              {!selfieImage ? (
                <>
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover transform -scale-x-100" />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-48 h-64 border-2 border-amber-400 border-dashed rounded-full opacity-60" />
                  </div>
                </>
              ) : (
                <img src={`data:image/jpeg;base64,${selfieImage}`} alt="Selfie" className="w-full h-full object-cover transform -scale-x-100" />
              )}
            </div>
            <canvas ref={canvasRef} className="hidden" />
            <div className="rounded-lg p-3 text-sm" style={{ background: '#FFF6EE', border: '1px solid var(--admin-accent-disabled)', color: '#92400E' }}>
              <strong>Tips:</strong> Look directly at the camera, ensure good lighting, and keep a neutral expression.
            </div>
            <div className="flex gap-3">
              <button onClick={() => { stopCamera(); setSelfieImage(null); setStep('document'); }} className="px-5 py-3 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50">
                Back
              </button>
              {!selfieImage ? (
                <button onClick={handleCaptureSelfie} className="flex-1 py-3 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--admin-accent)' }}>
                  Capture Selfie
                </button>
              ) : (
                <>
                  <button onClick={() => { setSelfieImage(null); startCamera(); }} className="px-5 py-3 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50">
                    Retake
                  </button>
                  <button onClick={submitVerification} className="flex-1 py-3 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--admin-accent)' }}>
                    Submit Verification
                  </button>
                </>
              )}
            </div>
          </div>
        );

      case 'processing':
        return (
          <div className="text-center py-12 space-y-4">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 mx-auto" style={{ borderColor: 'var(--admin-accent)' }} />
            <h2 className="text-xl font-bold text-gray-800">Submitting Verification</h2>
            <p className="text-gray-600">Uploading your documents...</p>
          </div>
        );

      case 'result': {
        // Polling confirmed verified
        if (pendingPollState === 'verified') {
          return (
            <div className="text-center space-y-6">
              <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto" style={{ background: '#FFF6EE' }}>
                <CheckCircle2 className="w-10 h-10" style={{ color: 'var(--admin-accent)' }} />
              </div>
              <div>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--admin-accent-hover)' }}>Identity Verified!</h2>
                <p className="text-gray-600 mt-2">Your identity has been approved. You may now proceed with the test.</p>
              </div>
              <button onClick={onVerified} className="w-full py-3 rounded-xl font-semibold text-sm text-white" style={{ background: 'var(--admin-accent)' }}>
                Continue to Test
              </button>
            </div>
          );
        }

        // Polling confirmed rejected
        if (pendingPollState === 'rejected') {
          return (
            <div className="text-center space-y-6">
              <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <X className="w-10 h-10 text-red-600" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-red-600">Verification Rejected</h2>
                <p className="text-gray-600 mt-2">{pollRejectionReason || 'Your verification was not approved.'}</p>
              </div>
              <button
                onClick={handleResubmit}
                disabled={cancelling}
                className="w-full py-3 rounded-xl font-semibold text-sm text-white disabled:opacity-60"
                style={{ background: 'var(--admin-accent)' }}
              >
                {cancelling ? 'Resetting...' : 'Try Again'}
              </button>
            </div>
          );
        }

        // Submitted - waiting for admin decision
        if (result?.status === 'pending') {
          return (
            <div className="text-center space-y-6">
              <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto" style={{ background: '#FFF6EE' }}>
                <Clock className="w-10 h-10 animate-pulse" style={{ color: 'var(--admin-accent)' }} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Under Review</h2>
                <p className="text-gray-600 mt-2">Your ID has been submitted and is awaiting admin approval. This page will update automatically.</p>
              </div>
              <div className="flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--admin-accent-hover)' }}>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2" style={{ borderColor: 'var(--admin-accent)' }} />
                Waiting for admin decision...
              </div>
              <button
                onClick={handleResubmit}
                disabled={cancelling}
                className="w-full py-2.5 rounded-xl text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
              >
                {cancelling ? 'Cancelling...' : 'Submit a different photo'}
              </button>
            </div>
          );
        }

        // Fallback - submission error
        return (
          <div className="text-center space-y-6">
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <X className="w-10 h-10 text-red-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-red-600">Verification Failed</h2>
              <p className="text-gray-600 mt-2">{result?.error || 'We could not process your verification. Please try again.'}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setDocumentImage(null); setSelfieImage(null); setResult(null); setPendingPollState(null); setStep('intro'); setInitialCheckDone(true); }}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'var(--admin-accent)' }}
              >
                Try Again
              </button>
              {isOptional && onSkip && (
                <button onClick={onSkip} className="px-5 py-3 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50">
                  Skip
                </button>
              )}
            </div>
          </div>
        );
      }
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-8 max-w-lg mx-auto">
      {step !== 'intro' && step !== 'result' && (
        <div className="flex items-center justify-center mb-6">
          {[0, 1, 2].map((i) => {
            const active = (step === 'document' && i === 0) || (step === 'selfie' && i <= 1) || (step === 'processing' && i <= 2);
            return (
              <>
                <div key={`dot-${i}`} className="w-3 h-3 rounded-full" style={{ background: active ? 'var(--admin-accent)' : 'var(--admin-border)' }} />
                {i < 2 && <div key={`line-${i}`} className="w-16 h-1" style={{ background: (step === 'selfie' && i === 0) || step === 'processing' ? 'var(--admin-accent)' : 'var(--admin-border)' }} />}
              </>
            );
          })}
        </div>
      )}
      {renderStep()}
    </div>
  );
}
