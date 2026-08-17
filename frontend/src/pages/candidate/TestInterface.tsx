import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import Editor from '@monaco-editor/react';
import { candidateApi } from '../../services/api';
import { useTestStore } from '../../context/testStore';
import { useProctoring } from '../../hooks/useProctoring';
import { SCREEN_SHARE_WRONG_SURFACE_MESSAGE } from '../../services/proctorService';
import {
  getRealtimeSocket,
  disconnectRealtimeSocket,
  ViolationDetectedPayload,
} from '../../services/realtimeService';
import {
  normalizeAIViolationType,
  normalizeCustomAIViolationSelection,
} from '../../constants/customAIViolations';
import talentstaQLogoLight from '../../assets/assessment-icons/icons/TalentstaQ logo-light.svg';

const HIGH_PRIORITY_VIOLATIONS = new Set([
  'multiple_faces', 'phone_detected', 'looking_away', 'tab_switch',
  'fullscreen_exit', 'window_blur', 'window_exit', 'focus_loss',
  'copy_attempt', 'paste_attempt', 'copy_paste', 'copy_paste_attempt',
  'devtools_open', 'secondary_monitor_detected',
]);
const LOW_PRIORITY_AI_VIOLATIONS = new Set([
  'suspicious_audio', 'unauthorized_object_detected',
]);
const TEMP_DISABLE_AUDIO_PROCTORING = true;
const TEMP_AI_PAUSE_EVENTS = new Set([
  'multiple_faces', 'phone_detected', 'secondary_monitor_detected',
]);
const ALLOWED_CANDIDATE_VIOLATIONS = new Set([
  ...HIGH_PRIORITY_VIOLATIONS, ...LOW_PRIORITY_AI_VIOLATIONS,
  'face_not_detected', 'camera_blocked',
]);

// Enrich TestQuestion with fields the backend returns but aren't typed
interface RichQuestion {
  id: string;
  type: 'mcq' | 'coding' | 'behavioral' | 'communication';
  subType?: 'WRITTEN' | 'LISTENING' | 'READING' | 'SPEAKING';
  questionId: string;
  questionText?: string;
  options?: Array<{ originalIndex: number; text: string }>;
  isMultipleChoice?: boolean;
  title?: string;
  description?: string;
  inputFormat?: string;
  outputFormat?: string;
  constraints?: string;
  sampleInput?: string;
  sampleOutput?: string;
  supportedLanguages?: string[];
  codeTemplates?: Record<string, string>;
  timeLimit?: number;
  testCases?: { input: string; expectedOutput: string; isHidden?: boolean }[];
  mediaAssets?: Array<{
    id: string; storageUrl: string; mediaType: string;
    originalName: string; mimeType: string;
  }>;
  marks?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  partialScoring?: boolean;
  // Communication (Written) — stimulusType only meaningful for subType WRITTEN
  stimulusType?: 'NONE' | 'IMAGE' | 'AUDIO';
}

