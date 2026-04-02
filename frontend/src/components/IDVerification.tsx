/**
 * IDVerification Component
 *
 * Handles candidate identity verification:
 * - ID document capture/upload
 * - Selfie capture for face matching
 * - Liveness detection
 */

import { useState, useRef, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import api from '../services/api';

interface IDVerificationProps {
  onVerified: () => void;
  onSkip?: () => void;
  isOptional?: boolean;
}

type Step = 'intro' | 'document' | 'selfie' | 'processing' | 'result';
type DocumentType = 'national_id' | 'passport' | 'drivers_license' | 'student_id';

interface VerificationResult {
  success: boolean;
  status: string;
  scores?: {
    documentAuth: number;
    faceMatch: number;
    liveness: number;
  };
  error?: string;
}

export default function IDVerification({
  onVerified,
  onSkip,
  isOptional = false,
}: IDVerificationProps) {
  const [step, setStep] = useState<Step>('intro');
  const [documentType, setDocumentType] = useState<DocumentType>('national_id');
  const [documentImage, setDocumentImage] = useState<string | null>(null);
  const [selfieImage, setSelfieImage] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Start camera
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
    } catch (error) {
      toast.error('Failed to access camera');
    }
  }, []);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  }, [cameraStream]);

  // Capture photo from camera
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

  // Handle document upload
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

  // Handle selfie capture
  const handleCaptureSelfie = () => {
    const image = capturePhoto();
    if (image) {
      setSelfieImage(image);
      stopCamera();
    }
  };

  // Submit verification
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
        selfieImageData: selfieImage,
      });

      setResult(response.data);
      setStep('result');

      if (response.data.success) {
        toast.success('Identity verified successfully!');
      } else {
        toast.error(response.data.error || 'Verification failed');
      }
    } catch (error) {
      console.error('Verification error:', error);
      setResult({
        success: false,
        status: 'rejected',
        error: 'Failed to process verification. Please try again.',
      });
      setStep('result');
    }
  };

  // Render step content
  const renderStep = () => {
    switch (step) {
      case 'intro':
        return (
          <div className="text-center space-y-6">
            <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-10 h-10 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
              </svg>
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
                  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  A valid government-issued ID (National ID, Passport, or Driver's License)
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  A working webcam for taking a selfie
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Good lighting conditions
                </li>
              </ul>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('document')}
                className="btn btn-primary flex-1"
              >
                Start Verification
              </button>
              {isOptional && onSkip && (
                <button
                  onClick={onSkip}
                  className="btn btn-secondary"
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
              <p className="text-gray-600 mt-1">
                Please upload a clear photo of your government-issued ID
              </p>
            </div>

            {/* Document Type Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Document Type
              </label>
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value as DocumentType)}
                className="input w-full"
              >
                <option value="national_id">National ID Card</option>
                <option value="passport">Passport</option>
                <option value="drivers_license">Driver's License</option>
                <option value="student_id">Student ID</option>
              </select>
            </div>

            {/* Upload Area */}
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                documentImage ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-gray-400'
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
                  <img
                    src={`data:image/jpeg;base64,${documentImage}`}
                    alt="ID Document"
                    className="max-h-48 mx-auto rounded"
                  />
                  <p className="text-green-600 font-medium">Document uploaded</p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDocumentImage(null);
                    }}
                    className="text-sm text-red-600 hover:text-red-800"
                  >
                    Remove and upload different image
                  </button>
                </div>
              ) : (
                <>
                  <svg className="w-12 h-12 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="mt-2 text-gray-600">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-sm text-gray-400">
                    JPEG, PNG, or WebP (max 10MB)
                  </p>
                </>
              )}
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
              <strong>Tips:</strong> Ensure all text is readable, avoid glare, and include all four corners of the document.
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('intro')}
                className="btn btn-secondary"
              >
                Back
              </button>
              <button
                onClick={() => {
                  if (!documentImage) {
                    toast.error('Please upload your ID document');
                    return;
                  }
                  setStep('selfie');
                  startCamera();
                }}
                className="btn btn-primary flex-1"
                disabled={!documentImage}
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
              <p className="text-gray-600 mt-1">
                Position your face within the frame and click capture
              </p>
            </div>

            {/* Camera View */}
            <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
              {!selfieImage ? (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover transform -scale-x-100"
                  />
                  {/* Face guide overlay */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-48 h-64 border-2 border-white border-dashed rounded-full opacity-50" />
                  </div>
                </>
              ) : (
                <img
                  src={`data:image/jpeg;base64,${selfieImage}`}
                  alt="Selfie"
                  className="w-full h-full object-cover transform -scale-x-100"
                />
              )}
            </div>

            <canvas ref={canvasRef} className="hidden" />

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              <strong>Tips:</strong> Look directly at the camera, ensure good lighting, and keep a neutral expression.
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  stopCamera();
                  setSelfieImage(null);
                  setStep('document');
                }}
                className="btn btn-secondary"
              >
                Back
              </button>

              {!selfieImage ? (
                <button
                  onClick={handleCaptureSelfie}
                  className="btn btn-primary flex-1"
                >
                  Capture Selfie
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setSelfieImage(null);
                      startCamera();
                    }}
                    className="btn btn-secondary"
                  >
                    Retake
                  </button>
                  <button
                    onClick={submitVerification}
                    className="btn btn-primary flex-1"
                  >
                    Verify Identity
                  </button>
                </>
              )}
            </div>
          </div>
        );

      case 'processing':
        return (
          <div className="text-center py-12 space-y-4">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary-600 mx-auto" />
            <h2 className="text-xl font-bold text-gray-800">Verifying Your Identity</h2>
            <p className="text-gray-600">
              Please wait while we verify your documents...
            </p>
          </div>
        );

      case 'result':
        return (
          <div className="text-center space-y-6">
            {result?.success ? (
              <>
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                  <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-green-600">Verification Successful</h2>
                  <p className="text-gray-600 mt-2">
                    Your identity has been verified. You can now proceed with the test.
                  </p>
                </div>

                {result.scores && (
                  <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500">Document</p>
                      <p className="font-bold text-lg text-green-600">{result.scores.documentAuth}%</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Face Match</p>
                      <p className="font-bold text-lg text-green-600">{result.scores.faceMatch}%</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Liveness</p>
                      <p className="font-bold text-lg text-green-600">{result.scores.liveness}%</p>
                    </div>
                  </div>
                )}

                <button onClick={onVerified} className="btn btn-primary w-full">
                  Continue to Test
                </button>
              </>
            ) : (
              <>
                <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                  <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-red-600">Verification Failed</h2>
                  <p className="text-gray-600 mt-2">
                    {result?.error || 'We could not verify your identity. Please try again.'}
                  </p>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setDocumentImage(null);
                      setSelfieImage(null);
                      setResult(null);
                      setStep('intro');
                    }}
                    className="btn btn-primary flex-1"
                  >
                    Try Again
                  </button>
                  {isOptional && onSkip && (
                    <button onClick={onSkip} className="btn btn-secondary">
                      Skip
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        );
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-8 max-w-lg mx-auto">
      {/* Progress indicator */}
      {step !== 'intro' && step !== 'result' && (
        <div className="flex items-center justify-center mb-6">
          <div className={`w-3 h-3 rounded-full ${step === 'document' || step === 'selfie' || step === 'processing' ? 'bg-primary-600' : 'bg-gray-300'}`} />
          <div className={`w-16 h-1 ${step === 'selfie' || step === 'processing' ? 'bg-primary-600' : 'bg-gray-300'}`} />
          <div className={`w-3 h-3 rounded-full ${step === 'selfie' || step === 'processing' ? 'bg-primary-600' : 'bg-gray-300'}`} />
          <div className={`w-16 h-1 ${step === 'processing' ? 'bg-primary-600' : 'bg-gray-300'}`} />
          <div className={`w-3 h-3 rounded-full ${step === 'processing' ? 'bg-primary-600' : 'bg-gray-300'}`} />
        </div>
      )}

      {renderStep()}
    </div>
  );
}
