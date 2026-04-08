import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import Editor from '@monaco-editor/react';
import { candidateApi } from '../../services/api';
import { useTestStore } from '../../context/testStore';
import { useProctoring } from '../../hooks/useProctoring';
import {
  getRealtimeSocket,
  disconnectRealtimeSocket,
  ViolationDetectedPayload,
} from '../../services/realtimeService';

// High-priority: count toward violation limit, red banner, can trigger auto-submit
const HIGH_PRIORITY_VIOLATIONS = new Set([
  'multiple_faces',
  'phone_detected',
  'looking_away',
  'tab_switch',
  'fullscreen_exit',
  'window_blur',
  'window_exit',
  'focus_loss',
  'copy_attempt',
  'paste_attempt',
  'copy_paste',
  'copy_paste_attempt',
  'devtools_open',
  'secondary_monitor_detected',
]);

// Low-priority AI violations: yellow banner only, no violation count, affects trust score
const LOW_PRIORITY_AI_VIOLATIONS = new Set([
  'suspicious_audio',
  'unauthorized_object_detected',
]);
const TEMP_DISABLE_AUDIO_PROCTORING = true;
const TEMP_AI_PAUSE_EVENTS = new Set([
  'multiple_faces',
  'phone_detected',
  'secondary_monitor_detected',
]);

// Combined filter set (face_not_detected handled separately as test freeze)
const ALLOWED_CANDIDATE_VIOLATIONS = new Set([
  ...HIGH_PRIORITY_VIOLATIONS,
  ...LOW_PRIORITY_AI_VIOLATIONS,
  'face_not_detected',
  'camera_blocked',
]);

