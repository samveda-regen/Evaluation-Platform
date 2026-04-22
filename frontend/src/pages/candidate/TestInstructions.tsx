import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { candidateApi } from '../../services/api';
import { useTestStore } from '../../context/testStore';
import IDVerification from '../../components/IDVerification';
import { clearCachedStreams, getCachedStreams, setCachedStreams } from '../../services/devicePermissionService';
import { DEFAULT_CUSTOM_AI_VIOLATIONS, normalizeCustomAIViolationSelection } from '../../constants/customAIViolations';

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
    customAIViolations?: string[];
  };
  attempt: {
    id: string;
    startTime: string;
    status: string;
    violations: number;
  };
}

const TEMP_DISABLE_AUDIO_PROCTORING = true;

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
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);
  const navigate = useNavigate();
  const setTestData = useTestStore((state) => state.setTestData);

  // Attach camera stream to preview video element whenever either changes
  const setCameraPreviewVideo = useCallback((el: HTMLVideoElement | null) => {
    cameraPreviewRef.current = el;
    if (el && cameraPreviewStream) {
      el.srcObject = cameraPreviewStream;
      el.play().catch(() => {/* autoplay blocked – user interaction will trigger */});
    }
  }, [cameraPreviewStream]);

  // Keep preview video in sync with stream whenever the video ref changes
  useEffect(() => {
    if (cameraPreviewRef.current && cameraPreviewStream) {
      cameraPreviewRef.current.srcObject = cameraPreviewStream;
      cameraPreviewRef.current.play().catch(() => {});
    }
  }, [cameraPreviewStream]);

  useEffect(() => {
    // Fresh login/instructions flow should reset any previous stale streams.
    clearCachedStreams(true);
    loadTestDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTestDetails = async () => {
    try {
      const { data } = await candidateApi.getTestDetails();
      setTestDetails(data);
      const verification = await candidateApi.checkVerificationRequired(data.test.id);
      setVerificationRequired(verification.data.required);
      setVerificationComplete(verification.data.canProceed);
    } catch (error) {
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

    if (testDetails?.test.proctorEnabled && !deviceReady) {
      toast.error('Complete required device permission checks before starting');
      return;
    }

    if (testDetails?.test.proctorEnabled) {
      const cached = getCachedStreams();
      const missingCamera = testDetails.test.requireCamera && !cached.cameraStream;
      const microphoneRequired = testDetails.test.requireMicrophone && !TEMP_DISABLE_AUDIO_PROCTORING;
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
      const { data } = await candidateApi.startTest();

      // Load saved answers if any
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
        requireMicrophone: data.test.requireMicrophone && !TEMP_DISABLE_AUDIO_PROCTORING,
        requireScreenShare: data.test.requireScreenShare,
        customAIViolations: normalizeCustomAIViolationSelection(
          data.test.customAIViolations || DEFAULT_CUSTOM_AI_VIOLATIONS
        ),
        startTime: new Date(data.startTime),
        questions: data.questions,
        initialViolations: 0,
      });

      // Load saved answers
      if (
        savedAnswers.data.mcqAnswers.length > 0 ||
        savedAnswers.data.codingAnswers.length > 0 ||
        savedAnswers.data.behavioralAnswers.length > 0
      ) {
        useTestStore.getState().loadSavedAnswers(
          savedAnswers.data.mcqAnswers,
          savedAnswers.data.codingAnswers,
          savedAnswers.data.behavioralAnswers
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
    if (!testDetails?.test.proctorEnabled) {
      setDeviceReady(true);
      return;
    }

    setCheckingDevices(true);
    const required = testDetails.test;
    const microphoneRequired = required.requireMicrophone && !TEMP_DISABLE_AUDIO_PROCTORING;
    let cameraOk = !required.requireCamera;
    let microphoneOk = !microphoneRequired;
    let screenOk = !required.requireScreenShare;
    let cameraStream: MediaStream | null = null;
    let micStream: MediaStream | null = null;
    let screenStream: MediaStream | null = null;

    try {
      if (required.requireCamera || microphoneRequired) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: required.requireCamera,
          audio: microphoneRequired,
        });

        cameraOk = required.requireCamera ? stream.getVideoTracks().length > 0 : true;
        microphoneOk = microphoneRequired ? stream.getAudioTracks().length > 0 : true;
        cameraStream = required.requireCamera ? new MediaStream(stream.getVideoTracks()) : null;
        micStream = microphoneRequired ? new MediaStream(stream.getAudioTracks()) : null;
      }
    } catch (error) {
      cameraOk = !required.requireCamera;
      microphoneOk = !microphoneRequired;
    }
    if (required.requireScreenShare) {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
        screenOk = displayStream.getVideoTracks().length > 0;
        screenStream = screenOk ? displayStream : null;
      } catch (error) {
        screenOk = false;
      }
    }

    setDeviceStatus({
      camera: cameraOk,
      microphone: microphoneOk,
      screenShare: screenOk,
    });

    const ready = cameraOk && microphoneOk && screenOk;
    setDeviceReady(ready);
    if (ready) {
      setCachedStreams({
        cameraStream,
        microphoneStream: micStream,
        screenStream,
      });
      // Show camera preview so candidate can verify their position
      if (cameraStream) {
        setCameraPreviewStream(cameraStream);
      }
    } else {
      clearCachedStreams(true);
      setCameraPreviewStream(null);
    }

    if (ready) toast.success('Device permission checks passed');
    else toast.error('Required device permissions are not granted');

    setCheckingDevices(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!testDetails) return null;

  if (checkingVerification) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const { test } = testDetails;
  const microphoneRequired = test.requireMicrophone && !TEMP_DISABLE_AUDIO_PROCTORING;

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="card mb-6">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">{test.name}</h1>
          {test.description && (
            <p className="text-gray-600">{test.description}</p>
          )}
        </div>

        <div className="card mb-6">
          <h2 className="text-lg font-semibold mb-4">Test Details</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-500">Duration</p>
              <p className="text-xl font-bold text-primary-600">{test.duration} min</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Marks</p>
              <p className="text-xl font-bold">{test.totalMarks}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Passing Marks</p>
              <p className="text-xl font-bold">{test.passingMarks || 'N/A'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Negative Marking</p>
              <p className="text-xl font-bold">{test.negativeMarking > 0 ? `-${test.negativeMarking}` : 'None'}</p>
            </div>
          </div>
        </div>

        {test.instructions && (
          <div className="card mb-6">
            <h2 className="text-lg font-semibold mb-4">Instructions</h2>
            <div className="prose prose-sm max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-gray-700">
                {test.instructions}
              </pre>
            </div>
          </div>
        )}

        <div className="card mb-6 bg-red-50 border border-red-200">
          <h2 className="text-lg font-semibold mb-4 text-red-800">Important Rules</h2>
          <ul className="space-y-2 text-red-700">
            <li className="flex items-start gap-2">
              <span className="text-red-500">⚠</span>
              <span>The test must be taken in <strong>full-screen mode</strong>. Exiting full-screen will be logged.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-500">⚠</span>
              <span><strong>Tab switching</strong> and <strong>window changes</strong> will be monitored and logged.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-500">⚠</span>
              <span><strong>Copy, paste, and right-click</strong> are disabled during the test.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-500">⚠</span>
              <span>After <strong>{test.maxViolations} violations</strong>, your test will be auto-submitted.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-500">⚠</span>
              <span>The test will <strong>auto-submit</strong> when the time expires.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-500">⚠</span>
              <span>Ensure you have a <strong>stable internet connection</strong> throughout the test.</span>
            </li>
          </ul>
        </div>

        {verificationRequired && !verificationComplete && (
          <div className="card mb-6">
            <h2 className="text-lg font-semibold mb-4">ID Verification Required</h2>
            <IDVerification
              onVerified={() => {
                setVerificationComplete(true);
                toast.success('Verification completed. You can start the test.');
              }}
              onSkip={() => {
                setVerificationComplete(true);
                toast.error('ID verification was skipped with admin authorization. Proceed with strict review.');
              }}
              isOptional={false}
            />
          </div>
        )}

        {test.proctorEnabled && (
          <div className="card mb-6">
            <h2 className="text-lg font-semibold mb-4">Device Readiness Check</h2>
            <p className="text-sm text-gray-600 mb-4">
              This test uses live AI proctoring. Grant required browser permissions before starting.
            </p>
            <div className="space-y-2 mb-4 text-sm">
              <div className="flex justify-between">
                <span>Camera</span>
                <span className={deviceStatus.camera ? 'text-green-600' : 'text-red-600'}>
                  {test.requireCamera ? (deviceStatus.camera ? 'Ready' : 'Required') : 'Not required'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Microphone</span>
                <span className={deviceStatus.microphone ? 'text-green-600' : 'text-red-600'}>
                  {microphoneRequired ? (deviceStatus.microphone ? 'Ready' : 'Required') : 'Not required'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Screen Share</span>
                <span className={deviceStatus.screenShare ? 'text-green-600' : 'text-red-600'}>
                  {test.requireScreenShare
                    ? (deviceStatus.screenShare ? 'Ready' : 'Required')
                    : 'Not required'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={checkDevicePermissions}
              disabled={checkingDevices}
              className="btn btn-secondary w-full"
            >
              {checkingDevices ? 'Checking Devices...' : 'Check Camera/Mic/Screen Permissions'}
            </button>

            {/* Camera position preview – shown after permissions pass */}
            {deviceReady && test.requireCamera && cameraPreviewStream && (
              <div className="mt-4">
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Camera Position Check
                  <span className="ml-2 text-xs text-gray-500">Make sure your face is clearly visible and centred</span>
                </p>
                <div className="relative rounded-lg overflow-hidden bg-black" style={{ maxWidth: 360, margin: '0 auto' }}>
                  <video
                    ref={setCameraPreviewVideo}
                    autoPlay
                    muted
                    playsInline
                    className="w-full rounded-lg"
                    style={{ transform: 'scaleX(-1)' /* mirror so it feels natural */ }}
                  />
                  {/* Face-positioning oval guide */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div
                      className="border-4 border-green-400 rounded-full opacity-70"
                      style={{ width: '45%', height: '70%' }}
                    />
                  </div>
                  {/* Tip badge */}
                  <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                    <span className="bg-black bg-opacity-60 text-white text-xs px-3 py-1 rounded-full">
                      Align face inside the oval
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="card">
          <label className="flex items-start gap-3 mb-6">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="w-5 h-5 mt-0.5"
            />
            <span className="text-gray-700">
              I have read and understood the instructions. I agree to follow the test rules and understand
              that any violations will be logged and may result in automatic submission of my test.
            </span>
          </label>

          <button
            onClick={handleStartTest}
            disabled={
              !accepted ||
              starting ||
              (verificationRequired && !verificationComplete) ||
              (test.proctorEnabled && !deviceReady)
            }
            className="btn btn-primary w-full text-lg py-3"
          >
            {starting ? 'Starting Test...' : 'Start Test'}
          </button>
        </div>
      </div>
    </div>
  );
}
