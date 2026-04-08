/**
 * useProctoring Hook
 *
 * Comprehensive proctoring hook for test interface
 * Handles camera, microphone, face detection, audio analysis,
 * monitor detection, and violation reporting
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import {
  initializeProctorSession,
  reportViolation,
  submitAnalysis,
  uploadSnapshot,
  updateMonitorCount,
  endProctorSession,
  getBrowserInfo,
  getScreenResolution,
  detectMonitors,
  requestCameraPermission,
  requestMicrophonePermission,
  requestScreenShare,
  uploadRecordingChunk,
  captureFrame,
  AudioAnalyzer,
  SimpleFaceDetector,
  ProctorSession,
  ViolationData,
} from '../services/proctorService';
import { AIProctor, DetectionResult, getAIProctor } from '../services/aiDetectionService';
import { clearCachedStreams, getCachedStreams } from '../services/devicePermissionService';

export interface ProctorStatus {
  isInitialized: boolean;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  screenShareEnabled: boolean;
  faceDetected: boolean;
  lookingAtScreen: boolean;
  cameraBlocked: boolean;
  testFrozen: boolean;
  freezeReason?: string;
  freezeStartedAt?: number | null;
  freezeDurationMs?: number;
  audioLevel: number;
  monitorCount: number;
  violations: ViolationData[];
  trustScore: number;
}

export interface ProctorConfig {
  enabled: boolean;
  enableCamera: boolean;
  enableMicrophone: boolean;
  enableScreenShare: boolean;
  enableFaceDetection: boolean;
  enableAudioAnalysis: boolean;
  enableMonitorDetection: boolean;
  faceDetectionInterval: number;
  snapshotInterval: number;
  onViolation?: (violation: ViolationData) => void;
  onTerminate?: () => void;
}

const defaultConfig: ProctorConfig = {
  enabled: true,
  enableCamera: true,
  enableMicrophone: true,
  enableScreenShare: false,
  enableFaceDetection: true,
  enableAudioAnalysis: true,
  enableMonitorDetection: true,
  faceDetectionInterval: 2000, // Check face every 2 seconds
  snapshotInterval: 45000, // Take snapshot every 45 seconds
};
const TEMP_DISABLE_AUDIO_PROCTORING = true;
const NO_SNAPSHOT_CLIENT_EVENTS = new Set(['voice_detected', 'secondary_monitor_detected']);
const TEMP_DISABLE_SUSPICIOUS_AUDIO = TEMP_DISABLE_AUDIO_PROCTORING;
const MATRIX_SEVERITY_BY_EVENT: Partial<Record<string, ViolationData['severity']>> = {
  tab_switch: 'medium',
  window_blur: 'medium',
  fullscreen_exit: 'high',
  copy_paste_attempt: 'medium',
  camera_blocked: 'critical',
  multiple_faces: 'critical',
  phone_detected: 'critical',
  face_not_detected: 'critical',
  looking_away: 'high',
  voice_detected: 'critical',
  secondary_monitor_detected: 'critical',
};

export function useProctoring(attemptId: string, config: Partial<ProctorConfig> = {}) {
  const mergedConfig = { ...defaultConfig, ...config };
  const finalConfig: ProctorConfig = TEMP_DISABLE_AUDIO_PROCTORING
    ? {
        ...mergedConfig,
        enableMicrophone: false,
        enableAudioAnalysis: false,
      }
    : mergedConfig;

  const [status, setStatus] = useState<ProctorStatus>({
    isInitialized: false,
    cameraEnabled: false,
    microphoneEnabled: false,
    screenShareEnabled: false,
    faceDetected: true,
    lookingAtScreen: true,
    cameraBlocked: false,
    testFrozen: false,
    freezeReason: undefined,
    freezeStartedAt: null,
    freezeDurationMs: 0,
    audioLevel: 0,
    monitorCount: 1,
    violations: [],
    trustScore: 100,
  });

  const [session, setSession] = useState<ProctorSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Refs for media streams and analyzers
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const processingVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenProcessingVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const audioAnalyzerRef = useRef<AudioAnalyzer | null>(null);
  const faceDetectorRef = useRef<SimpleFaceDetector | null>(null);
  const aiProctorRef = useRef<AIProctor | null>(null);
  const latestAIDetectionRef = useRef<DetectionResult | null>(null);
  const [aiProctorReady, setAiProctorReady] = useState(false);
  const webcamRecorderRef = useRef<MediaRecorder | null>(null);
  const screenRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStartRef = useRef<Record<string, number>>({});
  const recordingChunkIndexRef = useRef<Record<string, number>>({});
  const recordingUploadFailuresRef = useRef<Record<string, number>>({});
  const recordingUploadDisabledRef = useRef<Record<string, boolean>>({});
  const clientViolationSeenRef = useRef<Record<string, number>>({});
  const latestScreenEvidenceFrameRef = useRef<string | null>(null);

  // Interval refs
  const faceDetectionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analysisIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const obstructionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const screenEvidenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapshotAnalysisInFlightRef = useRef(false);
  const analysisFailureStreakRef = useRef(0);
  const analysisBackoffUntilRef = useRef(0);

  const serverViolationSeenRef = useRef<Record<string, number>>({});
  const obstructionStateRef = useRef<{
    blocked: boolean;
    blockedSince: number | null;
    freezeStartedAt: number | null;
    clearStreak: number;
  }>({
    blocked: false,
    blockedSince: null,
    freezeStartedAt: null,
    clearStreak: 0,
  });

  const analysisIntervalMs = Number((import.meta as any).env?.VITE_PROCTOR_ANALYSIS_INTERVAL_MS || 2500);
  const recordingChunkMs = Number((import.meta as any).env?.VITE_PROCTOR_RECORDING_CHUNK_MS || 30000);
  const analysisFrameQuality = Number((import.meta as any).env?.VITE_PROCTOR_ANALYSIS_FRAME_QUALITY || 0.9);
  const analysisFrameMaxWidth = Number((import.meta as any).env?.VITE_PROCTOR_ANALYSIS_FRAME_MAX_WIDTH || 1280);
  const snapshotFrameQuality = Number((import.meta as any).env?.VITE_PROCTOR_SNAPSHOT_QUALITY || 0.85);
  const snapshotFrameMaxWidth = Number((import.meta as any).env?.VITE_PROCTOR_SNAPSHOT_MAX_WIDTH || 1024);
  const enableWebcamRecording = ((import.meta as any).env?.VITE_ENABLE_WEBCAM_RECORDING || 'false') === 'true';
  const allowRuntimeScreenPrompt = ((import.meta as any).env?.VITE_ALLOW_RUNTIME_SCREEN_PROMPT || 'false') === 'true';
  const traceEnabled = ((import.meta as any).env?.VITE_PROCTOR_TRACE || 'false') === 'true';

  const traceLog = useCallback((stage: string, data: Record<string, unknown>) => {
    if (!traceEnabled) return;
    console.log(`[PROCTOR_TRACE][frontend][${stage}]`, data);
  }, [traceEnabled]);

  const reportViolationAndHandleTermination = useCallback(async (violation: ViolationData) => {
    if (!session) return { success: false, shouldTerminate: false };
    const result = await reportViolation(session.sessionId, violation);
    if (result.shouldTerminate && finalConfig.onTerminate) {
      finalConfig.onTerminate();
    }
    return result;
  }, [session, finalConfig]);

  const canEmitClientViolation = useCallback((key: string, cooldownMs = 12000): boolean => {
    const now = Date.now();
    const last = clientViolationSeenRef.current[key] || 0;
    if (now - last < cooldownMs) return false;
    clientViolationSeenRef.current[key] = now;
    return true;
  }, []);

  const getActiveVideoElement = useCallback((): HTMLVideoElement | null => {
    const processingVideo = processingVideoRef.current;
    if (processingVideo && processingVideo.videoWidth > 0 && processingVideo.videoHeight > 0) {
      return processingVideo;
    }
    const uiVideo = videoRef.current;
    if (uiVideo && uiVideo.videoWidth > 0 && uiVideo.videoHeight > 0) {
      return uiVideo;
    }
    return processingVideo || uiVideo || null;
  }, []);

  const getActiveScreenVideoElement = useCallback((): HTMLVideoElement | null => {
    const screenVideo = screenProcessingVideoRef.current;
    if (screenVideo && screenVideo.videoWidth > 0 && screenVideo.videoHeight > 0) {
      return screenVideo;
    }
    return null;
  }, []);

  const captureViolationEvidenceFrame = useCallback((
    options: { quality?: number; maxWidth?: number; allowWebcamFallback?: boolean } = {}
  ): { snapshotData?: string; snapshotSource: 'screen_share' | 'screen_share_cached' | 'webcam' | 'none' } => {
    const quality = options.quality ?? 0.8;
    const maxWidth = options.maxWidth ?? 1280;

    const screenVideo = getActiveScreenVideoElement();
    if (screenVideo) {
      const frame = captureFrame(screenVideo, { quality, maxWidth });
      if (frame) {
        latestScreenEvidenceFrameRef.current = frame;
        return { snapshotData: frame, snapshotSource: 'screen_share' };
      }
    }

    const cachedScreenFrame = latestScreenEvidenceFrameRef.current;
    if (cachedScreenFrame) {
      return { snapshotData: cachedScreenFrame, snapshotSource: 'screen_share_cached' };
    }

    if (options.allowWebcamFallback !== false) {
      const cameraVideo = getActiveVideoElement();
      if (cameraVideo) {
        const frame = captureFrame(cameraVideo, { quality, maxWidth: Math.min(maxWidth, 960) });
        if (frame) {
          return { snapshotData: frame, snapshotSource: 'webcam' };
        }
      }
    }

    return { snapshotSource: 'none' };
  }, [getActiveScreenVideoElement, getActiveVideoElement]);

  const analyzeObstructionSignal = useCallback((video: HTMLVideoElement): {
    blocked: boolean;
    reason: string;
    confidence: number;
  } => {
    try {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) {
        return { blocked: true, reason: 'camera_frame_unavailable', confidence: 96 };
      }

      const canvas = document.createElement('canvas');
      const sampleW = 160;
      const sampleH = Math.max(1, Math.floor((height / width) * sampleW));
      canvas.width = sampleW;
      canvas.height = sampleH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return { blocked: false, reason: 'unknown', confidence: 0 };
      }
      ctx.drawImage(video, 0, 0, sampleW, sampleH);
      const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
      let sum = 0;
      let sumSq = 0;
      const total = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        sum += y;
        sumSq += y * y;
      }
      const mean = sum / Math.max(1, total);
      const variance = sumSq / Math.max(1, total) - mean * mean;
      const stdDev = Math.sqrt(Math.max(0, variance));

      // Heuristic camera obstruction checks:
      // - very dark frame (covered lens/off camera)
      // - very low variance (uniform obstruction)
      if (mean < 18) {
        return { blocked: true, reason: 'camera_dark_frame', confidence: 95 };
      }
      if (stdDev < 8) {
        return { blocked: true, reason: 'camera_uniform_obstruction', confidence: 88 };
      }
      return { blocked: false, reason: 'clear', confidence: 0 };
    } catch {
      return { blocked: false, reason: 'unknown', confidence: 0 };
    }
  }, []);

  // Initialize proctoring
  const initialize = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (!finalConfig.enabled) {
        setIsLoading(false);
        return;
      }

      if (!attemptId) {
        setError('Missing attempt ID for proctoring');
        setIsLoading(false);
        return;
      }

      // Detect initial monitor count
      const monitorCount = await detectMonitors();
      setStatus(prev => ({ ...prev, monitorCount }));
      traceLog('init_start', { attemptId, monitorCount });

      // Request camera permission
      let cameraEnabled = false;
      if (finalConfig.enableCamera) {
        const cached = getCachedStreams();
        const cameraStream = cached.cameraStream || await requestCameraPermission();
        if (cameraStream) {
          cameraStreamRef.current = cameraStream;
          cameraEnabled = true;
          setStatus(prev => ({ ...prev, cameraEnabled: true }));

          // Stable hidden video feed for AI processing; remains active even if UI panel unmounts.
          // Attached to DOM so browsers correctly report videoWidth/videoHeight.
          const processingVideo = document.createElement('video');
          processingVideo.autoplay = true;
          processingVideo.muted = true;
          processingVideo.playsInline = true;
          processingVideo.setAttribute('aria-hidden', 'true');
          processingVideo.style.cssText =
            'position:fixed;width:1px;height:1px;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
          document.body.appendChild(processingVideo);
          processingVideo.srcObject = cameraStream;
          processingVideo.play().catch(console.error);
          processingVideoRef.current = processingVideo;

          // Initialize face detector (simple fallback)
          if (finalConfig.enableFaceDetection) {
            faceDetectorRef.current = new SimpleFaceDetector();
            faceDetectorRef.current.initialize(processingVideo);
          }

          // Initialize AI Proctor (YOLO-based detection)
          aiProctorRef.current = getAIProctor();
          aiProctorRef.current.initialize().then(ready => {
            setAiProctorReady(ready);
            traceLog('ai_init', { ready });
            if (ready) {
              console.log('AI Proctor (YOLO/COCO-SSD) initialized successfully');
            } else {
              console.warn('AI Proctor failed to initialize, using simple detection');
            }
          });
        } else {
          setError('Camera permission denied');
        }
      }

      // Request microphone permission
      let microphoneEnabled = false;
      if (finalConfig.enableMicrophone) {
        const cached = getCachedStreams();
        const micStream = cached.microphoneStream || await requestMicrophonePermission();
        if (micStream) {
          micStreamRef.current = micStream;
          microphoneEnabled = true;
          setStatus(prev => ({ ...prev, microphoneEnabled: true }));

          // Initialize audio analyzer
          if (finalConfig.enableAudioAnalysis) {
            audioAnalyzerRef.current = new AudioAnalyzer();
            await audioAnalyzerRef.current.initialize(micStream);
          }
        } else {
          setError('Microphone permission denied');
        }
      }

      // Request screen share permission
      let screenShareEnabled = false;
      if (finalConfig.enableScreenShare) {
        const cached = getCachedStreams();
        const screenStream = cached.screenStream || (allowRuntimeScreenPrompt ? await requestScreenShare() : null);
        if (screenStream) {
          screenStreamRef.current = screenStream;
          if (screenProcessingVideoRef.current) {
            screenProcessingVideoRef.current.pause();
            screenProcessingVideoRef.current.srcObject = null;
          if (screenProcessingVideoRef.current.parentNode) {
            screenProcessingVideoRef.current.parentNode.removeChild(screenProcessingVideoRef.current);
          }
          screenProcessingVideoRef.current = null;
          }
          const screenProcessingVideo = document.createElement('video');
          screenProcessingVideo.autoplay = true;
          screenProcessingVideo.muted = true;
          screenProcessingVideo.playsInline = true;
          screenProcessingVideo.setAttribute('aria-hidden', 'true');
          screenProcessingVideo.style.cssText =
            'position:fixed;width:1px;height:1px;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
          document.body.appendChild(screenProcessingVideo);
          screenProcessingVideo.srcObject = screenStream;
          screenProcessingVideo.play().catch(console.error);
          screenProcessingVideoRef.current = screenProcessingVideo;
          screenShareEnabled = true;
          setStatus(prev => ({ ...prev, screenShareEnabled: true }));
        } else {
          latestScreenEvidenceFrameRef.current = null;
          // Surface as hook error; UI decides how to present and route.
          setError('Screen share permission denied');
        }
      } else {
        latestScreenEvidenceFrameRef.current = null;
      }

      // Enforce mandatory proctoring permissions
      if (finalConfig.enableCamera && !cameraEnabled) {
        setIsLoading(false);
        return;
      }
      if (finalConfig.enableMicrophone && !microphoneEnabled) {
        setIsLoading(false);
        return;
      }
      if (finalConfig.enableScreenShare && !screenShareEnabled) {
        setIsLoading(false);
        return;
      }

      // Initialize session with backend
      const proctorSession = await initializeProctorSession(attemptId, {
        cameraEnabled,
        microphoneEnabled,
        screenShareEnabled,
        browserInfo: getBrowserInfo(),
        screenResolution: getScreenResolution(),
        monitorCount,
      });

      if (!proctorSession) {
        setError('Failed to initialize proctoring session');
        setIsLoading(false);
        return;
      }

      setSession(proctorSession);
      setStatus(prev => ({ ...prev, isInitialized: true }));
      traceLog('session_initialized', {
        sessionId: proctorSession.sessionId,
        cameraEnabled,
        microphoneEnabled,
        screenShareEnabled,
      });

      const startChunkedRecorder = (
        mediaStream: MediaStream,
        recordingType: 'webcam' | 'screen',
        targetRef: { current: MediaRecorder | null }
      ) => {
        try {
          const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
            ? 'video/webm;codecs=vp8,opus'
            : 'video/webm';
          const recorder = new MediaRecorder(mediaStream, {
            mimeType,
            videoBitsPerSecond: recordingType === 'screen' ? 700_000 : 400_000,
          });
          recordingStartRef.current[recordingType] = Date.now();
          recordingChunkIndexRef.current[recordingType] = 0;

          recorder.ondataavailable = async (event) => {
            if (!event.data || event.data.size === 0) return;
            if (recordingUploadDisabledRef.current[recordingType]) return;
            const chunkIndex = recordingChunkIndexRef.current[recordingType] || 0;
            const reader = new FileReader();
            reader.onloadend = async () => {
              const result = reader.result as string;
              const chunkData = result.split(',')[1];
              const uploaded = await uploadRecordingChunk(proctorSession.sessionId, {
                recordingType,
                chunkData,
                mimeType: event.data.type || 'video/webm',
                chunkIndex,
                startTime: new Date(recordingStartRef.current[recordingType]).toISOString(),
                endTime: new Date().toISOString(),
                duration: Math.floor((Date.now() - recordingStartRef.current[recordingType]) / 1000),
                fileSize: event.data.size,
              });
              if (!uploaded) {
                const failures = (recordingUploadFailuresRef.current[recordingType] || 0) + 1;
                recordingUploadFailuresRef.current[recordingType] = failures;
                if (failures >= 3) {
                  recordingUploadDisabledRef.current[recordingType] = true;
                  toast.error(
                    `${recordingType} recording uploads paused due to backend/database errors`
                  );
                }
              } else {
                recordingUploadFailuresRef.current[recordingType] = 0;
              }
              recordingChunkIndexRef.current[recordingType] = chunkIndex + 1;
            };
            reader.readAsDataURL(event.data);
          };

          recorder.start(recordingChunkMs);
          targetRef.current = recorder;
        } catch (recordingError) {
          console.error(`Failed to start ${recordingType} recorder:`, recordingError);
        }
      };

      if (enableWebcamRecording && cameraStreamRef.current) {
        const webcamTracks: MediaStreamTrack[] = [
          ...cameraStreamRef.current.getVideoTracks(),
          ...(micStreamRef.current ? micStreamRef.current.getAudioTracks() : []),
        ];
        if (webcamTracks.length > 0) {
          startChunkedRecorder(new MediaStream(webcamTracks), 'webcam', webcamRecorderRef);
        }
      }
      if (screenStreamRef.current) {
        startChunkedRecorder(screenStreamRef.current, 'screen', screenRecorderRef);
      }

      setIsLoading(false);
    } catch (err) {
      console.error('Failed to initialize proctoring:', err);
      setError('Failed to initialize proctoring');
      setIsLoading(false);
    }
  }, [
    attemptId,
    finalConfig,
    recordingChunkMs,
    enableWebcamRecording,
    allowRuntimeScreenPrompt,
    reportViolationAndHandleTermination,
  ]);

  // Set video element for face detection
  const setVideoElement = useCallback((video: HTMLVideoElement) => {
    videoRef.current = video;
    if (cameraStreamRef.current && video) {
      video.srcObject = cameraStreamRef.current;
      video.play().catch(console.error);

      // Fallback: initialize on UI element only when hidden processing video is absent.
      if (faceDetectorRef.current && !processingVideoRef.current) {
        faceDetectorRef.current.initialize(video);
      }
    }
  }, []);

  // Run face detection/status only. Violations are emitted by backend analysis pipeline.
  const runFaceDetection = useCallback(async () => {
    const activeVideo = getActiveVideoElement();
    if (!activeVideo || !session) return;

    let faceDetected = true;
    let lookingAtScreen = true;

    // Use AI Proctor (YOLO/COCO-SSD + BlazeFace) if ready
    if (aiProctorReady && aiProctorRef.current) {
      try {
        const aiResult = await aiProctorRef.current.detect(activeVideo);
        latestAIDetectionRef.current = aiResult;

        // Process AI detection results
        faceDetected = aiResult.faces.length > 0;
        lookingAtScreen = aiResult.faces.length > 0 && aiResult.faces[0].isLookingAtScreen;
        traceLog('ai_detect', {
          faces: aiResult.faces.length,
          objects: aiResult.objects.length,
          violations: aiResult.violations.length,
          lookingAtScreen,
        });

        // Direct object-rule fallback based on detector outputs (not only aiResult.violations).
        const objs = aiResult.objects || [];
        const phoneObj = objs.find((o) => o.class === 'cell phone' && o.confidence >= 35);
        const laptopObj = objs.find((o) => o.class === 'laptop' && o.confidence >= 45);
        const remoteObj = objs.find((o) => o.class === 'remote' && o.confidence >= 45);

        if (phoneObj && canEmitClientViolation('object:phone', 9000)) {
          const violationEvidence = captureViolationEvidenceFrame({ quality: 0.72, maxWidth: 1280 });
          const violationData: ViolationData = {
            eventType: 'phone_detected',
            severity: 'critical',
            confidence: Math.round(phoneObj.confidence),
            description: `Mobile phone detected (${Math.round(phoneObj.confidence)}%)`,
            metadata: { snapshotSource: violationEvidence.snapshotSource },
            snapshotData: violationEvidence.snapshotData,
          };
          await reportViolationAndHandleTermination(violationData);
          traceLog('client_violation_emit', {
            eventType: violationData.eventType,
            severity: violationData.severity,
            confidence: violationData.confidence,
            source: 'ai_object_rule',
          });
          setStatus(prev => ({ ...prev, violations: [...prev.violations, violationData] }));
          if (finalConfig.onViolation) finalConfig.onViolation(violationData);
        }

        if ((laptopObj || remoteObj) && canEmitClientViolation('object:unauthorized', 10000)) {
          const best = laptopObj || remoteObj!;
          const violationEvidence = captureViolationEvidenceFrame({ quality: 0.72, maxWidth: 1280 });
          const violationData: ViolationData = {
            eventType: 'unauthorized_object_detected',
            severity: 'high',
            confidence: Math.round(best.confidence),
            description: `${best.class} detected (${Math.round(best.confidence)}%)`,
            metadata: { snapshotSource: violationEvidence.snapshotSource },
            snapshotData: violationEvidence.snapshotData,
          };
          await reportViolationAndHandleTermination(violationData);
          traceLog('client_violation_emit', {
            eventType: violationData.eventType,
            severity: violationData.severity,
            confidence: violationData.confidence,
            source: 'ai_object_rule',
          });
          setStatus(prev => ({ ...prev, violations: [...prev.violations, violationData] }));
          if (finalConfig.onViolation) finalConfig.onViolation(violationData);
        }

        // Fallback path: emit client-side critical violations when backend misses/lags.
        for (const v of aiResult.violations) {
          let mappedType = v.type;
          if (v.type.includes('cell phone')) mappedType = 'phone_detected';
          else if (v.type.includes('multiple_faces')) mappedType = 'multiple_faces';
          else if (v.type.includes('face_not_detected')) mappedType = 'face_not_detected';
          else if (v.type.includes('laptop') || v.type.includes('book') || v.type.includes('remote')) {
            mappedType = 'unauthorized_object_detected';
          }

          const dedupeKey = `${mappedType}:${v.severity}`;
          if (!canEmitClientViolation(dedupeKey)) continue;
          const violationEvidence = NO_SNAPSHOT_CLIENT_EVENTS.has(mappedType)
            ? { snapshotSource: 'none' as const, snapshotData: undefined }
            : captureViolationEvidenceFrame({ quality: 0.7, maxWidth: 1280 });

          const violationData: ViolationData = {
            eventType: mappedType,
            severity: MATRIX_SEVERITY_BY_EVENT[mappedType] || v.severity,
            confidence: Math.max(50, v.confidence),
            description: v.description,
            metadata: violationEvidence.snapshotData
              ? { snapshotSource: violationEvidence.snapshotSource }
              : undefined,
            snapshotData: violationEvidence.snapshotData,
          };

          await reportViolationAndHandleTermination(violationData);
          traceLog('client_violation_emit', {
            eventType: violationData.eventType,
            severity: violationData.severity,
            confidence: violationData.confidence,
            source: 'ai_violation_list',
          });
          setStatus(prev => ({
            ...prev,
            violations: [...prev.violations, violationData],
          }));
          if (finalConfig.onViolation) {
            finalConfig.onViolation(violationData);
          }
        }
      } catch (err) {
        console.error('AI detection failed, using fallback:', err);
        // Fall back to simple detection
        if (faceDetectorRef.current) {
          const result = faceDetectorRef.current.detect();
          faceDetected = result.faceDetected;
          lookingAtScreen = result.lookingAtScreen;
        }
      }
    } else if (faceDetectorRef.current) {
      // Use simple face detection as fallback
      const result = faceDetectorRef.current.detect();
      faceDetected = result.faceDetected;
      lookingAtScreen = result.lookingAtScreen;
    }

    setStatus(prev => ({
      ...prev,
      faceDetected,
      lookingAtScreen,
    }));
  }, [
    session,
    aiProctorReady,
    getActiveVideoElement,
    canEmitClientViolation,
    reportViolationAndHandleTermination,
    finalConfig,
    captureViolationEvidenceFrame,
  ]);

  // Run audio status only. Violations are emitted by backend analysis pipeline.
  const runAudioAnalysis = useCallback(async () => {
    if (!audioAnalyzerRef.current || !session) return;

    const result = audioAnalyzerRef.current.analyze();
    setStatus(prev => ({ ...prev, audioLevel: result.audioLevel }));
    if (!TEMP_DISABLE_SUSPICIOUS_AUDIO && result.suspiciousSound && canEmitClientViolation('audio:suspicious', 10000)) {
      const violation: ViolationData = {
        eventType: 'suspicious_audio',
        severity: result.audioLevel >= 58 ? 'high' : 'medium',
        confidence: Math.max(55, Math.round((result.confidence || 0.6) * 100)),
        description: `Suspicious audio detected (${result.audioLevel.toFixed(1)})`,
        metadata: { audioLevel: result.audioLevel },
      };
      await reportViolationAndHandleTermination(violation);
      traceLog('client_violation_emit', {
        eventType: violation.eventType,
        severity: violation.severity,
        confidence: violation.confidence,
        audioLevel: result.audioLevel,
        source: 'audio_fallback',
      });
      setStatus(prev => ({
        ...prev,
        violations: [...prev.violations, violation],
      }));
      if (finalConfig.onViolation) {
        finalConfig.onViolation(violation);
      }
    }
  }, [session, canEmitClientViolation, reportViolationAndHandleTermination, finalConfig]);

  const runObstructionMonitor = useCallback(async () => {
    if (!session) return;
    const activeVideo = getActiveVideoElement();
    if (!activeVideo) return;

    const cameraTracks = cameraStreamRef.current?.getVideoTracks() || [];
    const cameraTrack = cameraTracks.length > 0 ? cameraTracks[0] : null;
    const trackBlocked = !cameraTrack || cameraTrack.readyState !== 'live' || cameraTrack.enabled === false;
    const visual = analyzeObstructionSignal(activeVideo);
    const blockedNow = trackBlocked || visual.blocked;
    const reason = trackBlocked ? 'camera_disabled_or_disconnected' : visual.reason;
    const confidence = trackBlocked ? 98 : visual.confidence;

    const state = obstructionStateRef.current;
    const now = Date.now();
    if (blockedNow) {
      state.clearStreak = 0;
      if (!state.blockedSince) {
        state.blockedSince = now;
      }
      const sustainedMs = now - state.blockedSince;
      const shouldFreeze = sustainedMs >= 1200;

      if (shouldFreeze && !state.blocked) {
        state.blocked = true;
        state.freezeStartedAt = now;
        const violationEvidence = captureViolationEvidenceFrame({ quality: 0.8, maxWidth: 1280 });
        const violation: ViolationData = {
          eventType: 'camera_blocked',
          severity: 'critical',
          confidence: Math.max(70, Math.round(confidence)),
          description: 'Camera view is blocked or unavailable',
          metadata: {
            reason,
            detectedAt: new Date(now).toISOString(),
            snapshotSource: violationEvidence.snapshotSource,
          },
          snapshotData: violationEvidence.snapshotData,
        };
        await reportViolationAndHandleTermination(violation);
        setStatus(prev => ({
          ...prev,
          cameraBlocked: true,
          testFrozen: true,
          freezeReason: 'Camera view is blocked. Please remove the obstruction to continue the test.',
          freezeStartedAt: now,
          freezeDurationMs: 0,
          violations: [...prev.violations, violation],
        }));
        if (finalConfig.onViolation) {
          finalConfig.onViolation(violation);
        }
      } else if (state.blocked) {
        setStatus(prev => ({
          ...prev,
          cameraBlocked: true,
          testFrozen: true,
          freezeDurationMs: state.freezeStartedAt ? now - state.freezeStartedAt : prev.freezeDurationMs,
        }));
      }
      return;
    }

    state.clearStreak += 1;
    if (state.clearStreak < 2) return;
    state.blockedSince = null;

    if (state.blocked) {
      const faceClear = faceDetectorRef.current ? !!faceDetectorRef.current.detect().faceDetected : true;
      if (!faceClear) {
        return;
      }
      const freezeStartedAt = state.freezeStartedAt || now;
      const freezeDurationMs = Math.max(0, now - freezeStartedAt);
      state.blocked = false;
      state.freezeStartedAt = null;
      const resumeEvidence = captureViolationEvidenceFrame({ quality: 0.7, maxWidth: 1280 });
      const resumeEvent: ViolationData = {
        eventType: 'camera_resumed',
        severity: 'low',
        confidence: 85,
        duration: freezeDurationMs,
        description: 'Camera obstruction cleared. Test resumed.',
        metadata: {
          freezeStartedAt: new Date(freezeStartedAt).toISOString(),
          resumedAt: new Date(now).toISOString(),
          freezeDurationMs,
          snapshotSource: resumeEvidence.snapshotSource,
        },
        snapshotData: resumeEvidence.snapshotData,
      };
      await reportViolationAndHandleTermination(resumeEvent);
      setStatus(prev => ({
        ...prev,
        cameraBlocked: false,
        testFrozen: false,
        freezeReason: undefined,
        freezeStartedAt: null,
        freezeDurationMs,
      }));
    } else {
      setStatus(prev => ({
        ...prev,
        cameraBlocked: false,
        testFrozen: false,
      }));
    }
  }, [
    session,
    finalConfig,
    getActiveVideoElement,
    analyzeObstructionSignal,
    reportViolationAndHandleTermination,
    captureViolationEvidenceFrame,
  ]);

  // Upload periodic snapshot
  const uploadPeriodicSnapshot = useCallback(async () => {
    const activeVideo = getActiveVideoElement();
    if (!activeVideo || !session) return;

    const imageData = captureFrame(activeVideo, { quality: snapshotFrameQuality, maxWidth: snapshotFrameMaxWidth });
    if (imageData) {
      await uploadSnapshot(session.sessionId, imageData, 'periodic_check');
    }
  }, [session, getActiveVideoElement, snapshotFrameQuality, snapshotFrameMaxWidth]);

  /**
   * Capture a JPEG snapshot from the camera.
   * Uses ImageCapture API first (takes photo directly from hardware, most reliable),
   * then falls back to drawing the video element onto a canvas.
   */
  const takeWebcamSnapshot = useCallback(async (): Promise<string | null> => {
    // --- Method 1: ImageCapture API (bypasses video element completely) ---
    const track = cameraStreamRef.current?.getVideoTracks()?.[0];
    if (track && track.readyState === 'live' && typeof (window as any).ImageCapture !== 'undefined') {
      try {
        const ic = new (window as any).ImageCapture(track);
        const blob: Blob = await ic.takePhoto({ imageWidth: analysisFrameMaxWidth });
        return await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            const b64 = result.split(',')[1];
            resolve(b64 || null);
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      } catch {
        // fall through to canvas fallback
      }
    }

    // --- Method 2: Canvas from video element ---
    const activeVideo = getActiveVideoElement();
    if (!activeVideo) return null;
    return captureFrame(activeVideo, { quality: analysisFrameQuality, maxWidth: analysisFrameMaxWidth });
  }, [getActiveVideoElement, analysisFrameQuality, analysisFrameMaxWidth]);

  /**
   * Snapshot-based analysis: every few seconds, take a photo from the camera and send it to the
   * backend. The backend forwards the image to the Python CV service (YOLO + MediaPipe)
   * which returns violations. This is simpler and more reliable than trying to extract
   * frames from a live video element.
   */
  const runSnapshotAnalysis = useCallback(async () => {
    if (!session) return;
    if (Date.now() < analysisBackoffUntilRef.current) return;
    if (snapshotAnalysisInFlightRef.current) return;
    snapshotAnalysisInFlightRef.current = true;

    try {
      const frameData = await takeWebcamSnapshot();

      traceLog('snapshot_analysis', {
        sessionId: session.sessionId,
        frameAttached: !!frameData,
        frameLength: frameData?.length || 0,
        monitorCount: status.monitorCount,
        fullscreen: !!document.fullscreenElement,
        tabVisible: !document.hidden,
      });

      const audioResult = TEMP_DISABLE_AUDIO_PROCTORING
        ? undefined
        : audioAnalyzerRef.current?.analyze();

      let analysisResult: { violations: ViolationData[]; shouldTerminate: boolean };
      try {
        analysisResult = await submitAnalysis(session.sessionId, {
          timestamp: Date.now(),
          frameData: frameData || undefined,
          ...(audioResult ? { audio: audioResult } : {}),
          screenInfo: {
            monitorCount: status.monitorCount,
            isFullscreen: !!document.fullscreenElement,
            tabVisible: !document.hidden,
          },
        });
      } catch (err) {
        console.error('snapshot analysis API failed:', err);
        analysisFailureStreakRef.current += 1;
        const backoffMs = Math.min(10000, 1000 * (2 ** (analysisFailureStreakRef.current - 1)));
        analysisBackoffUntilRef.current = Date.now() + backoffMs;
        traceLog('snapshot_error', { message: err instanceof Error ? err.message : 'unknown' });
        traceLog('snapshot_backoff', {
          streak: analysisFailureStreakRef.current,
          backoffMs,
        });
        if (canEmitClientViolation('analysis:error', 15000)) {
          toast.error('Proctor analysis API failed. Check backend/CV service.');
        }
        return;
      }

      analysisFailureStreakRef.current = 0;
      analysisBackoffUntilRef.current = 0;

      traceLog('snapshot_response', {
        violations: analysisResult.violations.length,
        types: analysisResult.violations.map((v) => v.eventType),
        shouldTerminate: analysisResult.shouldTerminate,
      });

      if (analysisResult.violations?.length) {
        for (const violation of analysisResult.violations) {
          // Dedupe: same event type within 5s is suppressed
          const key = violation.eventType;
          const now = Date.now();
          const lastSeen = serverViolationSeenRef.current[key] || 0;
          if (now - lastSeen < 5000) continue;
          serverViolationSeenRef.current[key] = now;

          setStatus(prev => ({
            ...prev,
            violations: [...prev.violations, violation],
          }));

          if (finalConfig.onViolation) {
            finalConfig.onViolation(violation);
          }
        }
      }

      if (analysisResult.shouldTerminate && finalConfig.onTerminate) {
        finalConfig.onTerminate();
      }
    } finally {
      snapshotAnalysisInFlightRef.current = false;
    }
  }, [session, status.monitorCount, finalConfig, takeWebcamSnapshot, canEmitClientViolation, traceLog]);

  // Monitor for external monitors
  useEffect(() => {
    if (!finalConfig.enableMonitorDetection || !session) return;

    const checkMonitors = async () => {
      const currentCount = await detectMonitors();
      const previousCount = status.monitorCount;

      if (currentCount !== previousCount) {
        setStatus(prev => ({ ...prev, monitorCount: currentCount }));
        await updateMonitorCount(session.sessionId, currentCount);

        if (currentCount > 1 && previousCount <= 1 && canEmitClientViolation('monitor:secondary', 6000)) {
          const violation: ViolationData = {
            eventType: 'secondary_monitor_detected',
            severity: 'critical',
            confidence: 100,
            description: `Secondary monitor detected. Total monitors: ${currentCount}`,
            metadata: { monitorCount: currentCount },
          };
          setStatus(prev => ({
            ...prev,
            violations: [...prev.violations, violation],
          }));
          if (finalConfig.onViolation) {
            finalConfig.onViolation(violation);
          }
          toast.error('Secondary monitor detected! This is a violation.');
        }
      }
    };

    const interval = setInterval(checkMonitors, 8000);
    return () => clearInterval(interval);
  }, [session, status.monitorCount, finalConfig.enableMonitorDetection, finalConfig.onViolation, canEmitClientViolation]);

  // Start intervals when initialized
  useEffect(() => {
    if (!status.isInitialized || !session) return;

    // Face detection interval
    if (finalConfig.enableFaceDetection && finalConfig.enableCamera) {
      faceDetectionIntervalRef.current = setInterval(
        runFaceDetection,
        finalConfig.faceDetectionInterval
      );
    }

    // Snapshot interval
    if (finalConfig.enableCamera) {
      snapshotIntervalRef.current = setInterval(
        uploadPeriodicSnapshot,
        finalConfig.snapshotInterval
      );
    }

    // Audio interval
    if (finalConfig.enableAudioAnalysis && finalConfig.enableMicrophone) {
      audioIntervalRef.current = setInterval(runAudioAnalysis, 2000);
    }

    // Camera obstruction monitor (high-priority freeze safety).
    if (finalConfig.enableCamera) {
      obstructionIntervalRef.current = setInterval(runObstructionMonitor, 500);
    }

    // Analysis interval
    void runSnapshotAnalysis();
    analysisIntervalRef.current = setInterval(() => {
      void runSnapshotAnalysis();
    }, analysisIntervalMs);

    // Keep a recent screen evidence frame so tab-switch/window blur violations can still
    // carry evidence even if live screen capture is briefly unavailable at emit time.
    if (screenStreamRef.current) {
      const refreshScreenEvidence = () => {
        const screenVideo = getActiveScreenVideoElement();
        if (!screenVideo) return;
        const frame = captureFrame(screenVideo, { quality: 0.68, maxWidth: 1280 });
        if (frame) {
          latestScreenEvidenceFrameRef.current = frame;
        }
      };
      refreshScreenEvidence();
      screenEvidenceIntervalRef.current = setInterval(refreshScreenEvidence, 1500);
    }

    return () => {
      if (faceDetectionIntervalRef.current) {
        clearInterval(faceDetectionIntervalRef.current);
      }
      if (snapshotIntervalRef.current) {
        clearInterval(snapshotIntervalRef.current);
      }
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
      }
      if (audioIntervalRef.current) {
        clearInterval(audioIntervalRef.current);
      }
      if (obstructionIntervalRef.current) {
        clearInterval(obstructionIntervalRef.current);
      }
      if (screenEvidenceIntervalRef.current) {
        clearInterval(screenEvidenceIntervalRef.current);
      }
    };
  }, [
    status.isInitialized,
    session,
    finalConfig,
    runFaceDetection,
    runAudioAnalysis,
    runObstructionMonitor,
    uploadPeriodicSnapshot,
    runSnapshotAnalysis,
    analysisIntervalMs,
    getActiveScreenVideoElement,
  ]);

  // Initialize on mount
  useEffect(() => {
    initialize();

    return () => {
      // Cleanup on unmount
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (processingVideoRef.current) {
        processingVideoRef.current.pause();
        processingVideoRef.current.srcObject = null;
        if (processingVideoRef.current.parentNode) {
          processingVideoRef.current.parentNode.removeChild(processingVideoRef.current);
        }
        processingVideoRef.current = null;
      }
      if (screenProcessingVideoRef.current) {
        screenProcessingVideoRef.current.pause();
        screenProcessingVideoRef.current.srcObject = null;
        if (screenProcessingVideoRef.current.parentNode) {
          screenProcessingVideoRef.current.parentNode.removeChild(screenProcessingVideoRef.current);
        }
        screenProcessingVideoRef.current = null;
      }
      latestScreenEvidenceFrameRef.current = null;
      if (audioAnalyzerRef.current) {
        audioAnalyzerRef.current.destroy();
      }
      clearCachedStreams(true);
      if (screenEvidenceIntervalRef.current) {
        clearInterval(screenEvidenceIntervalRef.current);
      }
      if (webcamRecorderRef.current && webcamRecorderRef.current.state !== 'inactive') {
        webcamRecorderRef.current.stop();
      }
      if (screenRecorderRef.current && screenRecorderRef.current.state !== 'inactive') {
        screenRecorderRef.current.stop();
      }
      if (aiProctorRef.current) {
        aiProctorRef.current.dispose();
      }
      if (session) {
        endProctorSession(session.sessionId);
      }
    };
  }, []);

  // Manual violation report
  const reportManualViolation = useCallback(async (
    eventType: string,
    description: string,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ) => {
    if (!session) return;
    const violationEvidence = captureViolationEvidenceFrame({ quality: 0.7, maxWidth: 1280 });

    const violation: ViolationData = {
      eventType,
      severity,
      confidence: 100,
      description,
      metadata: violationEvidence.snapshotData
        ? { snapshotSource: violationEvidence.snapshotSource }
        : undefined,
      snapshotData: violationEvidence.snapshotData,
    };

    await reportViolationAndHandleTermination(violation);
    setStatus(prev => ({
      ...prev,
      violations: [...prev.violations, violation],
    }));

    if (finalConfig.onViolation) {
      finalConfig.onViolation(violation);
    }
  }, [session, finalConfig, reportViolationAndHandleTermination, captureViolationEvidenceFrame]);

  // End session
  const endSession = useCallback(async () => {
    // Stop all intervals
    if (faceDetectionIntervalRef.current) {
      clearInterval(faceDetectionIntervalRef.current);
    }
    if (snapshotIntervalRef.current) {
      clearInterval(snapshotIntervalRef.current);
    }
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current);
    }
    if (audioIntervalRef.current) {
      clearInterval(audioIntervalRef.current);
    }
    if (obstructionIntervalRef.current) {
      clearInterval(obstructionIntervalRef.current);
    }
    if (screenEvidenceIntervalRef.current) {
      clearInterval(screenEvidenceIntervalRef.current);
    }

    // Stop media streams
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (processingVideoRef.current) {
      processingVideoRef.current.pause();
      processingVideoRef.current.srcObject = null;
      if (processingVideoRef.current.parentNode) {
        processingVideoRef.current.parentNode.removeChild(processingVideoRef.current);
      }
      processingVideoRef.current = null;
    }
    if (screenProcessingVideoRef.current) {
      screenProcessingVideoRef.current.pause();
      screenProcessingVideoRef.current.srcObject = null;
      if (screenProcessingVideoRef.current.parentNode) {
        screenProcessingVideoRef.current.parentNode.removeChild(screenProcessingVideoRef.current);
      }
      screenProcessingVideoRef.current = null;
    }
    latestScreenEvidenceFrameRef.current = null;

    // Destroy analyzers
    if (audioAnalyzerRef.current) {
      audioAnalyzerRef.current.destroy();
    }
    clearCachedStreams(true);
    if (webcamRecorderRef.current && webcamRecorderRef.current.state !== 'inactive') {
      webcamRecorderRef.current.stop();
    }
    if (screenRecorderRef.current && screenRecorderRef.current.state !== 'inactive') {
      screenRecorderRef.current.stop();
    }

    if (!session) return null;

    // End session with backend
    const summary = await endProctorSession(session.sessionId);
    return summary;
  }, [session]);

  const capturePreviewFrame = useCallback((options?: { quality?: number; maxWidth?: number }) => {
    const activeVideo = getActiveVideoElement();
    if (!activeVideo) return null;
    return captureFrame(activeVideo, options);
  }, [getActiveVideoElement]);

  const captureEvidenceFrame = useCallback(
    (options?: { quality?: number; maxWidth?: number; allowWebcamFallback?: boolean }) =>
      captureViolationEvidenceFrame(options),
    [captureViolationEvidenceFrame]
  );

  return {
    status,
    session,
    isLoading,
    error,
    setVideoElement,
    reportViolation: reportManualViolation,
    endSession,
    cameraStream: cameraStreamRef.current,
    aiProctorReady, // Indicates if YOLO/COCO-SSD AI detection is active
    runAudioAnalysis,
    capturePreviewFrame,
    captureEvidenceFrame,
  };
}

export default useProctoring;