export default function TestInterface() {
  const navigate = useNavigate();
  const {
    testId,
    testCode,
    testName,
    duration,
    attemptId,
    maxViolations,
    proctorEnabled,
    requireCamera,
    requireMicrophone,
    requireScreenShare,
    startTime,
    questions,
    currentQuestionIndex,
    mcqAnswers,
    codingAnswers,
    behavioralAnswers,
    violations,
    isSubmitted,
    setCurrentQuestion,
    saveMCQAnswer,
    saveCodingAnswer,
    saveBehavioralAnswer,
    incrementViolations,
    setSubmitted
  } = useTestStore();

  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [showWarning, setShowWarning] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [codeOutput, setCodeOutput] = useState('');
  const [runningCode, setRunningCode] = useState(false);
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(false);
  const [showYellowWarning, setShowYellowWarning] = useState(false);
  const [yellowWarningMessage, setYellowWarningMessage] = useState('');
  const [faceFrozen, setFaceFrozen] = useState(false);
  const [policyPaused, setPolicyPaused] = useState(false);
  const [policyPauseReason, setPolicyPauseReason] = useState('');

  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFullscreenRef = useRef(false);
  const lastViolationAtRef = useRef<Record<string, number>>({});
  const proctorInitHandledRef = useRef(false);
  const antiCheatArmedRef = useRef(false);
  const testStartedAtRef = useRef<number>(Date.now());
  const policyPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentQuestion = questions[currentQuestionIndex];

  const showViolationWarning = useCallback((message: string, count: number) => {
    setWarningMessage(`Warning: ${message}. Violations: ${count}/${maxViolations}`);
    setShowWarning(true);
    setTimeout(() => setShowWarning(false), 5000);
  }, [maxViolations]);

  // Low-priority AI alert: yellow banner only, no violation count
  const showTrustWarning = useCallback((message: string) => {
    setYellowWarningMessage(`AI Proctoring Alert: ${message}`);
    setShowYellowWarning(true);
    setTimeout(() => setShowYellowWarning(false), 5000);
  }, []);

  const triggerPolicyPause = useCallback((reason: string, durationMs = 10000) => {
    setPolicyPauseReason(reason);
    setPolicyPaused(true);
    if (policyPauseTimerRef.current) {
      clearTimeout(policyPauseTimerRef.current);
    }
    policyPauseTimerRef.current = setTimeout(() => {
      setPolicyPaused(false);
      setPolicyPauseReason('');
      policyPauseTimerRef.current = null;
    }, durationMs);
  }, []);

  const handleProctorViolationUI = useCallback((eventType: string, message: string) => {
    if (!antiCheatArmedRef.current || isSubmitted) return;
    if (!ALLOWED_CANDIDATE_VIOLATIONS.has(eventType)) return;
    // These events are handled elsewhere or are no-ops here
    if (['camera_resumed', 'tab_switch_resume', 'window_focus_return'].includes(eventType)) {
      return;
    }
    const now = Date.now();
    const last = lastViolationAtRef.current[eventType] || 0;
    if (now - last < 5000) return;
    lastViolationAtRef.current[eventType] = now;

    // face_not_detected: freeze test until face is visible again and count violation
    if (eventType === 'face_not_detected') {
      setFaceFrozen(true);
    } else if (eventType === 'camera_blocked') {
      triggerPolicyPause(message, 12000);
    }

    const socket = getRealtimeSocket();
    const emitActivity = () => {
      if (testId && attemptId) {
        socket.emit('candidate-activity', {
          testId,
          activity: {
            attemptId,
            eventType,
            message,
            timestamp: new Date().toISOString(),
          },
        });
      }
    };

    if (LOW_PRIORITY_AI_VIOLATIONS.has(eventType)) {
      // Low-priority: yellow banner, no violation count, logged for trust score only
      showTrustWarning(message);
      emitActivity();
      return;
    }

    // High-priority: red banner, increment violation counter
    const newViolations = incrementViolations();
    showViolationWarning(message, newViolations);
    emitActivity();

    if (TEMP_AI_PAUSE_EVENTS.has(eventType)) {
      const pauseMs = eventType === 'phone_detected' ? 15000 : 10000;
      triggerPolicyPause(message, pauseMs);
    }

  }, [incrementViolations, showViolationWarning, showTrustWarning, triggerPolicyPause, testId, attemptId, isSubmitted]);

  const {
    status: proctorStatus,
    endSession: endProctoringSession,
    error: proctorError,
    capturePreviewFrame,
    captureEvidenceFrame,
  } = useProctoring(attemptId || '', {
    enabled: proctorEnabled,
    enableCamera: requireCamera,
    enableMicrophone: requireMicrophone && !TEMP_DISABLE_AUDIO_PROCTORING,
    enableScreenShare: requireScreenShare,
    enableFaceDetection: true,
    enableAudioAnalysis: !TEMP_DISABLE_AUDIO_PROCTORING,
    enableMonitorDetection: true,
    onViolation: (violation) => {
      handleProctorViolationUI(violation.eventType, violation.description);
      if (testId && attemptId) {
        const socket = getRealtimeSocket();
        socket.emit('proctor-violation', {
          testId,
          attemptId,
          violation: {
            type: violation.eventType,
            severity: violation.severity,
            description: violation.description,
            timestamp: new Date().toISOString(),
          },
        });
      }
    },
    onTerminate: () => {
      handleAutoSubmit();
    },
  });
  const proctorStatusRef = useRef(proctorStatus);
  const hiddenAtRef = useRef<number | null>(null);
  const blurAtRef = useRef<number | null>(null);

  // Combined test freeze: camera obstruction (hook) OR face not detected (UI)
  const isTestFrozen = proctorStatus.testFrozen || faceFrozen || policyPaused;

  useEffect(() => {
    proctorStatusRef.current = proctorStatus;
  }, [proctorStatus]);

  // Unfreeze face-freeze when face returns
  useEffect(() => {
    if (!proctorEnabled) return;
    if (proctorStatus.faceDetected && faceFrozen) {
      setFaceFrozen(false);
    }
  }, [proctorStatus.faceDetected, faceFrozen, proctorEnabled]);

  useEffect(() => {
    testStartedAtRef.current = Date.now();
    antiCheatArmedRef.current = false;
    const armTimer = setTimeout(() => {
      antiCheatArmedRef.current = true;
    }, 15000);

    return () => clearTimeout(armTimer);
  }, []);

  useEffect(() => {
    return () => {
      if (policyPauseTimerRef.current) {
        clearTimeout(policyPauseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!proctorError || proctorInitHandledRef.current) return;
    if (!proctorEnabled) return;

    const lowered = proctorError.toLowerCase();
    const permissionError =
      lowered.includes('camera permission denied') ||
      lowered.includes('microphone permission denied') ||
      lowered.includes('screen share permission denied');

    if (permissionError) {
      proctorInitHandledRef.current = true;
      toast.error('Required proctoring permission missing. Complete Device Check once, then start test.');
      navigate('/test/instructions');
    }
  }, [proctorError, proctorEnabled, navigate]);

  // Calculate remaining time
  useEffect(() => {
    if (!proctorEnabled || !testId || !attemptId) return;

    const socket = getRealtimeSocket();
    socket.emit('candidate-proctor-join', { testId, attemptId });

    const handleRealtimeViolation = (payload: ViolationDetectedPayload) => {
      if (!payload || payload.attemptId !== attemptId) return;
      console.log('[PROCTOR_TRACE][frontend][socket_violation_in]', payload);
      handleProctorViolationUI(payload.violation.type, payload.violation.description);
    };

    socket.on('violation-detected', handleRealtimeViolation);

    const statusInterval = setInterval(() => {
      const currentStatus = proctorStatusRef.current;
      socket.emit('proctor-status', {
        testId,
        attemptId,
        status: {
          cameraOn: currentStatus.cameraEnabled,
          micOn: currentStatus.microphoneEnabled,
          screenSharing: currentStatus.screenShareEnabled,
          faceDetected: currentStatus.faceDetected,
          lookingAtScreen: currentStatus.lookingAtScreen,
          cameraBlocked: currentStatus.cameraBlocked,
          testFrozen: currentStatus.testFrozen,
          monitorCount: currentStatus.monitorCount,
        },
      });
    }, 5000);

    const frameInterval = setInterval(() => {
      const frame = capturePreviewFrame({ quality: 0.45, maxWidth: 360 });
      if (!frame) return;
      socket.emit('candidate-live-frame', {
        testId,
        attemptId,
        frame,
        timestamp: new Date().toISOString(),
      });
    }, 6000);

    return () => {
      socket.off('violation-detected', handleRealtimeViolation);
      clearInterval(statusInterval);
      clearInterval(frameInterval);
      disconnectRealtimeSocket();
    };
  }, [proctorEnabled, testId, attemptId, capturePreviewFrame, handleProctorViolationUI]);

  useEffect(() => {
    if (!startTime || !duration) {
      navigate('/test/login');
      return;
    }

    // Handle both Date object and string formats
    const startTimeMs = startTime instanceof Date ? startTime.getTime() : new Date(startTime).getTime();

    if (isNaN(startTimeMs)) {
      console.error('Invalid startTime:', startTime);
      navigate('/test/login');
      return;
    }

    const endTime = startTimeMs + duration * 60 * 1000;

    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, endTime - now);
      setTimeRemaining(remaining);

      if (remaining === 0 && !isSubmitted) {
        handleAutoSubmit();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [startTime, duration, isSubmitted]);

  // Request fullscreen on mount
  useEffect(() => {
    const requestFullscreen = async () => {
      try {
        await document.documentElement.requestFullscreen();
        isFullscreenRef.current = true;
        setShowFullscreenPrompt(false);
      } catch (error) {
        console.error('Could not enter fullscreen:', error);
        // Show fullscreen prompt if auto-fullscreen fails
        setShowFullscreenPrompt(true);
        isFullscreenRef.current = false;
      }
    };

    // Small delay to ensure DOM is ready
    setTimeout(requestFullscreen, 500);

    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  // Anti-cheating: Monitor fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isFullscreenRef.current && !isSubmitted) {
        handleViolation('fullscreen_exit', 'You exited full-screen mode');
      }
      isFullscreenRef.current = !!document.fullscreenElement;
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isSubmitted]);

  // Anti-cheating: Monitor visibility changes (tab switch)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && !isSubmitted) {
        hiddenAtRef.current = Date.now();
        handleViolation('tab_switch', 'You switched to another tab');
      } else if (!document.hidden && hiddenAtRef.current) {
        const durationMs = Date.now() - hiddenAtRef.current;
        hiddenAtRef.current = null;
        candidateApi.logActivity({
          eventType: 'tab_switch_resume',
          eventData: {
            message: 'Candidate returned to test tab',
            durationMs,
            timestamp: new Date().toISOString(),
          },
        }).catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isSubmitted]);

  // Anti-cheating: Monitor window blur (focus loss)
  useEffect(() => {
    const handleBlur = () => {
      // Tab switch already emits tab_switch via visibilitychange; skip duplicate window_exit.
      if (document.hidden) return;
      if (!isSubmitted) {
        blurAtRef.current = Date.now();
        handleViolation('window_exit', 'Test window lost focus');
      }
    };
    const handleFocus = () => {
      if (!isSubmitted && blurAtRef.current) {
        const durationMs = Date.now() - blurAtRef.current;
        blurAtRef.current = null;
        candidateApi.logActivity({
          eventType: 'window_focus_return',
          eventData: {
            message: 'Candidate returned to test window',
            durationMs,
            timestamp: new Date().toISOString(),
          },
        }).catch(() => {});
      }
    };

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, [isSubmitted]);

  // Prevent accidental page reload/close
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isSubmitted) {
        e.preventDefault();
        e.returnValue = 'You have a test in progress. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isSubmitted]);

  // Anti-cheating: Disable copy/paste/right-click
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      handleViolation('copy_attempt', 'Copy attempt detected');
    };

    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      handleViolation('paste_attempt', 'Paste attempt detected');
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent Ctrl+C, Ctrl+V, Ctrl+P
      if (e.ctrlKey && ['c', 'v', 'p'].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
      // Prevent F12, Ctrl+Shift+I (dev tools)
      if (
        e.key === 'F12' ||
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i') ||
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'j')
      ) {
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

  // Heuristic devtools open detection
  useEffect(() => {
    if (isSubmitted) return;
    const interval = setInterval(() => {
      const widthThreshold = window.outerWidth - window.innerWidth > 160;
      const heightThreshold = window.outerHeight - window.innerHeight > 160;
      if (widthThreshold || heightThreshold) {
        handleViolation('devtools_open', 'Developer tools window detected');
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [isSubmitted]);

  // Auto-save answers periodically
  useEffect(() => {
    autoSaveRef.current = setInterval(() => {
      saveCurrentAnswer();
    }, 30000); // Auto-save every 30 seconds

    return () => {
      if (autoSaveRef.current) {
        clearInterval(autoSaveRef.current);
      }
    };
  }, [currentQuestionIndex, mcqAnswers, codingAnswers, behavioralAnswers]);

  // Load code template for coding questions when first viewed
  useEffect(() => {
    if (!currentQuestion || currentQuestion.type !== 'coding') return;

    const questionId = currentQuestion.questionId;
    const existingAnswer = codingAnswers[questionId];

    // Only load template if no existing code
    if (!existingAnswer || !existingAnswer.code) {
      const templates = currentQuestion.codeTemplates;
      const defaultLang = currentQuestion.supportedLanguages?.[0] || 'python';
      const template = templates?.[defaultLang] || '';

      if (template) {
        saveCodingAnswer(questionId, template, defaultLang);
      }
    }
  }, [currentQuestion?.questionId]);

  // Clear code output when question changes
  useEffect(() => {
    setCodeOutput('');
  }, [currentQuestionIndex]);

  const handleViolation = useCallback(async (eventType: string, message: string) => {
    // Ignore noisy startup events right after test boot.
    if (!antiCheatArmedRef.current || isSubmitted) return;
    if (!ALLOWED_CANDIDATE_VIOLATIONS.has(eventType)) return;

    const newViolations = incrementViolations();
    const violationEvidence = captureEvidenceFrame({ quality: 0.82, maxWidth: 1366 });
    const snapshotData = violationEvidence.snapshotData;
    const confidence = eventType === 'devtools_open' ? 98 : 90;
    const durationMs =
      eventType === 'tab_switch'
        ? (hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0)
        : eventType === 'focus_loss' || eventType === 'window_exit'
        ? (blurAtRef.current ? Date.now() - blurAtRef.current : 0)
        : 0;

    try {
      const response = await candidateApi.logActivity({
        eventType,
        eventData: {
          message,
          confidence,
          durationMs,
          snapshotData,
          snapshotSource: violationEvidence.snapshotSource,
          timestamp: new Date().toISOString(),
        },
      });
      const backendViolationCount = Number(response?.data?.violationCount);
      const effectiveViolations = Number.isFinite(backendViolationCount)
        ? backendViolationCount
        : newViolations;
      if (Number.isFinite(backendViolationCount)) {
        useTestStore.setState({ violations: backendViolationCount });
      }
      showViolationWarning(message, effectiveViolations);

      if (testId && attemptId) {
        const socket = getRealtimeSocket();
        socket.emit('candidate-activity', {
          testId,
          activity: {
            attemptId,
            eventType,
            message,
            timestamp: new Date().toISOString(),
          },
        });
      }

      if (response.data.autoSubmit === true) {
        handleAutoSubmit();
      } else {
        // Show fullscreen prompt - user must click to re-enter (browser requirement)
        if (!document.fullscreenElement) {
          setShowFullscreenPrompt(true);
        }
      }
    } catch (error) {
      console.error('Failed to log activity:', error);
    }
  }, [incrementViolations, isSubmitted, captureEvidenceFrame]);

  const handleReenterFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      isFullscreenRef.current = true;
      setShowFullscreenPrompt(false);
    } catch (err) {
      console.error('Could not re-enter fullscreen:', err);
      toast.error('Please enable fullscreen to continue the test');
    }
  };

  const saveCurrentAnswer = async () => {
    if (!currentQuestion || isSubmitted) return;

    try {
      if (currentQuestion.type === 'mcq') {
        const answer = mcqAnswers[currentQuestion.questionId];
        if (answer && answer.length > 0) {
          await candidateApi.saveMCQAnswer({
            questionId: currentQuestion.questionId,
            selectedOptions: answer
          });
        }
      } else if (currentQuestion.type === 'coding') {
        const answer = codingAnswers[currentQuestion.questionId];
        if (answer && answer.code) {
          await candidateApi.saveCodingAnswer({
            questionId: currentQuestion.questionId,
            code: answer.code,
            language: answer.language
          });
        }
      } else if (currentQuestion.type === 'behavioral') {
        await candidateApi.saveBehavioralAnswer({
          questionId: currentQuestion.questionId,
          answerText: behavioralAnswers[currentQuestion.questionId] || ''
        });
      }
    } catch (error) {
      console.error('Failed to auto-save:', error);
    }
  };

  const handleMCQSelect = (originalIndex: number) => {
    if (isSubmitted || isTestFrozen) return;

    const questionId = currentQuestion.questionId;
    const isMultiple = currentQuestion.isMultipleChoice;
    const currentSelected = mcqAnswers[questionId] || [];

    let newSelected: number[];

    if (isMultiple) {
      if (currentSelected.includes(originalIndex)) {
        newSelected = currentSelected.filter((i) => i !== originalIndex);
      } else {
        newSelected = [...currentSelected, originalIndex];
      }
    } else {
      newSelected = [originalIndex];
    }

    saveMCQAnswer(questionId, newSelected);
  };

  const handleCodeChange = (value: string | undefined) => {
    if (isSubmitted || isTestFrozen || !value) return;

    const questionId = currentQuestion.questionId;
    const currentAnswer = codingAnswers[questionId] || { code: '', language: 'python' };
    saveCodingAnswer(questionId, value, currentAnswer.language);
  };

  const handleLanguageChange = (language: string) => {
    if (isSubmitted || isTestFrozen) return;

    const questionId = currentQuestion.questionId;
    const currentAnswer = codingAnswers[questionId] || { code: '', language: 'python' };

    // Load template if code is empty or matches previous template
    let newCode = currentAnswer.code;
    const templates = currentQuestion.codeTemplates;

    if (templates) {
      const oldTemplate = templates[currentAnswer.language] || '';
      const newTemplate = templates[language] || '';

      // Normalize for comparison (trim whitespace)
      const currentCodeNormalized = (currentAnswer.code || '').trim();
      const oldTemplateNormalized = oldTemplate.trim();

      // If code is empty or matches old template, use new template
      if (!currentCodeNormalized || currentCodeNormalized === oldTemplateNormalized) {
        newCode = newTemplate;
      }
    }

    saveCodingAnswer(questionId, newCode, language);
  };

  const handleRunCode = async () => {
    if (runningCode || isSubmitted || isTestFrozen) return;

    const answer = codingAnswers[currentQuestion.questionId];
    if (!answer || !answer.code) {
      toast.error('Please write some code first');
      return;
    }

    setRunningCode(true);
    setCodeOutput('Running code...');

    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), 60000); // 60 second timeout
    });

    try {
      const apiPromise = candidateApi.runCode({
        questionId: currentQuestion.questionId,
        code: answer.code,
        language: answer.language,
        input: currentQuestion.sampleInput
      });

      const { data } = await Promise.race([apiPromise, timeoutPromise]) as { data: { result: { success: boolean; output?: string; error?: string; executionTime?: number } } };

      if (data.result.success) {
        setCodeOutput(`Output:\n${data.result.output}\n\nExecution time: ${data.result.executionTime}ms`);
      } else {
        setCodeOutput(`Error:\n${data.result.error}`);
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'timeout') {
        setCodeOutput('Error: Code execution timed out. Server is busy, please try again.');
      } else {
        setCodeOutput('Failed to run code. Please try again.');
      }
    } finally {
      setRunningCode(false);
    }
  };

  const handleBehavioralChange = (value: string) => {
    if (isSubmitted) return;
    saveBehavioralAnswer(currentQuestion.questionId, value);
  };

  const handleAutoSubmit = async () => {
    if (isSubmitted || submitting) return;

    setSubmitting(true);
    await saveCurrentAnswer();

    try {
      await endProctoringSession();
      await candidateApi.submitTest({ autoSubmit: true });
      setSubmitted();
      toast.success('Test auto-submitted');
      navigate('/test/complete');
    } catch (error) {
      toast.error('Failed to submit test');
      setSubmitting(false);
    }
  };

  const handleManualSubmit = async () => {
    if (isSubmitted || submitting || isTestFrozen) return;

    setSubmitting(true);
    await saveCurrentAnswer();

    try {
      await endProctoringSession();
      await candidateApi.submitTest({ autoSubmit: false });
      setSubmitted();
      toast.success('Test submitted successfully');
      navigate('/test/complete');
    } catch (error) {
      toast.error('Failed to submit test');
      setSubmitting(false);
    }
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const getAnsweredCount = () => {
    let count = 0;
    questions.forEach((q) => {
      if (q.type === 'mcq' && mcqAnswers[q.questionId]?.length > 0) count++;
      if (q.type === 'coding' && codingAnswers[q.questionId]?.code) count++;
      if (q.type === 'behavioral' && (behavioralAnswers[q.questionId] || '').trim().length > 0) count++;
    });
    return count;
  };

  const watermarkCode = testCode || (testId ? testId.slice(0, 8).toUpperCase() : 'TEST');
  const watermarkBackground = useMemo(() => {
    const watermarkSvg = `
      <svg xmlns='http://www.w3.org/2000/svg' width='360' height='220'>
        <g transform='rotate(-28 180 110)'>
          <text x='18' y='90' fill='rgba(30,64,175,0.10)' font-size='30' font-family='Segoe UI, Arial, sans-serif' font-weight='700'>
            ${watermarkCode}
          </text>
          <text x='120' y='190' fill='rgba(30,64,175,0.10)' font-size='30' font-family='Segoe UI, Arial, sans-serif' font-weight='700'>
            ${watermarkCode}
          </text>
        </g>
      </svg>
    `;
    return `url("data:image/svg+xml,${encodeURIComponent(watermarkSvg)}")`;
  }, [watermarkCode]);

  if (!testId || !currentQuestion) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Invalid test state</p>
          <button onClick={() => navigate('/test/login')} className="btn btn-primary">
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="test-container no-select bg-gray-100 flex flex-col relative overflow-hidden">
      <div
        className="pointer-events-none fixed inset-0 z-20"
        style={{
          backgroundImage: `${watermarkBackground}, ${watermarkBackground}`,
          backgroundRepeat: 'repeat, repeat',
          backgroundSize: '360px 220px, 360px 220px',
          backgroundPosition: '0 0, 180px 110px',
        }}
      />

      {/* High-priority warning banner – red, counts toward violation limit */}
      {showWarning && (
        <div className="fixed top-14 left-0 right-0 bg-red-600 text-white py-2 px-4 text-center z-50 shadow-lg font-medium">
          {warningMessage}
        </div>
      )}

      {/* Low-priority AI alert banner – yellow, trust score only, no violation count */}
      {!showWarning && showYellowWarning && (
        <div className="fixed top-14 left-0 right-0 bg-yellow-500 text-white py-2 px-4 text-center z-50 shadow-lg font-medium">
          {yellowWarningMessage}
        </div>
      )}

      {/* Fullscreen Prompt Modal */}
      {showFullscreenPrompt && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md text-center shadow-xl">
            <div className="text-red-500 text-5xl mb-4">⚠️</div>
            <h2 className="text-xl font-bold mb-4">Fullscreen Required</h2>
            <p className="text-gray-600 mb-6">
              You exited fullscreen mode. Click the button below to continue your test in fullscreen.
            </p>
            <button
              onClick={handleReenterFullscreen}
              className="btn btn-primary w-full py-3 text-lg"
            >
              Continue in Fullscreen
            </button>
          </div>
        </div>
      )}

      {isTestFrozen && (
        <div className="fixed inset-0 bg-black/70 z-[70] flex items-center justify-center px-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 text-center">
            <h2 className="text-xl font-bold text-red-700 mb-2">Test Paused</h2>
            <p className="text-gray-700">
              {faceFrozen
                ? 'No face detected. Please position your face clearly in front of the camera to resume the test.'
                : proctorStatus.testFrozen
                ? proctorStatus.freezeReason || 'Camera view is blocked. Please remove the obstruction to continue the test.'
                : policyPauseReason || 'Proctoring policy pause active. Please wait and continue.'}
            </p>
            <p className="text-sm text-gray-500 mt-3">
              {faceFrozen
                ? 'The test will resume automatically once your face is detected.'
                : proctorStatus.testFrozen
                ? 'Camera is being monitored continuously. The test will resume automatically once your face is clearly visible.'
                : 'The test will resume automatically after the policy pause window ends.'}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white/95 shadow-sm py-3 px-6 flex justify-between items-center relative z-10">
        <h1 className="font-bold text-lg text-gray-800">{testName}</h1>

        <div className="flex items-center gap-6">
          <div className="text-sm">
            <span className="text-gray-500">Answered: </span>
            <span className="font-medium">{getAnsweredCount()}/{questions.length}</span>
          </div>

          <div className="text-sm">
            <span className="text-gray-500">Violations: </span>
            <span className={`font-medium ${violations > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {violations}/{maxViolations}
            </span>
          </div>

          <div className={`text-xl font-mono font-bold ${timeRemaining < 300000 ? 'text-red-600' : 'text-primary-600'}`}>
            {formatTime(timeRemaining)}
          </div>

          <button
            onClick={() => setShowConfirmSubmit(true)}
            className="btn btn-primary"
            disabled={submitting || isTestFrozen}
          >
            Submit Test
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative z-10">
        {/* Question Navigation Sidebar */}
        <aside className="w-20 bg-white shadow-sm p-2 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            {questions.map((q, idx) => {
              const isAnswered = q.type === 'mcq'
                ? mcqAnswers[q.questionId]?.length > 0
                : q.type === 'coding'
                  ? codingAnswers[q.questionId]?.code?.length > 0
                  : (behavioralAnswers[q.questionId] || '').trim().length > 0;

              return (
                <button
                  key={q.id}
                  onClick={() => {
                    if (isTestFrozen) return;
                    saveCurrentAnswer();
                    setCurrentQuestion(idx);
                  }}
                  className={`aspect-square rounded-lg text-sm font-medium transition-colors ${
                    currentQuestionIndex === idx
                      ? 'bg-primary-600 text-white'
                      : isAnswered
                      ? 'bg-green-100 text-green-800 border border-green-300'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-4xl mx-auto">
            {/* Question Header */}
            <div className="flex justify-between items-start mb-4">
              <div>
                <span
                  className={`badge ${
                    currentQuestion.type === 'mcq'
                      ? 'badge-info'
                      : currentQuestion.type === 'coding'
                        ? 'badge-warning'
                        : 'badge-success'
                  }`}
                >
                  {currentQuestion.type === 'mcq'
                    ? 'MCQ'
                    : currentQuestion.type === 'coding'
                      ? 'Coding'
                      : 'Behavioral'}
                </span>
                <span className="ml-2 text-sm text-gray-500">
                  Question {currentQuestionIndex + 1} of {questions.length}
                </span>
              </div>
            </div>

            {currentQuestion.type === 'mcq' ? (
              /* MCQ Question */
              <div className="card">
                <p className="text-lg font-medium mb-6">{currentQuestion.questionText}</p>

                {/* Media Attachments Display */}
                {currentQuestion.mediaAssets && currentQuestion.mediaAssets.length > 0 && (
                  <div className="mb-6 space-y-4">
                    <div className="text-sm font-medium text-gray-700 mb-2">
                      Attached Media:
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {currentQuestion.mediaAssets.map((asset: {
                        id: string;
                        storageUrl: string;
                        mediaType: string;
                        originalName: string;
                        mimeType: string;
                      }) => (
                        <div key={asset.id} className="border rounded-lg overflow-hidden bg-gray-50">
                          {asset.mediaType === 'image' && (
                            <img
                              src={asset.storageUrl}
                              alt={asset.originalName}
                              className="w-full h-auto object-contain max-h-96"
                              loading="lazy"
                            />
                          )}
                          {asset.mediaType === 'video' && (
                            <video
                              src={asset.storageUrl}
                              controls
                              className="w-full h-auto"
                              preload="metadata"
                            >
                              Your browser does not support the video tag.
                            </video>
                          )}
                          {asset.mediaType === 'audio' && (
                            <div className="p-4">
                              <div className="text-sm text-gray-600 mb-2">
                                🎵 {asset.originalName}
                              </div>
                              <audio
                                src={asset.storageUrl}
                                controls
                                className="w-full"
                                preload="metadata"
                              >
                                Your browser does not support the audio tag.
                              </audio>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  {currentQuestion.options?.map((option: { originalIndex: number; text: string }, displayIdx: number) => {
                    const isSelected = mcqAnswers[currentQuestion.questionId]?.includes(option.originalIndex);

                    return (
                      <button
                        key={option.originalIndex}
                        onClick={() => handleMCQSelect(option.originalIndex)}
                        className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                          isSelected
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full mr-3 ${
                          isSelected ? 'bg-primary-600 text-white' : 'bg-gray-200'
                        }`}>
                          {String.fromCharCode(65 + displayIdx)}
                        </span>
                        {option.text}
                      </button>
                    );
                  })}
                </div>

                {currentQuestion.isMultipleChoice && (
                  <p className="mt-4 text-sm text-gray-500">
                    * Multiple answers may be correct
                  </p>
                )}
              </div>
            ) : currentQuestion.type === 'coding' ? (
              /* Coding Question */
              <div className="space-y-4">
                <div className="card">
                  <h2 className="text-xl font-semibold mb-4">{currentQuestion.title}</h2>
                  <p className="text-gray-700 whitespace-pre-wrap mb-4">{currentQuestion.description}</p>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <h3 className="font-medium text-gray-800">Input Format</h3>
                      <p className="text-gray-600">{currentQuestion.inputFormat}</p>
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-800">Output Format</h3>
                      <p className="text-gray-600">{currentQuestion.outputFormat}</p>
                    </div>
                  </div>

                  {currentQuestion.constraints && (
                    <div className="mt-4 text-sm">
                      <h3 className="font-medium text-gray-800">Constraints</h3>
                      <p className="text-gray-600">{currentQuestion.constraints}</p>
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div className="bg-gray-100 p-3 rounded">
                      <h3 className="font-medium text-sm mb-2">Sample Input</h3>
                      <pre className="font-mono text-sm">{currentQuestion.sampleInput}</pre>
                    </div>
                    <div className="bg-gray-100 p-3 rounded">
                      <h3 className="font-medium text-sm mb-2">Sample Output</h3>
                      <pre className="font-mono text-sm">{currentQuestion.sampleOutput}</pre>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="flex justify-between items-center mb-3">
                    <select
                      value={codingAnswers[currentQuestion.questionId]?.language || 'python'}
                      onChange={(e) => handleLanguageChange(e.target.value)}
                      className="input w-40"
                    >
                      {currentQuestion.supportedLanguages?.map((lang) => (
                        <option key={lang} value={lang}>
                          {lang.charAt(0).toUpperCase() + lang.slice(1)}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={handleRunCode}
                      disabled={runningCode || isTestFrozen}
                      className="btn btn-secondary"
                    >
                      {runningCode ? 'Running...' : 'Run Code'}
                    </button>
                  </div>

                  <div className="border rounded-lg overflow-hidden">
                    <Editor
                      key={currentQuestion.questionId}
                      height="400px"
                      language={codingAnswers[currentQuestion.questionId]?.language || 'python'}
                      value={codingAnswers[currentQuestion.questionId]?.code || ''}
                      onChange={handleCodeChange}
                      theme="vs-dark"
                      options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        wordWrap: 'on',
                        scrollBeyondLastLine: false,
                        readOnly: isTestFrozen,
                      }}
                    />
                  </div>

                  {codeOutput && (
                    <div className="mt-3 bg-gray-900 text-gray-100 p-4 rounded-lg">
                      <h3 className="text-sm font-medium mb-2">Output:</h3>
                      <pre className="text-sm font-mono whitespace-pre-wrap">{codeOutput}</pre>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Behavioral Question */
              <div className="card space-y-4">
                <h2 className="text-xl font-semibold">{currentQuestion.title}</h2>
                <p className="text-gray-700 whitespace-pre-wrap">{currentQuestion.description}</p>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Your Response
                  </label>
                  <textarea
                    value={behavioralAnswers[currentQuestion.questionId] || ''}
                    onChange={(e) => handleBehavioralChange(e.target.value)}
                    className="input min-h-[220px]"
                    rows={10}
                    placeholder="Write your response here..."
                  />
                </div>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="flex justify-between mt-6">
              <button
                onClick={() => {
                  if (isTestFrozen) return;
                  saveCurrentAnswer();
                  setCurrentQuestion(Math.max(0, currentQuestionIndex - 1));
                }}
                disabled={currentQuestionIndex === 0 || isTestFrozen}
                className="btn btn-secondary"
              >
                Previous
              </button>

              <button
                onClick={() => {
                  if (isTestFrozen) return;
                  saveCurrentAnswer();
                  setCurrentQuestion(Math.min(questions.length - 1, currentQuestionIndex + 1));
                }}
                disabled={currentQuestionIndex === questions.length - 1 || isTestFrozen}
                className="btn btn-primary"
              >
                Next
              </button>
            </div>
          </div>
        </main>
      </div>

      {/* Submit Confirmation Modal */}
      {showConfirmSubmit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="card w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Submit Test?</h2>
            <p className="text-gray-600 mb-4">
              You have answered {getAnsweredCount()} out of {questions.length} questions.
            </p>
            <p className="text-gray-600 mb-6">
              Are you sure you want to submit? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmSubmit(false)}
                className="btn btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={handleManualSubmit}
                disabled={submitting || isTestFrozen}
                className="btn btn-primary flex-1"
              >
                {submitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