export default function TestInterface() {
  const navigate = useNavigate();
  const {
    testId, testCode, testName, duration, attemptId, maxViolations,
    proctorEnabled, requireCamera, requireMicrophone, requireScreenShare,
    customAIViolations, startTime, questions, currentQuestionIndex,
    mcqAnswers, codingAnswers, behavioralAnswers, communicationAnswers, isSubmitted,
    setCurrentQuestion, saveMCQAnswer, saveCodingAnswer, saveBehavioralAnswer, saveCommunicationAnswer,
    incrementViolations, setSubmitted, violationPopupSettings,
    showTimer, autoSubmitOnTimeout,
  } = useTestStore();

  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [showWarning, setShowWarning] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [codeOutput, setCodeOutput] = useState('');
  const [runningCode, setRunningCode] = useState(false);
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(false);
  const [showYellowWarning, setShowYellowWarning] = useState(false);
  const [yellowWarningMessage, setYellowWarningMessage] = useState('');
  const [faceFrozen, setFaceFrozen] = useState(false);
  const [policyPaused, setPolicyPaused] = useState(false);
  const [policyPauseReason, setPolicyPauseReason] = useState('');
  // New state for redesigned UI
  const [markedForReview, setMarkedForReview] = useState<Set<number>>(new Set());
  const [autoSaved, setAutoSaved] = useState(false);
  const [codeSubmitted, setCodeSubmitted] = useState(false);
  const [showCameraPreview, setShowCameraPreview] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [networkQuality, setNetworkQuality] = useState<'excellent' | 'good' | 'fair' | 'poor'>('good');
  const [showNetworkInfo, setShowNetworkInfo] = useState(false);
  const [networkPopupPos, setNetworkPopupPos] = useState<{ top: number; right: number } | null>(null);
  const [timeUp, setTimeUp] = useState(false);

  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);
  const networkBtnRef = useRef<HTMLButtonElement | null>(null);
  const isFullscreenRef = useRef(false);
  const lastViolationAtRef = useRef<Record<string, number>>({});
  const proctorInitHandledRef = useRef(false);
  const antiCheatArmedRef = useRef(false);
  const testStartedAtRef = useRef<number>(Date.now());
  const policyPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentQuestion = questions[currentQuestionIndex] as RichQuestion | undefined;
  const enabledViolationSet = useMemo(
    () => new Set(normalizeCustomAIViolationSelection(customAIViolations)),
    [customAIViolations],
  );
  const isViolationEnabled = useCallback(
    (eventType: string) => enabledViolationSet.has(normalizeAIViolationType(eventType)),
    [enabledViolationSet],
  );

  const showViolationWarning = useCallback((message: string, count: number) => {
    setWarningMessage(`Warning: ${message}. Violations: ${count}/${maxViolations}`);
    setShowWarning(true);
    setTimeout(() => setShowWarning(false), 3500);
  }, [maxViolations]);

  const showTrustWarning = useCallback((message: string) => {
    setYellowWarningMessage(`AI Proctoring Alert: ${message}`);
    setShowYellowWarning(true);
    setTimeout(() => setShowYellowWarning(false), 3500);
  }, []);

  const dismissPolicyPause = useCallback(() => {
    if (policyPauseTimerRef.current) {
      clearTimeout(policyPauseTimerRef.current);
      policyPauseTimerRef.current = null;
    }
    setPolicyPaused(false);
    setPolicyPauseReason('');
  }, []);

  const triggerPolicyPause = useCallback((reason: string, durationMs = 10000) => {
    setPolicyPauseReason(reason);
    setPolicyPaused(true);
    if (policyPauseTimerRef.current) clearTimeout(policyPauseTimerRef.current);
    policyPauseTimerRef.current = setTimeout(() => {
      setPolicyPaused(false);
      setPolicyPauseReason('');
      policyPauseTimerRef.current = null;
    }, durationMs);
  }, []);

  const handleProctorViolationUI = useCallback((eventType: string, message: string) => {
    const normalizedEventType = normalizeAIViolationType(eventType);
    if (!antiCheatArmedRef.current || isSubmitted) return;
    if (!ALLOWED_CANDIDATE_VIOLATIONS.has(normalizedEventType)) return;
    if (!isViolationEnabled(normalizedEventType)) return;
    if (['camera_resumed', 'tab_switch_resume', 'window_focus_return'].includes(normalizedEventType)) return;
    const now = Date.now();
    const last = lastViolationAtRef.current[normalizedEventType] || 0;
    if (now - last < 5000) return;
    lastViolationAtRef.current[normalizedEventType] = now;

    if (normalizedEventType === 'face_not_detected') {
      setFaceFrozen(true);
    } else if (normalizedEventType === 'camera_blocked') {
      triggerPolicyPause(message, 12000);
    }

    const socket = getRealtimeSocket();
    const emitActivity = () => {
      if (testId && attemptId) {
        socket.emit('candidate-activity', {
          testId,
          activity: { attemptId, eventType: normalizedEventType, message, timestamp: new Date().toISOString() },
        });
      }
    };

    if (LOW_PRIORITY_AI_VIOLATIONS.has(normalizedEventType)) {
      showTrustWarning(message);
      emitActivity();
      return;
    }

    const newViolations = incrementViolations();
    showViolationWarning(message, newViolations);
    emitActivity();

    if (violationPopupSettings.enabled) {
      triggerPolicyPause(message, violationPopupSettings.durationSeconds * 1000);
    } else if (TEMP_AI_PAUSE_EVENTS.has(normalizedEventType)) {
      triggerPolicyPause(message, normalizedEventType === 'phone_detected' ? 15000 : 10000);
    }
  }, [incrementViolations, showViolationWarning, showTrustWarning, triggerPolicyPause, testId, attemptId, isSubmitted, isViolationEnabled, violationPopupSettings]);

  const {
    status: proctorStatus, endSession: endProctoringSession,
    error: proctorError, capturePreviewFrame, captureEvidenceFrame,
    cameraStream, resumeScreenShare,
  } = useProctoring(attemptId || '', {
    enabled: proctorEnabled,
    enableCamera: requireCamera,
    enableMicrophone: requireMicrophone && !TEMP_DISABLE_AUDIO_PROCTORING,
    enableScreenShare: requireScreenShare,
    enableFaceDetection: true,
    enableAudioAnalysis: !TEMP_DISABLE_AUDIO_PROCTORING,
    enableMonitorDetection: true,
    enabledViolationEvents: Array.from(enabledViolationSet),
    onViolation: (violation) => {
      handleProctorViolationUI(violation.eventType, violation.description);
      if (testId && attemptId) {
        const socket = getRealtimeSocket();
        socket.emit('proctor-violation', {
          testId, attemptId,
          violation: { type: violation.eventType, severity: violation.severity, description: violation.description, timestamp: new Date().toISOString() },
        });
      }
    },
    onTerminate: () => { handleAutoSubmit(); },
  });

  const proctorStatusRef = useRef(proctorStatus);
  const hiddenAtRef = useRef<number | null>(null);
  const blurAtRef = useRef<number | null>(null);
  const isTestFrozen = proctorStatus.testFrozen || faceFrozen || policyPaused;
  const answeringLocked = isTestFrozen || timeUp;

  useEffect(() => { proctorStatusRef.current = proctorStatus; }, [proctorStatus]);

  useEffect(() => {
    if (timeUp && !isSubmitted) setShowConfirmSubmit(true);
  }, [timeUp, isSubmitted]);

  useEffect(() => {
    if (!proctorEnabled) return;
    if (proctorStatus.faceDetected && faceFrozen) setFaceFrozen(false);
  }, [proctorStatus.faceDetected, faceFrozen, proctorEnabled]);

  useEffect(() => {
    testStartedAtRef.current = Date.now();
    antiCheatArmedRef.current = false;
    const armTimer = setTimeout(() => { antiCheatArmedRef.current = true; }, 15000);
    return () => clearTimeout(armTimer);
  }, []);

  useEffect(() => {
    return () => { if (policyPauseTimerRef.current) clearTimeout(policyPauseTimerRef.current); };
  }, []);

  useEffect(() => {
    if (!proctorError || proctorInitHandledRef.current || !proctorEnabled) return;
    const lowered = proctorError.toLowerCase();
    if (proctorError === SCREEN_SHARE_WRONG_SURFACE_MESSAGE) {
      proctorInitHandledRef.current = true;
      toast.error(SCREEN_SHARE_WRONG_SURFACE_MESSAGE, { duration: 8000 });
      navigate('/test/instructions');
    } else if (lowered.includes('camera permission denied') || lowered.includes('microphone permission denied') || lowered.includes('screen share permission denied')) {
      proctorInitHandledRef.current = true;
      toast.error('Required proctoring permission missing. Complete Device Check once, then start test.');
      navigate('/test/instructions');
    }
  }, [proctorError, proctorEnabled, navigate]);

  useEffect(() => {
    if (!proctorEnabled || !testId || !attemptId) return;
    const socket = getRealtimeSocket();
    socket.emit('candidate-proctor-join', { testId, attemptId });
    const handleRealtimeViolation = (payload: ViolationDetectedPayload) => {
      if (!payload || payload.attemptId !== attemptId) return;
      handleProctorViolationUI(payload.violation.type, payload.violation.description);
    };
    socket.on('violation-detected', handleRealtimeViolation);
    const statusInterval = setInterval(() => {
      const s = proctorStatusRef.current;
      socket.emit('proctor-status', { testId, attemptId, status: { cameraOn: s.cameraEnabled, micOn: s.microphoneEnabled, screenSharing: s.screenShareEnabled, faceDetected: s.faceDetected, lookingAtScreen: s.lookingAtScreen, cameraBlocked: s.cameraBlocked, testFrozen: s.testFrozen, monitorCount: s.monitorCount } });
    }, 5000);
    const frameInterval = setInterval(() => {
      const frame = capturePreviewFrame({ quality: 0.45, maxWidth: 360 });
      if (!frame) return;
      socket.emit('candidate-live-frame', { testId, attemptId, frame, timestamp: new Date().toISOString() });
    }, 6000);
    return () => {
      socket.off('violation-detected', handleRealtimeViolation);
      clearInterval(statusInterval);
      clearInterval(frameInterval);
      disconnectRealtimeSocket();
    };
  }, [proctorEnabled, testId, attemptId, capturePreviewFrame, handleProctorViolationUI]);

  useEffect(() => {
    if (!startTime || !duration) { navigate('/test/login'); return; }
    const startTimeMs = startTime instanceof Date ? startTime.getTime() : new Date(startTime).getTime();
    if (isNaN(startTimeMs)) { navigate('/test/login'); return; }
    const endTime = startTimeMs + duration * 60 * 1000;
    const updateTimer = () => {
      const remaining = Math.max(0, endTime - Date.now());
      setTimeRemaining(remaining);
      if (remaining === 0 && !isSubmitted) {
        if (autoSubmitOnTimeout) handleAutoSubmit();
        else setTimeUp(true);
      }
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [startTime, duration, isSubmitted, autoSubmitOnTimeout]);

  useEffect(() => {
    const requestFullscreen = async () => {
      try {
        await document.documentElement.requestFullscreen();
        isFullscreenRef.current = true;
        setShowFullscreenPrompt(false);
      } catch {
        setShowFullscreenPrompt(true);
        isFullscreenRef.current = false;
      }
    };
    setTimeout(requestFullscreen, 500);
    return () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isFullscreenRef.current && !isSubmitted) {
        // Show the "Continue in Fullscreen" prompt immediately from the local browser
        // event — don't wait on handleViolation's network round trip (which includes a
        // synchronous snapshot upload on the backend and can take several seconds) just
        // to reflect state we already know locally.
        setShowFullscreenPrompt(true);
        handleViolation('fullscreen_exit', 'You exited full-screen mode');
      }
      isFullscreenRef.current = !!document.fullscreenElement;
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isSubmitted]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && !isSubmitted) {
        hiddenAtRef.current = Date.now();
        handleViolation('tab_switch', 'You switched to another tab');
      } else if (!document.hidden && hiddenAtRef.current) {
        const durationMs = Date.now() - hiddenAtRef.current;
        hiddenAtRef.current = null;
        candidateApi.logActivity({ eventType: 'tab_switch_resume', eventData: { message: 'Candidate returned to test tab', durationMs, timestamp: new Date().toISOString() } }).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isSubmitted]);

  useEffect(() => {
    const handleBlur = () => {
      if (document.hidden || isSubmitted) return;
      blurAtRef.current = Date.now();
      handleViolation('window_exit', 'Test window lost focus');
    };
    const handleFocus = () => {
      if (!isSubmitted && blurAtRef.current) {
        const durationMs = Date.now() - blurAtRef.current;
        blurAtRef.current = null;
        candidateApi.logActivity({ eventType: 'window_focus_return', eventData: { message: 'Candidate returned to test window', durationMs, timestamp: new Date().toISOString() } }).catch(() => {});
      }
    };
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    return () => { window.removeEventListener('blur', handleBlur); window.removeEventListener('focus', handleFocus); };
  }, [isSubmitted]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isSubmitted) { e.preventDefault(); }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isSubmitted]);

  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => { e.preventDefault(); handleViolation('copy_attempt', 'Copy attempt detected'); };
    const handlePaste = (e: ClipboardEvent) => { e.preventDefault(); handleViolation('paste_attempt', 'Paste attempt detected'); };
    const handleContextMenu = (e: MouseEvent) => { e.preventDefault(); };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && ['c', 'v', 'p'].includes(e.key.toLowerCase())) e.preventDefault();
      if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['i', 'j'].includes(e.key.toLowerCase()))) {
        e.preventDefault();
        handleViolation('devtools_open', 'Developer tools attempt detected');
      }
    };
    document.addEventListener('copy', handleCopy);
    document.addEventListener('paste', handlePaste);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('paste', handlePaste);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSubmitted]);

  useEffect(() => {
    if (isSubmitted) return;
    const interval = setInterval(() => {
      if (window.outerWidth - window.innerWidth > 160 || window.outerHeight - window.innerHeight > 160)
        handleViolation('devtools_open', 'Developer tools window detected');
    }, 4000);
    return () => clearInterval(interval);
  }, [isSubmitted]);

  useEffect(() => {
    autoSaveRef.current = setInterval(() => { saveCurrentAnswer(true); }, 30000);
    return () => { if (autoSaveRef.current) clearInterval(autoSaveRef.current); };
  }, [currentQuestionIndex, mcqAnswers, codingAnswers, behavioralAnswers]);

  useEffect(() => {
    if (!currentQuestion || currentQuestion.type !== 'coding') return;
    const questionId = currentQuestion.questionId;
    const existingAnswer = codingAnswers[questionId];
    if (!existingAnswer || !existingAnswer.code) {
      const templates = currentQuestion.codeTemplates;
      const defaultLang = currentQuestion.supportedLanguages?.[0] || 'python';
      const template = templates?.[defaultLang] || '';
      if (template) saveCodingAnswer(questionId, template, defaultLang);
    }
  }, [currentQuestion?.questionId]);

  useEffect(() => { setCodeOutput(''); setCodeSubmitted(false); }, [currentQuestionIndex]);

  useEffect(() => {
    if (showCameraPreview && cameraPreviewRef.current && cameraStream) {
      cameraPreviewRef.current.srcObject = cameraStream;
      cameraPreviewRef.current.play().catch(() => {});
    }
    if (!showCameraPreview && cameraPreviewRef.current) {
      cameraPreviewRef.current.srcObject = null;
    }
  }, [showCameraPreview, cameraStream]);

  useEffect(() => {
    if (!showCameraPreview) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-camera-preview]')) setShowCameraPreview(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCameraPreview]);

  // Ping measurement — fires every 6s, pings the same origin
  useEffect(() => {
    const measure = async () => {
      try {
        const t0 = performance.now();
        await fetch(window.location.origin + '/favicon.ico', { method: 'HEAD', cache: 'no-store' });
        const ms = Math.round(performance.now() - t0);
        setPingMs(ms);
        setNetworkQuality(ms < 80 ? 'excellent' : ms < 180 ? 'good' : ms < 350 ? 'fair' : 'poor');
      } catch {
        setPingMs(null);
        setNetworkQuality('poor');
      }
    };
    measure();
    const id = setInterval(measure, 6000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!showNetworkInfo) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-network-info]')) setShowNetworkInfo(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNetworkInfo]);

  const handleViolation = useCallback(async (eventType: string, message: string) => {
    const normalizedEventType = normalizeAIViolationType(eventType);
    if (!antiCheatArmedRef.current || isSubmitted) return;
    if (!ALLOWED_CANDIDATE_VIOLATIONS.has(normalizedEventType)) return;
    if (!isViolationEnabled(normalizedEventType)) return;
    const newViolations = incrementViolations();
    const violationEvidence = captureEvidenceFrame({ quality: 0.82, maxWidth: 1366 });
    const snapshotData = violationEvidence.snapshotData;
    const confidence = normalizedEventType === 'devtools_open' ? 98 : 90;
    const durationMs = normalizedEventType === 'tab_switch' ? (hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0) : normalizedEventType === 'window_blur' ? (blurAtRef.current ? Date.now() - blurAtRef.current : 0) : 0;
    try {
      const response = await candidateApi.logActivity({ eventType: normalizedEventType, eventData: { message, confidence, durationMs, snapshotData, snapshotSource: violationEvidence.snapshotSource, timestamp: new Date().toISOString() } });
      const backendViolationCount = Number(response?.data?.violationCount);
      const effectiveViolations = Number.isFinite(backendViolationCount) ? backendViolationCount : newViolations;
      if (Number.isFinite(backendViolationCount)) useTestStore.setState({ violations: backendViolationCount });
      showViolationWarning(message, effectiveViolations);
      if (violationPopupSettings.enabled) {
        triggerPolicyPause(message, violationPopupSettings.durationSeconds * 1000);
      }
      if (testId && attemptId) {
        const socket = getRealtimeSocket();
        socket.emit('candidate-activity', { testId, activity: { attemptId, eventType: normalizedEventType, message, timestamp: new Date().toISOString() } });
      }
      if (response.data.autoSubmit === true) handleAutoSubmit();
      else if (!document.fullscreenElement) setShowFullscreenPrompt(true);
    } catch (error) { console.error('Failed to log activity:', error); }
  }, [incrementViolations, isSubmitted, captureEvidenceFrame, isViolationEnabled, violationPopupSettings, triggerPolicyPause]);

  const handleReenterFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      isFullscreenRef.current = true;
      setShowFullscreenPrompt(false);
    } catch { toast.error('Please enable fullscreen to continue the test'); }
  };

  const [resumingScreenShare, setResumingScreenShare] = useState(false);
  const handleResumeScreenShare = async () => {
    setResumingScreenShare(true);
    try {
      const resumed = await resumeScreenShare();
      if (resumed) toast.success('Screen sharing resumed');
    } finally {
      setResumingScreenShare(false);
    }
  };

  const saveCurrentAnswer = async (silent = false) => {
    if (!currentQuestion || isSubmitted) return;
    try {
      if (currentQuestion.type === 'mcq') {
        const answer = mcqAnswers[currentQuestion.questionId];
        if (answer && answer.length > 0) await candidateApi.saveMCQAnswer({ questionId: currentQuestion.questionId, selectedOptions: answer });
      } else if (currentQuestion.type === 'coding') {
        const answer = codingAnswers[currentQuestion.questionId];
        if (answer && answer.code) await candidateApi.saveCodingAnswer({ questionId: currentQuestion.questionId, code: answer.code, language: answer.language });
      } else if (currentQuestion.type === 'behavioral') {
        await candidateApi.saveBehavioralAnswer({ questionId: currentQuestion.questionId, answerText: behavioralAnswers[currentQuestion.questionId] || '' });
      } else if (currentQuestion.type === 'communication' && currentQuestion.subType === 'WRITTEN') {
        await candidateApi.saveCommunicationAnswer({ questionId: currentQuestion.questionId, answerText: communicationAnswers[currentQuestion.questionId] || '' });
      }
      if (silent) {
        setAutoSaved(true);
        setTimeout(() => setAutoSaved(false), 3000);
      }
    } catch (error) { console.error('Failed to auto-save:', error); }
  };

  const handleSaveAndNext = async () => {
    if (isTestFrozen) return;
    await saveCurrentAnswer();
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestion(currentQuestionIndex + 1);
    } else {
      setShowConfirmSubmit(true);
    }
  };

  const toggleMarkForReview = () => {
    const newSet = new Set(markedForReview);
    if (newSet.has(currentQuestionIndex)) newSet.delete(currentQuestionIndex);
    else newSet.add(currentQuestionIndex);
    setMarkedForReview(newSet);
  };

  const handleMCQSelect = (originalIndex: number) => {
    if (isSubmitted || answeringLocked) return;
    const questionId = currentQuestion!.questionId;
    const isMultiple = currentQuestion!.isMultipleChoice;
    const currentSelected = mcqAnswers[questionId] || [];
    const newSelected = isMultiple
      ? (currentSelected.includes(originalIndex) ? currentSelected.filter((i) => i !== originalIndex) : [...currentSelected, originalIndex])
      : [originalIndex];
    saveMCQAnswer(questionId, newSelected);
  };

  const handleCodeChange = (value: string | undefined) => {
    if (isSubmitted || answeringLocked || !value) return;
    const questionId = currentQuestion!.questionId;
    const currentAnswer = codingAnswers[questionId] || { code: '', language: 'python' };
    saveCodingAnswer(questionId, value, currentAnswer.language);
  };

  const handleLanguageChange = (language: string) => {
    if (isSubmitted || answeringLocked) return;
    const questionId = currentQuestion!.questionId;
    const currentAnswer = codingAnswers[questionId] || { code: '', language: 'python' };
    let newCode = currentAnswer.code;
    const templates = currentQuestion!.codeTemplates;
    if (templates) {
      const oldTemplate = templates[currentAnswer.language] || '';
      const newTemplate = templates[language] || '';
      if (!(currentAnswer.code || '').trim() || (currentAnswer.code || '').trim() === oldTemplate.trim()) newCode = newTemplate;
    }
    saveCodingAnswer(questionId, newCode, language);
  };

  const handleRunCode = async () => {
    if (runningCode || isSubmitted || answeringLocked) return;
    const answer = codingAnswers[currentQuestion!.questionId];
    if (!answer || !answer.code) { toast.error('Please write some code first'); return; }
    setRunningCode(true);
    setCodeOutput('Running...');
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 60000));
    try {
      const apiPromise = candidateApi.runCode({ questionId: currentQuestion!.questionId, code: answer.code, language: answer.language, input: currentQuestion!.sampleInput });
      const { data } = await Promise.race([apiPromise, timeoutPromise]) as { data: { result: { success: boolean; output?: string; error?: string; executionTime?: number } } };
      if (data.result.success) setCodeOutput(`${data.result.output || ''}\n\nExecution time: ${data.result.executionTime}ms`);
      else setCodeOutput(`Error:\n${data.result.error}`);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'timeout') setCodeOutput('Error: Code execution timed out.');
      else setCodeOutput('Failed to run code. Please try again.');
    } finally { setRunningCode(false); }
  };

  const handleSubmitCode = async () => {
    if (isSubmitted || answeringLocked) return;
    await saveCurrentAnswer();
    setCodeSubmitted(true);
    toast.success('Code answer saved');
  };

  const handleBehavioralChange = (value: string) => {
    if (isSubmitted || timeUp) return;
    saveBehavioralAnswer(currentQuestion!.questionId, value);
  };

  const handleCommunicationChange = (value: string) => {
    if (isSubmitted || timeUp) return;
    saveCommunicationAnswer(currentQuestion!.questionId, value);
  };

  // The server also auto-submits attempts whose time has run out (a safety net that
  // fires even if this tab is closed/inactive), so it can beat this client to the
  // punch. Treat "already submitted" as success rather than an error in that race.
  const isAlreadySubmittedError = (err: unknown) =>
    (err as { response?: { status?: number } })?.response?.status === 400;

  const handleAutoSubmit = async () => {
    if (isSubmitted || submitting) return;
    setSubmitting(true);
    await saveCurrentAnswer();
    try {
      await endProctoringSession();
      const { data: submitResult } = await candidateApi.submitTest({ autoSubmit: true });
      setSubmitted(submitResult);
      toast.success('Test auto-submitted');
      const previewId = localStorage.getItem('previewMode');
      if (previewId) { localStorage.removeItem('previewMode'); navigate(`/admin/tests/${previewId}`); }
      else navigate('/test/complete');
    } catch (err) {
      if (isAlreadySubmittedError(err)) { navigate('/test/complete'); return; }
      toast.error('Failed to submit test'); setSubmitting(false);
    }
  };

  const handleManualSubmit = async () => {
    if (isSubmitted || submitting || isTestFrozen) return;
    setSubmitting(true);
    await saveCurrentAnswer();
    try {
      await endProctoringSession();
      const { data: submitResult } = await candidateApi.submitTest({ autoSubmit: false });
      setSubmitted(submitResult);
      toast.success('Test submitted successfully');
      const previewId = localStorage.getItem('previewMode');
      if (previewId) { localStorage.removeItem('previewMode'); navigate(`/admin/tests/${previewId}`); }
      else navigate('/test/complete');
    } catch (err) {
      if (isAlreadySubmittedError(err)) { navigate('/test/complete'); return; }
      toast.error('Failed to submit test'); setSubmitting(false);
    }
  };

  const formatTime = (ms: number) => {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const getAnsweredCount = () => {
    let count = 0;
    questions.forEach((q) => {
      if (q.type === 'mcq' && mcqAnswers[q.questionId]?.length > 0) count++;
      if (q.type === 'coding' && codingAnswers[q.questionId]?.code) count++;
      if (q.type === 'behavioral' && (behavioralAnswers[q.questionId] || '').trim().length > 0) count++;
      if (q.type === 'communication' && (communicationAnswers[q.questionId] || '').trim().length > 0) count++;
    });
    return count;
  };

  const getWordCount = (text: string) =>
    text.trim() ? text.trim().split(/\s+/).length : 0;

  const watermarkCode = testCode || (testId ? testId.slice(0, 8).toUpperCase() : 'TEST');
  const watermarkBackground = useMemo(() => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='360' height='220'><g transform='rotate(-28 180 110)'><text x='18' y='90' fill='rgba(30,64,175,0.08)' font-size='30' font-family='Segoe UI,Arial,sans-serif' font-weight='700'>${watermarkCode}</text><text x='120' y='190' fill='rgba(30,64,175,0.08)' font-size='30' font-family='Segoe UI,Arial,sans-serif' font-weight='700'>${watermarkCode}</text></g></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }, [watermarkCode]);

  if (!testId || !currentQuestion) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#F8FAFC' }}>
        <div className="text-center">
          <p className="text-gray-500 mb-4">Invalid test state</p>
          <button onClick={() => navigate('/test/login')} className="btn btn-primary">Return to Login</button>
        </div>
      </div>
    );
  }

  const isCoding = currentQuestion.type === 'coding';
  const isAnswered = (idx: number) => {
    const q = questions[idx];
    if (!q) return false;
    if (q.type === 'mcq') return (mcqAnswers[q.questionId]?.length || 0) > 0;
    if (q.type === 'coding') return !!codingAnswers[q.questionId]?.code;
    if (q.type === 'communication') return (communicationAnswers[q.questionId] || '').trim().length > 0;
    return (behavioralAnswers[q.questionId] || '').trim().length > 0;
  };

  const difficultyColor: Record<string, string> = {
    easy: 'var(--admin-accent-hover)', medium: 'var(--admin-accent-hover)', hard: 'var(--admin-accent-hover)',
  };
  const typeColor: Record<string, string> = {
    mcq: 'var(--admin-accent-hover)', coding: 'var(--admin-accent-hover)', behavioral: 'var(--admin-accent-hover)', communication: 'var(--admin-accent-hover)',
  };
  const typeLabel: Record<string, string> = {
    mcq: 'Multiple choice', coding: 'Coding', behavioral: 'Behavioral', communication: 'Written',
  };

  const totalTestCases = currentQuestion.testCases?.length ?? 0;
  const hiddenTestCases = currentQuestion.testCases?.filter((tc) => tc.isHidden).length ?? 0;

  const behavioralText = currentQuestion.type === 'behavioral' ? (behavioralAnswers[currentQuestion.questionId] || '') : '';
  const communicationText = currentQuestion.type === 'communication' ? (communicationAnswers[currentQuestion.questionId] || '') : '';
  const wordCount = getWordCount(currentQuestion.type === 'communication' ? communicationText : behavioralText);

  // -- Question Palette --------------------------------------------------
  const Palette = () => (
    <aside className="w-52 border-l bg-white flex flex-col overflow-hidden" style={{ borderColor: 'var(--admin-border)' }}>
      <div className="px-4 pt-5 pb-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-gray-700">Question palette</span>
          <span className="text-sm text-gray-400">{getAnsweredCount()}/{questions.length}</span>
        </div>
        {/* Progress bar */}
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${(getAnsweredCount() / questions.length) * 100}%`, background: 'var(--admin-accent)' }}
          />
        </div>
      </div>

      {/* Number grid */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="grid grid-cols-5 gap-1.5">
          {questions.map((_, idx) => {
            const isCurrent = idx === currentQuestionIndex;
            const answered = isAnswered(idx);
            const marked = markedForReview.has(idx);

            let bg = '#FFFFFF';
            let border = '#E0E0E0';
            let textColor = '#9CA3AF';

            if (isCurrent) { bg = '#C62828'; border = '#C62828'; textColor = '#FFFFFF'; }
            else if (marked) { bg = '#6A1B9A'; border = '#6A1B9A'; textColor = '#FFFFFF'; }
            else if (answered) { bg = '#2E7D32'; border = '#2E7D32'; textColor = '#FFFFFF'; }

            return (
              <button
                key={idx}
                onClick={() => {
                  if (isTestFrozen) return;
                  saveCurrentAnswer();
                  setCurrentQuestion(idx);
                }}
                className="aspect-square rounded-lg text-xs font-semibold transition-colors flex items-center justify-center outline-none focus:outline-none focus-visible:outline-none"
                style={{ background: bg, border: `1.5px solid ${border}`, color: textColor, outline: 'none', boxShadow: 'none' }}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="border-t px-4 py-4 space-y-2" style={{ borderColor: 'var(--admin-border)' }}>
        {[
          { color: '#2E7D32', border: '#2E7D32', label: 'Answered' },
          { color: '#6A1B9A', border: '#6A1B9A', label: 'Marked for review' },
          { color: '#C62828', border: '#C62828', label: 'Current' },
          { color: '#FFFFFF', border: '#E0E0E0', label: 'Not visited' },
        ].map(({ color, border, label }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-4 h-4 rounded flex-shrink-0" style={{ background: color, border: `1.5px solid ${border}` }} />
            <span className="text-xs text-gray-500">{label}</span>
          </div>
        ))}
      </div>
    </aside>
  );

  // -- Bottom nav bar ---------------------------------------------------
  const BottomNav = () => (
    <footer className="bg-white border-t flex items-center justify-between px-6 py-3" style={{ borderColor: 'var(--admin-border)' }}>
      <button
        onClick={() => {
          if (isTestFrozen || currentQuestionIndex === 0) return;
          saveCurrentAnswer();
          setCurrentQuestion(currentQuestionIndex - 1);
        }}
        disabled={currentQuestionIndex === 0 || isTestFrozen}
        className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Previous
      </button>

      <button
        onClick={toggleMarkForReview}
        className="flex items-center gap-2 text-sm font-medium transition-colors"
        style={{ color: markedForReview.has(currentQuestionIndex) ? 'var(--admin-accent-hover)' : '#9CA3AF' }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill={markedForReview.has(currentQuestionIndex) ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 21l1.9-5.7a8.5 8.5 0 113.8 3.8z" />
        </svg>
        Mark for review
      </button>

      <button
        onClick={handleSaveAndNext}
        disabled={isTestFrozen}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
        style={{ background: currentQuestionIndex === questions.length - 1 ? '#DC2626' : 'var(--admin-accent)' }}
      >
        {currentQuestionIndex === questions.length - 1 ? 'Submit Test' : 'Save & Next'}
        {currentQuestionIndex < questions.length - 1 && (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        )}
      </button>
    </footer>
  );

  return (
    <div
      className="test-container no-select flex flex-col relative overflow-hidden"
      style={{ height: '100vh', background: '#F8FAFC' }}
    >
      {/* Watermark */}
      <div
        className="pointer-events-none fixed inset-0 z-20"
        style={{ backgroundImage: `${watermarkBackground}, ${watermarkBackground}`, backgroundRepeat: 'repeat', backgroundSize: '360px 220px', backgroundPosition: '0 0, 180px 110px' }}
      />

      {/* Violation banners */}
      {showWarning && (
        <div className="fixed top-14 left-0 right-0 bg-red-600 text-white py-2 px-4 z-50 text-sm font-medium shadow">
          <div className="mx-auto flex max-w-5xl items-center justify-center gap-3">
            <span className="text-center">{warningMessage}</span>
            <button
              type="button"
              aria-label="Dismiss warning"
              onClick={() => setShowWarning(false)}
              className="flex h-6 w-6 items-center justify-center rounded text-lg leading-none transition-colors hover:bg-white/15"
            >
              &times;
            </button>
          </div>
        </div>
      )}
      {!showWarning && showYellowWarning && (
        <div className="fixed top-14 left-0 right-0 bg-amber-500 text-white py-2 px-4 z-50 text-sm font-medium shadow">
          <div className="mx-auto flex max-w-5xl items-center justify-center gap-3">
            <span className="text-center">{yellowWarningMessage}</span>
            <button
              type="button"
              aria-label="Dismiss alert"
              onClick={() => setShowYellowWarning(false)}
              className="flex h-6 w-6 items-center justify-center rounded text-lg leading-none transition-colors hover:bg-white/15"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Fullscreen prompt */}
      {showFullscreenPrompt && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: '#FEF2F2' }}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Fullscreen Required</h2>
            <p className="text-sm text-gray-500 mb-6">You exited fullscreen. Click below to continue your test.</p>
            <button onClick={handleReenterFullscreen} className="w-full py-3 rounded-xl font-semibold text-white text-sm" style={{ background: 'var(--admin-accent)' }}>
              Continue in Fullscreen
            </button>
          </div>
        </div>
      )}

      {/* Screen share stopped prompt */}
      {proctorStatus.screenShareLost && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: '#FEF2F2' }}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Screen Sharing Stopped</h2>
            <p className="text-sm text-gray-500 mb-6">You stopped sharing your screen. Share your entire screen again to continue the test.</p>
            <button
              onClick={handleResumeScreenShare}
              disabled={resumingScreenShare}
              className="w-full py-3 rounded-xl font-semibold text-white text-sm disabled:opacity-60"
              style={{ background: 'var(--admin-accent)' }}
            >
              {resumingScreenShare ? 'Requesting…' : 'Resume Screen Sharing'}
            </button>
          </div>
        </div>
      )}

      {/* Test frozen overlay */}
      {isTestFrozen && (
        <div className="fixed inset-0 bg-black/70 z-[70] flex items-center justify-center px-4">
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
            {policyPaused && !faceFrozen && !proctorStatus.testFrozen && (
              <button
                type="button"
                aria-label="Close pause popup"
                onClick={dismissPolicyPause}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-xl leading-none transition-colors hover:bg-gray-100"
                style={{ color: '#64748B' }}
              >
                &times;
              </button>
            )}
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: '#FEF2F2' }}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Test Paused</h2>
            <p className="text-gray-600 text-sm">
              {faceFrozen
                ? 'No face detected. Please position your face clearly in front of the camera.'
                : proctorStatus.testFrozen
                  ? proctorStatus.freezeReason || 'Camera view is blocked. Please remove the obstruction.'
                  : policyPauseReason || 'Proctoring policy pause active. Please wait.'}
            </p>
            <p className="text-xs text-gray-400 mt-3">
              {faceFrozen
                ? 'Test resumes automatically when your face is detected.'
                : policyPaused && !proctorStatus.testFrozen
                  ? 'Test resumes automatically, or you can close this message.'
                  : 'Test resumes automatically.'}
            </p>
          </div>
        </div>
      )}

      {/* -- Header -- */}
      <header className="flex items-center justify-between px-5 py-3 flex-shrink-0 relative z-10" style={{ background: '#0F172A' }}>
        {/* Left: back + logo + test name + proctoring */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowExitConfirm(true)}
            className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
            style={{ color: '#94A3B8', background: '#1E293B' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#F1F5F9')}
            onMouseLeave={e => (e.currentTarget.style.color = '#94A3B8')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <img src={talentstaQLogoLight} alt="TalentstaQ" style={{ height: '28px', width: 'auto', flexShrink: 0 }} />
          <span className="text-white font-semibold text-sm">{testName}</span>
          {proctorEnabled && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full" style={{ background: 'rgba(245,158,11,0.18)', border: '1px solid rgba(245,158,11,0.55)' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#22C55E' }} />
              <span className="text-xs font-medium" style={{ color: '#F59E0B' }}>Proctoring active</span>
            </div>
          )}
        </div>

        {/* Right: icons + timer */}
        <div className="flex items-center gap-3">
          {/* Network strength icon */}
          {(() => {
            const qColor = { excellent: '#22C55E', good: '#F59E0B', fair: '#F97316', poor: '#EF4444' }[networkQuality];
            const bars = { excellent: 3, good: 2, fair: 1, poor: 0 }[networkQuality];
            const dimColor = '#334155';
            return (
              <button
                ref={networkBtnRef}
                data-network-info
                onClick={() => {
                  if (networkBtnRef.current) {
                    const r = networkBtnRef.current.getBoundingClientRect();
                    setNetworkPopupPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
                  }
                  setShowNetworkInfo(v => !v);
                }}
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
                style={{ background: showNetworkInfo ? `${qColor}18` : 'transparent' }}
                title={`Network: ${networkQuality}${pingMs !== null ? ` · ${pingMs}ms` : ''}`}
              >
                <svg width="16" height="14" viewBox="0 0 24 21" fill="none">
                  {/* Dot */}
                  <circle cx="12" cy="19.5" r="2" fill={qColor} />
                  {/* Arc 1 — smallest */}
                  <path d="M8.8 15.2 Q12 12.4 15.2 15.2" stroke={bars >= 1 ? qColor : dimColor} strokeWidth="2.2" strokeLinecap="round" fill="none" />
                  {/* Arc 2 — medium */}
                  <path d="M5.2 11.6 Q12 6.2 18.8 11.6" stroke={bars >= 2 ? qColor : dimColor} strokeWidth="2.2" strokeLinecap="round" fill="none" />
                  {/* Arc 3 — largest */}
                  <path d="M1.6 8.0 Q12 0.0 22.4 8.0" stroke={bars >= 3 ? qColor : dimColor} strokeWidth="2.2" strokeLinecap="round" fill="none" />
                </svg>
              </button>
            );
          })()}

          {requireCamera && (
            <button
              data-camera-preview
              onClick={() => setShowCameraPreview(v => !v)}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: showCameraPreview ? '#22C55E' : '#CBD5E1', background: showCameraPreview ? 'rgba(34,197,94,0.12)' : 'transparent' }}
              title="Camera preview"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
            </button>
          )}
          {requireMicrophone && (
            <button className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors" style={{ color: '#CBD5E1' }}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 3a4 4 0 014 4v4a4 4 0 01-8 0V7a4 4 0 014-4z" />
              </svg>
            </button>
          )}
          {/* Timer */}
          {showTimer && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: timeRemaining < 300000 ? 'rgba(239,68,68,0.18)' : 'rgba(245,158,11,0.18)', border: `1px solid ${timeRemaining < 300000 ? 'rgba(239,68,68,0.55)' : 'rgba(245,158,11,0.55)'}` }}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke={timeRemaining < 300000 ? '#EF4444' : '#F59E0B'} strokeWidth={1.8}>
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
              </svg>
              <span
                className="text-sm font-bold font-mono tabular-nums"
                style={{ color: timeRemaining < 300000 ? '#EF4444' : '#F59E0B' }}
              >
                {formatTime(timeRemaining)}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* -- Content -- */}
      <div className="flex flex-1 overflow-hidden relative z-10">
        {isCoding ? (
          // -- Coding: three-column layout --
          <>
            <div className="flex flex-1 overflow-hidden">
              {/* Description panel */}
              <div className="w-[42%] bg-white overflow-y-auto border-r flex-shrink-0" style={{ borderColor: 'var(--admin-border)' }}>
                <div className="p-6">
                  {/* Breadcrumb */}
                  <div className="flex items-center gap-2 flex-wrap mb-4">
                    <span className="text-xs font-semibold" style={{ color: typeColor['coding'] }}>
                      {typeLabel['coding']}
                    </span>
                    {currentQuestion.difficulty && (
                      <>
                        <span className="text-gray-300 text-xs">·</span>
                        <span className="text-xs font-semibold" style={{ color: difficultyColor[currentQuestion.difficulty] }}>
                          {currentQuestion.difficulty.charAt(0).toUpperCase() + currentQuestion.difficulty.slice(1)}
                        </span>
                      </>
                    )}
                    <span className="text-gray-400 text-xs">·</span>
                    <span className="text-xs text-gray-400">
                      Q{currentQuestionIndex + 1}
                      {currentQuestion.marks !== undefined ? ` · ${currentQuestion.marks} points` : ''}
                    </span>
                  </div>

                  <h2 className="text-xl font-bold text-gray-900 mb-3">{currentQuestion.title}</h2>
                  <p className="text-sm text-gray-600 leading-relaxed mb-4">
                    {currentQuestion.description}
                  </p>

                  {/* Examples */}
                  {(currentQuestion.sampleInput || currentQuestion.sampleOutput) && (
                    <div className="rounded-xl p-4 mb-4" style={{ background: '#F8FAFC', border: '1px solid var(--admin-border)' }}>
                      <p className="text-xs font-semibold text-gray-600 mb-2">Examples</p>
                      {currentQuestion.sampleInput && (
                        <pre className="text-xs font-mono text-gray-600 mb-1">
                          {'? '}
                          {currentQuestion.sampleInput}
                        </pre>
                      )}
                      {currentQuestion.sampleOutput && (
                        <pre className="text-xs font-mono text-gray-600">
                          {'? '}
                          {currentQuestion.sampleOutput}
                        </pre>
                      )}
                    </div>
                  )}

                  {/* Constraints */}
                  {currentQuestion.constraints && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-gray-500 mb-1">Constraints</p>
                      <p className="text-xs text-gray-600">{currentQuestion.constraints}</p>
                    </div>
                  )}

                  {/* Badges */}
                  <div className="flex flex-wrap gap-2">
                    {totalTestCases > 0 && (
                      <span className="px-2.5 py-1 rounded-lg text-xs font-medium text-gray-600" style={{ background: '#F1F5F9', border: '1px solid #E2E8F0' }}>
                        {totalTestCases} test cases
                      </span>
                    )}
                    {hiddenTestCases > 0 && (
                      <span className="px-2.5 py-1 rounded-lg text-xs font-medium text-gray-600" style={{ background: '#F1F5F9', border: '1px solid #E2E8F0' }}>
                        {hiddenTestCases} hidden
                      </span>
                    )}
                    {currentQuestion.partialScoring && (
                      <span className="px-2.5 py-1 rounded-lg text-xs font-medium text-gray-600" style={{ background: '#F1F5F9', border: '1px solid #E2E8F0' }}>
                        Partial credit
                      </span>
                    )}
                  </div>

                  {/* Media */}
                  {currentQuestion.mediaAssets && currentQuestion.mediaAssets.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {currentQuestion.mediaAssets.map((asset) => (
                        <div key={asset.id} className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--admin-border)' }}>
                          {asset.mediaType === 'image' && <img src={asset.storageUrl} alt={asset.originalName} className="w-full h-auto object-contain max-h-64" />}
                          {asset.mediaType === 'video' && <video src={asset.storageUrl} controls className="w-full" preload="metadata" />}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Editor panel */}
              <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#1E1E1E' }}>
                {/* Editor toolbar */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ background: '#252526', borderColor: '#3E3E42' }}>
                  <select
                    value={codingAnswers[currentQuestion.questionId]?.language || currentQuestion.supportedLanguages?.[0] || 'python'}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                    className="text-sm font-medium px-3 py-1.5 rounded-lg outline-none cursor-pointer"
                    style={{ background: '#3E3E42', color: '#D4D4D4', border: '1px solid #555' }}
                  >
                    {currentQuestion.supportedLanguages?.map((lang) => (
                      <option key={lang} value={lang}>{lang.charAt(0).toUpperCase() + lang.slice(1)}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const defaultLang = codingAnswers[currentQuestion.questionId]?.language || currentQuestion.supportedLanguages?.[0] || 'python';
                      const template = currentQuestion.codeTemplates?.[defaultLang] || '';
                      saveCodingAnswer(currentQuestion.questionId, template, defaultLang);
                    }}
                    className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
                    style={{ color: '#9CA3AF' }}
                    title="Reset to template"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Reset
                  </button>
                </div>

                {/* Monaco editor */}
                <div className="flex-1 overflow-hidden">
                  <Editor
                    key={currentQuestion.questionId}
                    height="100%"
                    language={codingAnswers[currentQuestion.questionId]?.language || currentQuestion.supportedLanguages?.[0] || 'python'}
                    value={codingAnswers[currentQuestion.questionId]?.code || ''}
                    onChange={handleCodeChange}
                    theme="vs-dark"
                    options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', scrollBeyondLastLine: false, readOnly: answeringLocked, lineNumbers: 'on', tabSize: 2 }}
                  />
                </div>

                {/* Editor footer: output + actions */}
                <div className="border-t px-4 py-2.5 flex items-center justify-between" style={{ background: '#252526', borderColor: '#3E3E42' }}>
                  <div>
                    {codeOutput && !runningCode && (
                      <span className="text-xs font-medium" style={{ color: codeOutput.startsWith('Error') ? '#EF4444' : 'var(--admin-accent)' }}>
                        {codeOutput.startsWith('Error') ? '? ' : '? '}
                        {codeOutput.startsWith('Error') ? 'Error in code' : 'Code ran successfully'}
                      </span>
                    )}
                    {runningCode && <span className="text-xs text-gray-400">Running…</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRunCode}
                      disabled={runningCode || answeringLocked}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                      style={{ background: 'transparent', border: '1px solid #555', color: '#D4D4D4' }}
                    >
                      {runningCode ? (
                        <span className="w-3 h-3 rounded-full border-2 border-gray-400 border-t-transparent animate-spin" />
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                      Run
                    </button>
                    <button
                      onClick={handleSubmitCode}
                      disabled={answeringLocked || codeSubmitted}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-60 transition-colors"
                      style={{ background: codeSubmitted ? 'var(--admin-accent-hover)' : 'var(--admin-accent)' }}
                    >
                      {codeSubmitted ? '? Saved' : 'Submit code'}
                    </button>
                  </div>
                </div>

                {/* Output panel */}
                {codeOutput && (
                  <div className="border-t max-h-32 overflow-y-auto px-4 py-3" style={{ background: '#1A1A1A', borderColor: '#3E3E42' }}>
                    <pre className="text-xs font-mono whitespace-pre-wrap" style={{ color: codeOutput.startsWith('Error') ? '#FC8181' : '#A3E635' }}>
                      {codeOutput}
                    </pre>
                  </div>
                )}
              </div>
            </div>
            <Palette />
          </>
        ) : (
          // -- MCQ / Behavioral: two-column layout --
          <>
            <main className="flex-1 overflow-y-auto px-10 py-8">
              <div className="max-w-2xl mx-auto">
                {/* Breadcrumb */}
                <div className="flex items-center gap-2 flex-wrap mb-5">
                  <span className="text-sm font-semibold" style={{ color: typeColor[currentQuestion.type] }}>
                    {typeLabel[currentQuestion.type]}
                  </span>
                  {currentQuestion.difficulty && (
                    <>
                      <span className="text-gray-300 text-sm">·</span>
                      <span className="text-sm font-semibold" style={{ color: difficultyColor[currentQuestion.difficulty] }}>
                        {currentQuestion.difficulty.charAt(0).toUpperCase() + currentQuestion.difficulty.slice(1)}
                      </span>
                    </>
                  )}
                  <span className="text-gray-300 text-sm">·</span>
                  <span className="text-sm text-gray-400">
                    Question {currentQuestionIndex + 1} of {questions.length}
                    {currentQuestion.marks !== undefined ? ` · ${currentQuestion.marks} points` : ''}
                  </span>
                </div>

                {currentQuestion.type === 'mcq' ? (
                  // -- MCQ --
                  <>
                    <h2 className="text-xl font-bold text-gray-900 mb-6 leading-snug">
                      {currentQuestion.questionText}
                    </h2>

                    {/* Media */}
                    {currentQuestion.mediaAssets && currentQuestion.mediaAssets.length > 0 && (
                      <div className="mb-6 space-y-3">
                        {currentQuestion.mediaAssets.map((asset) => (
                          <div key={asset.id} className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--admin-border)' }}>
                            {asset.mediaType === 'image' && <img src={asset.storageUrl} alt={asset.originalName} className="w-full h-auto object-contain max-h-80" />}
                            {asset.mediaType === 'video' && <video src={asset.storageUrl} controls className="w-full" preload="metadata" />}
                            {asset.mediaType === 'audio' && (
                              <div className="p-4 bg-gray-50">
                                <audio src={asset.storageUrl} controls className="w-full" preload="metadata" />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Options */}
                    <div className="space-y-3">
                      {currentQuestion.options?.map((option, displayIdx) => {
                        const isSelected = mcqAnswers[currentQuestion.questionId]?.includes(option.originalIndex);
                        const letter = String.fromCharCode(65 + displayIdx);
                        return (
                          <button
                            key={option.originalIndex}
                            onClick={() => handleMCQSelect(option.originalIndex)}
                            className="w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all"
                            style={{
                              borderColor: isSelected ? 'var(--admin-accent)' : 'var(--admin-border)',
                              background: isSelected ? 'var(--admin-accent-soft)' : '#FFFFFF',
                            }}
                          >
                            <span
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 transition-colors"
                              style={{
                                background: isSelected ? 'var(--admin-accent)' : 'var(--admin-border)',
                                color: isSelected ? '#FFFFFF' : '#6B7280',
                              }}
                            >
                              {letter}
                            </span>
                            <span className="flex-1 text-sm text-gray-700">{option.text}</span>
                            {isSelected && (
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 flex-shrink-0" viewBox="0 0 20 20" fill="var(--admin-accent)">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Hint */}
                    <div className="flex items-center gap-2 mt-5">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-xs text-gray-400">
                        {currentQuestion.isMultipleChoice
                          ? 'Multiple answers · your selections are saved automatically.'
                          : 'Single answer · your selection is saved automatically.'}
                      </span>
                    </div>
                  </>
                ) : currentQuestion.type === 'communication' ? (
                  // -- Communication (Written) --
                  <>
                    <h2 className="text-xl font-bold text-gray-900 mb-2 leading-snug">
                      {currentQuestion.title}
                    </h2>
                    {currentQuestion.description && (
                      <p className="text-sm mb-5" style={{ color: 'var(--admin-accent)' }}>
                        {currentQuestion.description}
                      </p>
                    )}

                    {/* Stimulus (image or audio) */}
                    {currentQuestion.mediaAssets && currentQuestion.mediaAssets.length > 0 && (
                      <div className="mb-6 space-y-3">
                        {currentQuestion.mediaAssets.map((asset) => (
                          <div key={asset.id} className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--admin-border)' }}>
                            {asset.mediaType === 'image' && <img src={asset.storageUrl} alt={asset.originalName} className="w-full h-auto object-contain max-h-80" />}
                            {asset.mediaType === 'audio' && (
                              <div className="p-4 bg-gray-50">
                                <audio src={asset.storageUrl} controls className="w-full" preload="metadata" />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="relative">
                      <textarea
                        value={communicationText}
                        onChange={(e) => handleCommunicationChange(e.target.value)}
                        disabled={isSubmitted || timeUp}
                        rows={12}
                        placeholder="Write your response here..."
                        className="w-full rounded-xl border px-4 py-4 text-sm text-gray-700 resize-none outline-none transition-colors"
                        style={{ borderColor: 'var(--admin-border)', background: '#FFFFFF', lineHeight: '1.6' }}
                        onFocus={(e) => (e.target.style.borderColor = 'var(--admin-accent)')}
                        onBlur={(e) => (e.target.style.borderColor = 'var(--admin-border)')}
                      />
                      {/* Word count + auto-saved */}
                      <div className="flex items-center justify-between mt-2 px-1">
                        <span className="text-xs text-gray-400">
                          {wordCount} {wordCount === 1 ? 'word' : 'words'} · {communicationText.length} characters
                        </span>
                        {autoSaved && (
                          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--admin-accent)' }}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Auto-saved
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  // -- Behavioral --
                  <>
                    <h2 className="text-xl font-bold text-gray-900 mb-2 leading-snug">
                      {currentQuestion.title || currentQuestion.questionText}
                    </h2>
                    {currentQuestion.description && (
                      <p className="text-sm mb-5" style={{ color: 'var(--admin-accent)' }}>
                        {currentQuestion.description}
                      </p>
                    )}

                    <div className="relative">
                      <textarea
                        value={behavioralText}
                        onChange={(e) => handleBehavioralChange(e.target.value)}
                        disabled={isSubmitted || timeUp}
                        rows={12}
                        placeholder="Write your response here..."
                        className="w-full rounded-xl border px-4 py-4 text-sm text-gray-700 resize-none outline-none transition-colors"
                        style={{ borderColor: 'var(--admin-border)', background: '#FFFFFF', lineHeight: '1.6' }}
                        onFocus={(e) => (e.target.style.borderColor = 'var(--admin-accent)')}
                        onBlur={(e) => (e.target.style.borderColor = 'var(--admin-border)')}
                      />
                      {/* Word count + auto-saved */}
                      <div className="flex items-center justify-between mt-2 px-1">
                        <span className="text-xs text-gray-400">
                          {wordCount} {wordCount === 1 ? 'word' : 'words'} · {behavioralText.length} characters
                        </span>
                        {autoSaved && (
                          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--admin-accent)' }}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Auto-saved
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </main>
            <Palette />
          </>
        )}
      </div>

      {/* -- Bottom nav -- */}
      <BottomNav />

      {/* -- Submit confirmation modal -- */}
      {showConfirmSubmit && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: '#FEF2F2' }}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="#EF4444" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2 text-center">{timeUp ? "Time's up!" : 'Submit Test?'}</h2>
            <p className="text-sm text-gray-500 mb-1 text-center">
              You have answered <span className="font-semibold text-gray-700">{getAnsweredCount()}</span> of <span className="font-semibold text-gray-700">{questions.length}</span> questions.
            </p>
            {markedForReview.size > 0 && (
              <p className="text-sm text-amber-600 mb-2 text-center">{markedForReview.size} question{markedForReview.size > 1 ? 's' : ''} marked for review.</p>
            )}
            <p className="text-sm text-gray-400 mb-6 text-center">
              {timeUp ? 'Your answers are locked. Please submit now.' : 'This action cannot be undone.'}
            </p>
            <div className="flex gap-3">
              {!timeUp && (
                <button
                  onClick={() => setShowConfirmSubmit(false)}
                  className="flex-1 py-3 rounded-xl font-semibold text-sm border text-gray-700 hover:bg-gray-50 transition-colors"
                  style={{ borderColor: 'var(--admin-border)' }}
                >
                  Cancel
                </button>
              )}
              <button
                onClick={handleManualSubmit}
                disabled={submitting || isTestFrozen}
                className="flex-1 py-3 rounded-xl font-semibold text-sm text-white transition-opacity disabled:opacity-50"
                style={{ background: '#EF4444' }}
              >
                {submitting ? 'Submitting…' : 'Submit Test'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -- Network info popup (fixed, above all layers) -- */}
      {showNetworkInfo && networkPopupPos && (
        <div
          data-network-info
          className="rounded-2xl overflow-hidden shadow-2xl"
          style={{
            position: 'fixed',
            top: `${networkPopupPos.top}px`,
            right: `${Math.max(8, networkPopupPos.right)}px`,
            width: '220px',
            zIndex: 9999,
            background: '#0F172A',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2" style={{ background: '#1E293B', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold tracking-wider" style={{ color: '#94A3B8' }}>NETWORK STATUS</span>
            </div>
            <button
              onClick={() => setShowNetworkInfo(false)}
              className="w-5 h-5 flex items-center justify-center rounded"
              style={{ color: '#64748B' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#F1F5F9')}
              onMouseLeave={e => (e.currentTarget.style.color = '#64748B')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Stats */}
          <div className="px-4 py-3 space-y-3">
            {/* Quality row */}
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: '#64748B' }}>Connection</span>
              <span
                className="text-xs font-bold capitalize px-2 py-0.5 rounded-full"
                style={{
                  color: { excellent: '#22C55E', good: '#F59E0B', fair: '#F97316', poor: '#EF4444' }[networkQuality],
                  background: { excellent: 'rgba(34,197,94,0.12)', good: 'rgba(245,158,11,0.12)', fair: 'rgba(249,115,22,0.12)', poor: 'rgba(239,68,68,0.12)' }[networkQuality],
                }}
              >
                {networkQuality}
              </span>
            </div>

            {/* Ping row */}
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: '#64748B' }}>Ping</span>
              <span className="text-xs font-bold font-mono" style={{ color: pingMs === null ? '#EF4444' : pingMs < 80 ? '#22C55E' : pingMs < 180 ? '#F59E0B' : '#EF4444' }}>
                {pingMs !== null ? `${pingMs} ms` : '— ms'}
              </span>
            </div>

            {/* Signal bars visual */}
            <div className="flex items-end gap-1 justify-center pt-1">
              {[1, 2, 3].map(level => {
                const active = { excellent: 3, good: 2, fair: 1, poor: 0 }[networkQuality] >= level;
                const barColor = { excellent: '#22C55E', good: '#F59E0B', fair: '#F97316', poor: '#EF4444' }[networkQuality];
                return (
                  <div
                    key={level}
                    className="rounded-sm"
                    style={{
                      width: '20px',
                      height: `${level * 10}px`,
                      background: active ? barColor : '#1E293B',
                      border: `1px solid ${active ? barColor : '#334155'}`,
                      transition: 'background 0.3s',
                    }}
                  />
                );
              })}
            </div>

            <p className="text-center" style={{ color: '#475569', fontSize: '10px' }}>
              Updates every 6 seconds
            </p>
          </div>
        </div>
      )}

      {/* -- Camera preview popup (fixed, above all layers) -- */}
      {showCameraPreview && requireCamera && (
        <div
          data-camera-preview
          className="rounded-2xl overflow-hidden shadow-2xl"
          style={{
            position: 'fixed',
            top: '56px',
            right: '16px',
            width: '268px',
            zIndex: 9999,
            background: '#0F172A',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          {/* Header bar */}
          <div className="flex items-center justify-between px-3 py-2" style={{ background: '#1E293B', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#22C55E' }} />
              <span className="text-xs font-semibold tracking-wider" style={{ color: '#94A3B8' }}>LIVE</span>
            </div>
            <button
              onClick={() => setShowCameraPreview(false)}
              className="w-5 h-5 flex items-center justify-center rounded"
              style={{ color: '#64748B' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#F1F5F9')}
              onMouseLeave={e => (e.currentTarget.style.color = '#64748B')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Video feed */}
          <div className="relative" style={{ background: '#000', minHeight: '160px' }}>
            <video
              ref={cameraPreviewRef}
              autoPlay
              muted
              playsInline
              className="w-full"
              style={{ display: 'block', transform: 'scaleX(-1)', maxHeight: '180px', objectFit: 'cover' }}
            />
            {!cameraStream && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs" style={{ color: '#64748B' }}>Camera unavailable</span>
              </div>
            )}
          </div>

          {/* Observation warning */}
          <div className="px-3 py-3 text-center" style={{ background: '#1E293B', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="#F59E0B" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <span className="text-xs font-bold tracking-widest" style={{ color: '#F59E0B' }}>YOU ARE UNDER OBSERVATION</span>
            </div>
            <p className="text-xs leading-snug" style={{ color: '#64748B' }}>
              This session is being recorded and monitored by a AI Proctor.
            </p>
          </div>
        </div>
      )}

      {/* -- Exit / Go back confirmation modal -- */}
      {showExitConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--admin-accent-disabled)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="var(--admin-accent-hover)" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2 text-center">Exit Test?</h2>
            <p className="text-sm text-gray-500 mb-6 text-center">
              Your progress will be lost. Are you sure you want to go back?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowExitConfirm(false)}
                className="flex-1 py-3 rounded-xl font-semibold text-sm border text-gray-700 hover:bg-gray-50 transition-colors"
                style={{ borderColor: 'var(--admin-border)' }}
              >
                Stay
              </button>
              <button
                onClick={() => { setShowExitConfirm(false); navigate(-1); }}
                className="flex-1 py-3 rounded-xl font-semibold text-sm text-white transition-colors"
                style={{ background: 'var(--admin-accent)' }}
              >
                Exit Test
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
