import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/db';
import {
  analyzeProctoring,
  storeViolation,
  storeFaceSnapshot,
  calculateTrustScore,
  generateProctoringSummary,
  ProctoringAnalysis,
  ViolationEvent,
} from '../services/proctorAIService';
import {
  uploadRecording,
  uploadSnapshot,
  deleteFile,
} from '../services/fileStorageService';
import { emitToProctorTargets } from '../services/socketService';
import { analyzeFrameWithPythonForSession } from '../services/pythonVisionService';

const PROCTOR_TRACE = (process.env.PROCTOR_TRACE || 'false').toLowerCase() === 'true';
const PROCTOR_AUTO_FLAG_ON_CRITICAL =
  (process.env.PROCTOR_AUTO_FLAG_ON_CRITICAL || 'false').toLowerCase() === 'true';
const PROCTOR_ENGINE_API_KEY = (process.env.PROCTOR_ENGINE_API_KEY || '').trim();
const TEMP_DISABLE_AUDIO_PROCTORING = true;
const PROCTOR_ALLOWED_EVENTS = new Set(
  (
    process.env.PROCTOR_ALLOWED_EVENTS ||
    'multiple_faces,phone_detected,face_not_detected,tab_switch,fullscreen_exit,window_blur,copy_paste_attempt,devtools_open,camera_blocked,looking_away,suspicious_audio,unauthorized_object_detected,secondary_monitor_detected'
  )
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)
);
// Temporary kill-switch: disable selected audio-derived violation events.
const TEMP_DISABLED_EVENTS = new Set([
  'suspicious_audio',
  'voice_detected',
  'multiple_voice_detected',
  'multiple_voices_detected',
  'multi_voice_detected',
  'multi_voice',
  'multiple_voice',
  'multiple_voices',
]);
const EXTERNAL_EVENT_MAP: Record<string, string> = {
  PHONE: 'phone_detected',
  NO_FACE: 'face_not_detected',
  MULTI_FACE: 'multiple_faces',
  VOICE: 'voice_detected',
  OFF_SCREEN: 'looking_away',
  SECONDARY_MONITOR: 'secondary_monitor_detected',
};
const EVENT_TYPE_ALIASES: Record<string, string> = {
  no_face: 'face_not_detected',
  no_face_detected: 'face_not_detected',
  no_face_visible: 'face_not_detected',
  no_person_visible: 'face_not_detected',
  face_missing: 'face_not_detected',
  multi_face: 'multiple_faces',
  multiple_face: 'multiple_faces',
  multi_faces: 'multiple_faces',
  more_than_one_face: 'multiple_faces',
  phone: 'phone_detected',
  mobile_phone: 'phone_detected',
  cell_phone: 'phone_detected',
  phone_usage: 'phone_detected',
  off_screen: 'looking_away',
  off_screen_gaze: 'looking_away',
  gaze_away: 'looking_away',
  voice: 'voice_detected',
  voice_activity: 'voice_detected',
  speech_detected: 'voice_detected',
  audio_voice: 'voice_detected',
  tab_change: 'tab_switch',
  tab_switched: 'tab_switch',
  full_screen_exit: 'fullscreen_exit',
  fullscreen_off: 'fullscreen_exit',
  focus_loss: 'window_blur',
  window_exit: 'window_blur',
  copy_paste: 'copy_paste_attempt',
  copy_attempt: 'copy_paste_attempt',
  paste_attempt: 'copy_paste_attempt',
  camera_obstructed: 'camera_blocked',
  camera_disabled: 'camera_blocked',
  cam_blocked: 'camera_blocked',
  dev_tools_open: 'devtools_open',
  external_monitor: 'secondary_monitor_detected',
  secondary_monitor: 'secondary_monitor_detected',
  secondary_screen: 'secondary_monitor_detected',
  secondary_screen_detected: 'secondary_monitor_detected',
};
const EXTERNAL_SEVERITY_MAP: Record<string, ViolationEvent['severity']> = {
  phone_detected: 'critical',
  face_not_detected: 'critical',
  multiple_faces: 'critical',
  voice_detected: 'critical',
  looking_away: 'high',
  secondary_monitor_detected: 'critical',
};
const MATRIX_EVENT_SEVERITY: Record<string, ViolationEvent['severity']> = {
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
const NO_SNAPSHOT_EVENT_TYPES = new Set(['voice_detected', 'secondary_monitor_detected']);

function proctorTrace(stage: string, data: Record<string, unknown>): void {
  if (!PROCTOR_TRACE) return;
  console.log(`[PROCTOR_TRACE][backend][${stage}]`, data);
}

function normalizeSessionMetadata(input: unknown): Prisma.JsonObject {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Prisma.JsonObject;
  }
  return {};
}

function mergeSessionMetadata(
  existing: unknown,
  patch: Prisma.JsonObject
): Prisma.JsonObject {
  return { ...normalizeSessionMetadata(existing), ...patch } as Prisma.JsonObject;
}

function stripLargeFields(payload: Record<string, any>): Prisma.JsonObject {
  const { frameData, snapshotData, audioClipData, ...rest } = payload;
  return {
    ...rest,
    frameDataSize: typeof frameData === 'string' ? frameData.length : 0,
    snapshotDataSize: typeof snapshotData === 'string' ? snapshotData.length : 0,
    audioClipDataSize: typeof audioClipData === 'string' ? audioClipData.length : 0,
  } as Prisma.JsonObject;
}

async function storeTelemetry(
  sessionId: string,
  source: 'analysis' | 'violation_report' | 'engine_event',
  payload: Prisma.InputJsonValue
): Promise<void> {
  try {
    await prisma.proctorTelemetry.create({
      data: {
        sessionId,
        source,
        payload,
      },
    });
  } catch (error) {
    console.error('Error storing proctor telemetry:', error);
  }
}

function normalizeViolationEventType(rawType: string): string {
  const normalized = (rawType || '').toString().trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) return normalized;
  return EVENT_TYPE_ALIASES[normalized] || normalized;
}

function isAllowedEvent(eventType: string): boolean {
  const normalized = normalizeViolationEventType(eventType);
  if (TEMP_DISABLED_EVENTS.has(normalized)) return false;
  return PROCTOR_ALLOWED_EVENTS.has(eventType) || PROCTOR_ALLOWED_EVENTS.has(normalized);
}

function normalizeSeverity(raw: unknown): ViolationEvent['severity'] {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  return 'medium';
}

function applyMatrixSeverity(
  eventType: string,
  fallback: ViolationEvent['severity'] = 'medium'
): ViolationEvent['severity'] {
  const normalized = normalizeViolationEventType(eventType);
  return MATRIX_EVENT_SEVERITY[normalized] || fallback;
}

function shouldAttachSnapshotEvidence(eventType: string): boolean {
  const normalized = normalizeViolationEventType(eventType);
  return !NO_SNAPSHOT_EVENT_TYPES.has(normalized);
}

let recordingUploadFailureCount = 0;
let recordingUploadCircuitOpenUntil = 0;
let snapshotUploadFailureCount = 0;
let snapshotUploadCircuitOpenUntil = 0;
const PROCTOR_EVIDENCE_FRAME_TTL_MS = Number(process.env.PROCTOR_EVIDENCE_FRAME_TTL_MS || 30000);

interface CachedEvidenceFrame {
  frameData: string;
  capturedAt: number;
}

const evidenceFrameBySession = new Map<string, CachedEvidenceFrame>();
const violationLastStoredAtMs = new Map<string, number>();
const PROCTOR_MAX_CONCURRENT_ANALYSIS = Number(process.env.PROCTOR_MAX_CONCURRENT_ANALYSIS || 140);
const PROCTOR_MAX_CONCURRENT_RECORDING_UPLOADS = Number(
  process.env.PROCTOR_MAX_CONCURRENT_RECORDING_UPLOADS || 30
);
let activeAnalysisRequests = 0;
let activeRecordingUploads = 0;
const PROCTOR_EVENT_COOLDOWN_MS: Record<string, number> = {
  voice_detected: Number(process.env.PROCTOR_VOICE_VIOLATION_COOLDOWN_MS || 120000),
};

// Per-session analysis rate limiter.
// Prevents a single slow candidate from hammering the Python CV service when
// their client sends frames faster than the backend can process them.
// At 200 candidates × 1 req per 4000ms = 50 req/s max to Python (down from 100).
const sessionAnalysisLastMs = new Map<string, number>();
const PROCTOR_SESSION_MIN_INTERVAL_MS = Number(process.env.PROCTOR_SESSION_MIN_INTERVAL_MS || 3000);
// Periodically evict stale entries so the Map doesn't grow indefinitely.
setInterval(() => {
  const cutoff = Date.now() - 300_000;
  for (const [key, ts] of sessionAnalysisLastMs) {
    if (ts < cutoff) sessionAnalysisLastMs.delete(key);
  }
}, 300_000);
setInterval(() => {
  const cutoff = Date.now() - 900_000;
  for (const [key, ts] of violationLastStoredAtMs) {
    if (ts < cutoff) violationLastStoredAtMs.delete(key);
  }
}, 300_000);

function cacheEvidenceFrame(sessionId: string, frameData?: string): void {
  if (!frameData) return;
  evidenceFrameBySession.set(sessionId, {
    frameData,
    capturedAt: Date.now(),
  });
}

function getRecentEvidenceFrame(sessionId: string): CachedEvidenceFrame | null {
  const cached = evidenceFrameBySession.get(sessionId);
  if (!cached) return null;
  if (Date.now() - cached.capturedAt > PROCTOR_EVIDENCE_FRAME_TTL_MS) {
    evidenceFrameBySession.delete(sessionId);
    return null;
  }
  return cached;
}

function getViolationCooldownMs(eventType: string): number {
  const normalized = normalizeViolationEventType(eventType);
  return Math.max(0, PROCTOR_EVENT_COOLDOWN_MS[normalized] || 0);
}

function canStoreViolationNow(sessionId: string, eventType: string): boolean {
  const cooldownMs = getViolationCooldownMs(eventType);
  if (cooldownMs <= 0) return true;
  const normalized = normalizeViolationEventType(eventType);
  const key = `${sessionId}:${normalized}`;
  const now = Date.now();
  const last = violationLastStoredAtMs.get(key) || 0;
  if (now - last < cooldownMs) {
    return false;
  }
  violationLastStoredAtMs.set(key, now);
  return true;
}

async function emitSecondaryMonitorViolation(
  sessionId: string,
  attemptId: string,
  testId: string,
  monitorCount: number
): Promise<void> {
  const violation: ViolationEvent = {
    eventType: 'secondary_monitor_detected',
    severity: 'critical',
    confidence: 100,
    description: `Secondary monitor detected. Total monitors: ${monitorCount}`,
    metadata: { monitorCount },
  };

  const result = await storeViolation(sessionId, violation);
  if (!result.success) {
    proctorTrace('secondary_monitor_store_failed', {
      sessionId,
      attemptId,
      monitorCount,
      error: result.error,
    });
    return;
  }

  emitToProctorTargets(testId, attemptId, 'violation-detected', {
    attemptId,
    testId,
    sessionId,
    violation: {
      type: violation.eventType,
      severity: violation.severity,
      confidence: violation.confidence,
      description: violation.description,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Initialize proctoring session for a test attempt
 */
export const initializeSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { attemptId } = req.params;
    const {
      cameraEnabled,
      microphoneEnabled,
      screenShareEnabled,
      browserInfo,
      screenResolution,
      deviceFingerprint,
      monitorCount,
    } = req.body;
    const effectiveMicrophoneEnabled = TEMP_DISABLE_AUDIO_PROCTORING ? false : microphoneEnabled;

    // Verify attempt exists and belongs to candidate
    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: {
          select: {
            proctorEnabled: true,
            requireCamera: true,
            requireMicrophone: true,
            requireScreenShare: true,
          },
        },
      },
    });

    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    // Check if session already exists
    const existingSession = await prisma.proctorSession.findUnique({
      where: { attemptId },
      select: { id: true, monitorCount: true, sessionMetadata: true },
    });

    if (existingSession) {
      // Update existing session
      const normalizedMonitorCount = Math.max(1, Number(monitorCount) || 1);
      const metadataPatch = {
        cameraEnabled,
        microphoneEnabled: effectiveMicrophoneEnabled,
        screenShareEnabled,
        browserInfo: browserInfo || null,
        screenResolution,
        deviceFingerprint,
        monitorCount: normalizedMonitorCount,
        externalMonitorDetected: normalizedMonitorCount > 1,
        ipAddress: req.ip,
        sessionUpdatedAt: new Date().toISOString(),
      };
      const session = await prisma.proctorSession.update({
        where: { id: existingSession.id },
        data: {
          cameraEnabled,
          microphoneEnabled: effectiveMicrophoneEnabled,
          screenShareEnabled,
          browserInfo: browserInfo ? JSON.stringify(browserInfo) : null,
          screenResolution,
          deviceFingerprint,
          monitorCount: normalizedMonitorCount,
          externalMonitorDetected: normalizedMonitorCount > 1,
          ipAddress: req.ip,
          sessionMetadata: mergeSessionMetadata(existingSession.sessionMetadata, metadataPatch),
        },
      });

      if (normalizedMonitorCount > 1 && (existingSession.monitorCount || 1) <= 1) {
        await emitSecondaryMonitorViolation(session.id, attemptId, attempt.testId, normalizedMonitorCount);
      }

      res.json({
        success: true,
        sessionId: session.id,
        requirements: {
          camera: attempt.test.requireCamera,
          microphone: TEMP_DISABLE_AUDIO_PROCTORING ? false : attempt.test.requireMicrophone,
          screenShare: attempt.test.requireScreenShare,
        },
      });

      emitToProctorTargets(attempt.testId, attemptId, 'candidate-status', {
        attemptId,
        testId: attempt.testId,
        sessionId: session.id,
        status: {
          online: true,
          cameraEnabled: session.cameraEnabled,
          microphoneEnabled: session.microphoneEnabled,
          screenShareEnabled: session.screenShareEnabled,
          monitorCount: session.monitorCount,
          faceDetected: true,
          lookingAtScreen: true,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Create new proctoring session
    const normalizedMonitorCount = Math.max(1, Number(monitorCount) || 1);
    const metadataPatch = {
      cameraEnabled,
      microphoneEnabled: effectiveMicrophoneEnabled,
      screenShareEnabled,
      browserInfo: browserInfo || null,
      screenResolution,
      deviceFingerprint,
      monitorCount: normalizedMonitorCount,
      externalMonitorDetected: normalizedMonitorCount > 1,
      ipAddress: req.ip,
      sessionStartedAt: new Date().toISOString(),
    };
    const session = await prisma.proctorSession.create({
      data: {
        attemptId,
        cameraEnabled,
        microphoneEnabled: effectiveMicrophoneEnabled,
        screenShareEnabled,
        browserInfo: browserInfo ? JSON.stringify(browserInfo) : null,
        screenResolution,
        deviceFingerprint,
        monitorCount: normalizedMonitorCount,
        externalMonitorDetected: normalizedMonitorCount > 1,
        ipAddress: req.ip,
        sessionMetadata: metadataPatch,
      },
    });

    if (normalizedMonitorCount > 1) {
      await emitSecondaryMonitorViolation(session.id, attemptId, attempt.testId, normalizedMonitorCount);
    }

    res.status(201).json({
      success: true,
      sessionId: session.id,
      requirements: {
        camera: attempt.test.requireCamera,
        microphone: TEMP_DISABLE_AUDIO_PROCTORING ? false : attempt.test.requireMicrophone,
        screenShare: attempt.test.requireScreenShare,
      },
    });

    emitToProctorTargets(attempt.testId, attemptId, 'candidate-status', {
      attemptId,
      testId: attempt.testId,
      sessionId: session.id,
      status: {
        online: true,
        cameraEnabled: session.cameraEnabled,
        microphoneEnabled: session.microphoneEnabled,
        screenShareEnabled: session.screenShareEnabled,
        monitorCount: session.monitorCount,
        faceDetected: true,
        lookingAtScreen: true,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error initializing proctoring session:', error);
    res.status(500).json({ error: 'Failed to initialize proctoring session' });
  }
};

/**
 * Submit proctoring analysis data for processing
 */
export const submitAnalysis = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const analysisData: ProctoringAnalysis = req.body;
    cacheEvidenceFrame(sessionId, analysisData.frameData);
    proctorTrace('submit_analysis_in', {
      sessionId,
      hasFrame: !!analysisData.frameData,
      frameLength: analysisData.frameData?.length || 0,
      faceDetected: analysisData.face?.faceDetected ?? null,
      faceCount: analysisData.face?.faceCount ?? null,
      gazeDirection: analysisData.gaze?.gazeDirection ?? null,
      lookingAtScreen: analysisData.gaze?.isLookingAtScreen ?? null,
      audioLevel: analysisData.audio?.audioLevel ?? null,
      suspiciousAudio: analysisData.audio?.suspiciousSound ?? null,
      hasVoice: analysisData.audio?.hasVoice ?? null,
      monitorCount: analysisData.screenInfo?.monitorCount ?? null,
      isFullscreen: analysisData.screenInfo?.isFullscreen ?? null,
      tabVisible: analysisData.screenInfo?.tabVisible ?? null,
      objectCount: analysisData.objects?.objects?.length ?? 0,
      phoneDetected: analysisData.objects?.phoneDetected ?? null,
      secondScreenDetected: analysisData.objects?.secondScreenDetected ?? null,
    });

    if (activeAnalysisRequests >= PROCTOR_MAX_CONCURRENT_ANALYSIS) {
      res.json({
        success: true,
        violations: [],
        totalViolations: 0,
        maxViolations: 0,
        shouldTerminate: false,
        isFlagged: false,
        overloaded: true,
      });
      return;
    }
    activeAnalysisRequests += 1;

    try {

      // Verify session exists
      const session = await prisma.proctorSession.findUnique({
        where: { id: sessionId },
        select: { id: true, attemptId: true },
      });

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

    // Server-side rate limit: if the last analysis for this session was processed
    // less than PROCTOR_SESSION_MIN_INTERVAL_MS ago, return early with an empty
    // result. This caps Python CV load at ~50 req/s for 200 concurrent candidates
    // instead of 100 req/s, without any loss of proctoring coverage.
    const nowMs = Date.now();
    const lastAnalysisMs = sessionAnalysisLastMs.get(sessionId) || 0;
    if (nowMs - lastAnalysisMs < PROCTOR_SESSION_MIN_INTERVAL_MS) {
      res.json({ success: true, violations: [], totalViolations: 0, maxViolations: 0, shouldTerminate: false, isFlagged: false });
      return;
    }
    sessionAnalysisLastMs.set(sessionId, nowMs);

    const telemetryPayload = stripLargeFields({
      ...analysisData,
      attemptId: session.attemptId,
      receivedAt: new Date().toISOString(),
    });
    void storeTelemetry(sessionId, 'analysis', telemetryPayload);

    // Analyze proctoring data for violations
    const violations = analyzeProctoring(analysisData);
    let pythonResult: Awaited<ReturnType<typeof analyzeFrameWithPythonForSession>> = null;
    proctorTrace('local_analysis', {
      sessionId,
      localViolationCount: violations.length,
      localViolationTypes: violations.map(v => v.eventType),
    });

    // Optional Python CV service violations (OpenCV/YOLO) when configured
    if (analysisData.frameData) {
      pythonResult = await analyzeFrameWithPythonForSession(analysisData.frameData, sessionId);
      proctorTrace('python_cv_result', {
        sessionId,
        hasResult: !!pythonResult,
        pythonViolationCount: pythonResult?.violations?.length || 0,
        pythonViolationTypes: pythonResult?.violations?.map(v => v.eventType) || [],
        pythonFaceDetected: pythonResult?.face?.detected ?? null,
        pythonFaceCount: pythonResult?.face?.count ?? null,
        pythonObjectCount: pythonResult?.objects?.length || 0,
        aiTraceId: pythonResult?.aiMeta?.traceId ?? null,
        aiSource: pythonResult?.aiMeta?.source ?? null,
        aiLatencyMs: pythonResult?.aiMeta?.latencyMs ?? null,
        aiStale: pythonResult?.aiMeta?.stale ?? null,
      });
      if (pythonResult?.violations?.length) {
        for (const pyViolation of pythonResult.violations) {
          proctorTrace('python_violation_trigger', {
            sessionId,
            eventType: pyViolation.eventType,
            severity: pyViolation.severity,
            confidence: pyViolation.confidence,
            aiTraceId: pythonResult?.aiMeta?.traceId ?? null,
          });
          violations.push({
            eventType: pyViolation.eventType,
            severity: pyViolation.severity,
            confidence: pyViolation.confidence,
            description: pyViolation.description,
            metadata: {
              ...(pyViolation.metadata || {}),
              aiTraceId: pythonResult?.aiMeta?.traceId,
              aiSource: pythonResult?.aiMeta?.source,
            },
            snapshotData: shouldAttachSnapshotEvidence(pyViolation.eventType)
              ? analysisData.frameData
              : undefined,
          });
        }
      }
    }

    const dedupedByCycle = new Map<string, ViolationEvent>();
    for (const violation of violations) {
      const normalizedType = normalizeViolationEventType(violation.eventType);
      const normalizedViolation: ViolationEvent = {
        ...violation,
        eventType: normalizedType,
        severity: applyMatrixSeverity(normalizedType, normalizeSeverity(violation.severity)),
      };
      const key = `${normalizedViolation.eventType}|${normalizedViolation.description}`;
      const existing = dedupedByCycle.get(key);
      if (!existing || existing.confidence < normalizedViolation.confidence) {
        dedupedByCycle.set(key, normalizedViolation);
      }
    }
    const normalizedViolations = Array.from(dedupedByCycle.values());
    const allowedViolations = normalizedViolations.filter(v => isAllowedEvent(v.eventType));
    const droppedViolationTypes = normalizedViolations
      .filter(v => !isAllowedEvent(v.eventType))
      .map(v => v.eventType);
    if (droppedViolationTypes.length > 0) {
      proctorTrace('violations_dropped_by_allowlist', {
        sessionId,
        droppedViolationTypes,
        allowedEvents: Array.from(PROCTOR_ALLOWED_EVENTS),
      });
    }

    // Attach evidence frame for any analysis-cycle violation that lacks snapshot.
    // Prefer current frame; fallback to a recent cached frame for this session.
    const cachedEvidence = analysisData.frameData ? null : getRecentEvidenceFrame(sessionId);
    const evidenceFrame = analysisData.frameData || cachedEvidence?.frameData;
    const evidenceSource = analysisData.frameData
      ? 'current_frame'
      : cachedEvidence
      ? 'cached_recent_frame'
      : null;
    if (evidenceFrame) {
      for (const violation of allowedViolations) {
        if (!violation.snapshotData && shouldAttachSnapshotEvidence(violation.eventType)) {
          violation.snapshotData = evidenceFrame;
          violation.metadata = {
            ...(violation.metadata || {}),
            snapshotEvidenceSource: evidenceSource,
          };
        }
      }
    }

    // Store any detected violations
    const storedViolations = [];
    for (const violation of allowedViolations) {
      if (!canStoreViolationNow(sessionId, violation.eventType)) {
        proctorTrace('violation_cooldown_suppressed', {
          sessionId,
          eventType: violation.eventType,
          cooldownMs: getViolationCooldownMs(violation.eventType),
        });
        continue;
      }
      const result = await storeViolation(sessionId, violation);
      if (result.success) {
        storedViolations.push({ ...violation, id: result.eventId });
      }
    }
    proctorTrace('stored_violations', {
      sessionId,
      inputViolationCount: allowedViolations.length,
      storedViolationCount: storedViolations.length,
      storedViolationTypes: storedViolations.map(v => v.eventType),
    });

    // Check if attempt should be auto-flagged or terminated
    const attempt = await prisma.testAttempt.findUnique({
      where: { id: session.attemptId },
      include: {
        test: { select: { maxViolations: true } },
      },
    });

    const criticalViolationDetected = storedViolations.some(v => v.severity === 'critical');
    const shouldFlag = PROCTOR_AUTO_FLAG_ON_CRITICAL && criticalViolationDetected;
    const shouldTerminate = attempt && attempt.violations >= attempt.test.maxViolations;

    if (attempt) {
      emitToProctorTargets(attempt.testId, session.attemptId, 'candidate-status', {
        attemptId: session.attemptId,
        testId: attempt.testId,
        sessionId,
        status: {
          online: true,
          cameraEnabled: analysisData.face !== undefined,
          microphoneEnabled: analysisData.audio !== undefined,
          screenShareEnabled: true,
          faceDetected: pythonResult?.face?.detected ?? analysisData.face?.faceDetected ?? true,
          lookingAtScreen: pythonResult?.face?.lookingAtScreen ?? analysisData.gaze?.isLookingAtScreen ?? true,
          cameraBlocked: pythonResult?.face?.cameraBlocked ?? false,
          monitorCount: analysisData.screenInfo?.monitorCount ?? 1,
        },
        timestamp: new Date().toISOString(),
      });
    }

    if (attempt) {
      for (const violation of storedViolations) {
        emitToProctorTargets(attempt.testId, session.attemptId, 'violation-detected', {
          attemptId: session.attemptId,
          testId: attempt.testId,
          sessionId,
          violation: {
            type: violation.eventType,
            severity: violation.severity,
            confidence: violation.confidence,
            description: violation.description,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    if (shouldFlag && attempt && !attempt.isFlagged) {
      await prisma.testAttempt.update({
        where: { id: session.attemptId },
        data: {
          isFlagged: true,
          flagReason: 'Auto-flagged due to critical proctoring violation',
        },
      });
    }

      res.json({
        success: true,
        violations: storedViolations,
        totalViolations: attempt?.violations || 0,
        maxViolations: attempt?.test.maxViolations || 3,
        shouldTerminate,
        isFlagged: !!attempt?.isFlagged || shouldFlag,
      });
      proctorTrace('submit_analysis_out', {
        sessionId,
        returnedViolationCount: storedViolations.length,
        returnedViolationTypes: storedViolations.map(v => v.eventType),
        shouldTerminate,
        isFlagged: shouldFlag || attempt?.isFlagged,
      });
    } finally {
      activeAnalysisRequests = Math.max(0, activeAnalysisRequests - 1);
    }
  } catch (error) {
    console.error('Error submitting analysis:', error);
    proctorTrace('submit_analysis_error', {
      sessionId: req.params.sessionId,
      message: error instanceof Error ? error.message : 'unknown',
    });
    res.status(500).json({ error: 'Failed to process analysis' });
  }
};

/**
 * Report a specific violation event
 */
export const reportViolation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const normalizedEventType = normalizeViolationEventType(req.body?.eventType || '');
    const violation: ViolationEvent = {
      ...req.body,
      eventType: normalizedEventType,
      severity: applyMatrixSeverity(normalizedEventType, normalizeSeverity(req.body?.severity)),
    };
    if (typeof violation.snapshotData === 'string' && shouldAttachSnapshotEvidence(violation.eventType)) {
      cacheEvidenceFrame(sessionId, violation.snapshotData);
    } else if (!shouldAttachSnapshotEvidence(violation.eventType)) {
      violation.snapshotData = undefined;
    } else if (shouldAttachSnapshotEvidence(violation.eventType)) {
      const cachedEvidence = getRecentEvidenceFrame(sessionId);
      if (cachedEvidence?.frameData) {
        violation.snapshotData = cachedEvidence.frameData;
        violation.metadata = {
          ...(violation.metadata || {}),
          snapshotEvidenceSource: 'cached_recent_frame',
        };
      }
    }
    if (!isAllowedEvent(violation.eventType)) {
      proctorTrace('report_violation_ignored', {
        sessionId,
        eventType: violation.eventType,
        allowedEvents: Array.from(PROCTOR_ALLOWED_EVENTS),
      });
      res.json({
        success: true,
        ignored: true,
        reason: 'event_not_allowed',
      });
      return;
    }
    proctorTrace('report_violation_in', {
      sessionId,
      eventType: violation.eventType,
      severity: violation.severity,
      confidence: violation.confidence,
      hasSnapshot: !!violation.snapshotData,
      hasAudioClip: !!violation.audioClipData,
    });

    if (!canStoreViolationNow(sessionId, violation.eventType)) {
      const cooldownMs = getViolationCooldownMs(violation.eventType);
      proctorTrace('report_violation_cooldown_suppressed', {
        sessionId,
        eventType: violation.eventType,
        cooldownMs,
      });
      res.json({
        success: true,
        ignored: true,
        reason: 'cooldown',
        eventType: violation.eventType,
        cooldownMs,
      });
      return;
    }

    void storeTelemetry(
      sessionId,
      'violation_report',
      stripLargeFields({
        ...violation,
        receivedAt: new Date().toISOString(),
      })
    );

    const result = await storeViolation(sessionId, violation);

    if (!result.success) {
      res.status(500).json({ error: result.error });
      return;
    }

    const proctorSession = await prisma.proctorSession.findUnique({
      where: { id: sessionId },
      include: {
        attempt: {
          include: {
            test: {
              select: { maxViolations: true },
            },
          },
        },
      },
    });

    const totalViolations = proctorSession?.attempt.violations ?? 0;
    const maxViolations = proctorSession?.attempt.test.maxViolations ?? 3;
    const shouldTerminate = totalViolations >= maxViolations;

    res.json({
      success: true,
      eventId: result.eventId,
      totalViolations,
      maxViolations,
      shouldTerminate,
    });
    proctorTrace('report_violation_out', {
      sessionId,
      eventId: result.eventId,
      totalViolations,
      maxViolations,
      shouldTerminate,
    });

    if (proctorSession) {
      emitToProctorTargets(proctorSession.attempt.testId, proctorSession.attemptId, 'violation-detected', {
        attemptId: proctorSession.attemptId,
        testId: proctorSession.attempt.testId,
        sessionId,
        violation: {
          type: violation.eventType,
          severity: violation.severity,
          confidence: violation.confidence,
          description: violation.description,
          timestamp: new Date().toISOString(),
        },
      });
    }
  } catch (error) {
    console.error('Error reporting violation:', error);
    res.status(500).json({ error: 'Failed to report violation' });
  }
};

/**
 * Ingest violation events from an external AI detector service/script.
 * Accepts both:
 *  - /session/:sessionId/engine-event
 *  - /engine/event with sessionId in body
 */
export const ingestExternalEngineEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const headerApiKey =
      (req.headers['x-ai-key'] as string | undefined) ||
      (req.headers['x-api-key'] as string | undefined) ||
      '';
    if (PROCTOR_ENGINE_API_KEY && headerApiKey !== PROCTOR_ENGINE_API_KEY) {
      res.status(401).json({ error: 'Invalid external AI engine key' });
      return;
    }

    const sessionId = (req.params.sessionId || req.body?.sessionId || '').toString().trim();
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    const rawType = (req.body?.type || req.body?.eventType || '').toString().trim().toUpperCase();
    if (!rawType) {
      res.status(400).json({ error: 'event type is required' });
      return;
    }

    const mappedEventType = normalizeViolationEventType(
      EXTERNAL_EVENT_MAP[rawType] || rawType.toLowerCase()
    );
    if (!isAllowedEvent(mappedEventType)) {
      proctorTrace('external_event_ignored', {
        sessionId,
        rawType,
        mappedEventType,
        reason: 'not_in_allowlist',
      });
      res.json({ success: true, ignored: true, reason: 'event_not_allowed' });
      return;
    }

    const rawConfidence = Number(req.body?.confidence ?? 0.8);
    const confidence = Math.max(0, Math.min(100, rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence));
    const duration = Math.max(0, Number(req.body?.duration ?? 0));
    const description =
      (req.body?.description || `${rawType} detected by external AI engine`).toString().trim();

    const violation: ViolationEvent = {
      eventType: mappedEventType,
      severity: applyMatrixSeverity(
        mappedEventType,
        EXTERNAL_SEVERITY_MAP[mappedEventType] || 'medium'
      ),
      confidence,
      description,
      duration,
      metadata: {
        source: 'external_ai_engine',
        rawType,
        risk: req.body?.risk,
        integrity: req.body?.integrity,
        timestamp: req.body?.timestamp,
      },
      snapshotData: req.body?.snapshotData,
    };
    if (typeof violation.snapshotData === 'string' && shouldAttachSnapshotEvidence(violation.eventType)) {
      cacheEvidenceFrame(sessionId, violation.snapshotData);
    } else if (!shouldAttachSnapshotEvidence(violation.eventType)) {
      violation.snapshotData = undefined;
    } else if (shouldAttachSnapshotEvidence(violation.eventType)) {
      const cachedEvidence = getRecentEvidenceFrame(sessionId);
      if (cachedEvidence?.frameData) {
        violation.snapshotData = cachedEvidence.frameData;
        violation.metadata = {
          ...(violation.metadata || {}),
          snapshotEvidenceSource: 'cached_recent_frame',
        };
      }
    }

    proctorTrace('external_event_in', {
      sessionId,
      rawType,
      mappedEventType,
      confidence,
      duration,
    });

    if (!canStoreViolationNow(sessionId, violation.eventType)) {
      const cooldownMs = getViolationCooldownMs(violation.eventType);
      proctorTrace('external_event_cooldown_suppressed', {
        sessionId,
        mappedEventType,
        cooldownMs,
      });
      res.json({
        success: true,
        ignored: true,
        reason: 'cooldown',
        mappedEventType,
        cooldownMs,
      });
      return;
    }

    void storeTelemetry(
      sessionId,
      'engine_event',
      stripLargeFields({
        ...req.body,
        mappedEventType,
        normalizedSeverity: violation.severity,
        receivedAt: new Date().toISOString(),
      })
    );

    const result = await storeViolation(sessionId, violation);
    if (!result.success) {
      res.status(500).json({ error: result.error });
      return;
    }

    const proctorSession = await prisma.proctorSession.findUnique({
      where: { id: sessionId },
      include: {
        attempt: {
          include: {
            test: {
              select: { maxViolations: true },
            },
          },
        },
      },
    });

    const totalViolations = proctorSession?.attempt.violations ?? 0;
    const maxViolations = proctorSession?.attempt.test.maxViolations ?? 3;
    const shouldTerminate = totalViolations >= maxViolations;

    if (proctorSession) {
      emitToProctorTargets(proctorSession.attempt.testId, proctorSession.attemptId, 'violation-detected', {
        attemptId: proctorSession.attemptId,
        testId: proctorSession.attempt.testId,
        sessionId,
        violation: {
          type: violation.eventType,
          severity: violation.severity,
          confidence: violation.confidence,
          description: violation.description,
          timestamp: new Date().toISOString(),
        },
      });
    }

    proctorTrace('external_event_out', {
      sessionId,
      mappedEventType,
      eventId: result.eventId,
      totalViolations,
      maxViolations,
      shouldTerminate,
    });

    res.json({
      success: true,
      eventId: result.eventId,
      mappedEventType,
      totalViolations,
      maxViolations,
      shouldTerminate,
    });
  } catch (error) {
    console.error('Error ingesting external AI event:', error);
    res.status(500).json({ error: 'Failed to ingest external AI event' });
  }
};

/**
 * Upload face snapshot for verification or periodic check
 */
export const uploadFaceSnapshot = async (req: Request, res: Response): Promise<void> => {
  try {
    if (Date.now() < snapshotUploadCircuitOpenUntil) {
      res.status(503).json({ error: 'Snapshot storage temporarily unavailable. Retry shortly.' });
      return;
    }

    const { sessionId } = req.params;
    const { imageData, purpose, analysisResult } = req.body;

    if (!imageData) {
      res.status(400).json({ error: 'Image data is required' });
      return;
    }

    const result = await storeFaceSnapshot(
      sessionId,
      imageData,
      purpose || 'periodic_check',
      analysisResult
    );

    if (!result.success) {
      res.status(500).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      snapshotId: result.snapshotId,
    });
    snapshotUploadFailureCount = 0;
    snapshotUploadCircuitOpenUntil = 0;
  } catch (error) {
    snapshotUploadFailureCount += 1;
    if (snapshotUploadFailureCount >= 3) {
      snapshotUploadCircuitOpenUntil = Date.now() + 60000;
    }
    console.error('Error uploading face snapshot:', error);
    res.status(500).json({ error: 'Failed to upload snapshot' });
  }
};

/**
 * Get pre-signed URL for uploading recording chunk
 */
export const getRecordingUploadUrl = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const { recordingType, mimeType, chunkIndex } = req.body;

    const session = await prisma.proctorSession.findUnique({
      where: { id: sessionId },
      select: { attemptId: true },
    });

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const timestamp = Date.now();
    const ext = mimeType?.includes('video') ? '.webm' : '.wav';
    const key = `proctoring/recordings/${session.attemptId}/${recordingType}-${timestamp}-${chunkIndex || 0}${ext}`;

    // With PostgreSQL storage, return server upload endpoint
    res.json({
      success: true,
      uploadUrl: `/api/proctoring/${sessionId}/recording/upload`,
      fileUrl: `/api/files/${key}`,
      key,
    });
  } catch (error) {
    console.error('Error getting upload URL:', error);
    res.status(500).json({ error: 'Failed to get upload URL' });
  }
};

/**
 * Finalize recording and create database record
 */
export const finalizeRecording = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const {
      recordingType,
      storageUrl,
      storageKey,
      startTime,
      endTime,
      duration,
      fileSize,
      mimeType,
    } = req.body;

    const session = await prisma.proctorSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const recording = await prisma.proctorRecording.create({
      data: {
        sessionId,
        recordingType,
        storageUrl,
        storageKey,
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : null,
        duration,
        fileSize,
        mimeType,
        status: 'ready',
      },
    });

    res.json({
      success: true,
      recordingId: recording.id,
    });
  } catch (error) {
    console.error('Error finalizing recording:', error);
    res.status(500).json({ error: 'Failed to finalize recording' });
  }
};

/**
 * Upload a recording chunk and persist as playable recording file.
 * Each chunk is stored independently to avoid large-memory uploads.
 */
export const uploadRecordingChunk = async (req: Request, res: Response): Promise<void> => {
  try {
    if (Date.now() < recordingUploadCircuitOpenUntil) {
      res.status(503).json({ error: 'Recording storage temporarily unavailable. Retry shortly.' });
      return;
    }
    if (activeRecordingUploads >= PROCTOR_MAX_CONCURRENT_RECORDING_UPLOADS) {
      // Prefer dropping recording chunks over overloading core proctoring APIs.
      res.status(202).json({ success: true, skipped: true, reason: 'overloaded' });
      return;
    }
    activeRecordingUploads += 1;

    try {
      const { sessionId } = req.params;
      const {
        recordingType,
        chunkData,
        mimeType,
        chunkIndex,
        startTime,
        endTime,
        duration,
        fileSize,
      } = req.body;

      if (!chunkData || !recordingType || !mimeType) {
        res.status(400).json({ error: 'recordingType, chunkData and mimeType are required' });
        return;
      }

    const session = await prisma.proctorSession.findUnique({
      where: { id: sessionId },
      select: { attemptId: true },
    });

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const buffer = Buffer.from(chunkData, 'base64');
    if (buffer.length > 12 * 1024 * 1024) {
      res.status(413).json({ error: 'Recording chunk too large. Reduce chunk size/quality.' });
      return;
    }

    const upload = await uploadRecording(
      buffer,
      session.attemptId,
      recordingType,
      mimeType
    );

    if (!upload.success || !upload.url) {
      res.status(500).json({ error: upload.error || 'Failed to store recording chunk' });
      return;
    }

    const now = new Date();
    const recording = await prisma.proctorRecording.create({
      data: {
        sessionId,
        recordingType: `${recordingType}_chunk`,
        storageUrl: upload.url,
        storageKey: upload.key,
        startTime: startTime ? new Date(startTime) : now,
        endTime: endTime ? new Date(endTime) : now,
        duration: duration || null,
        fileSize: fileSize || buffer.length,
        mimeType,
        status: 'ready',
      },
    });

      res.json({
        success: true,
        recordingId: recording.id,
        chunkIndex: chunkIndex ?? 0,
        storageUrl: upload.url,
      });
      recordingUploadFailureCount = 0;
      recordingUploadCircuitOpenUntil = 0;
    } finally {
      activeRecordingUploads = Math.max(0, activeRecordingUploads - 1);
    }
  } catch (error) {
    recordingUploadFailureCount += 1;
    if (recordingUploadFailureCount >= 3) {
      recordingUploadCircuitOpenUntil = Date.now() + 60000;
    }
    console.error('Error uploading recording chunk:', error);
    res.status(500).json({ error: 'Failed to upload recording chunk' });
  }
};

/**
 * End proctoring session
 */
export const endSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    evidenceFrameBySession.delete(sessionId);

    const session = await prisma.proctorSession.update({
      where: { id: sessionId },
      data: { endedAt: new Date() },
    });

    // Generate proctoring summary
    const summary = await generateProctoringSummary(session.attemptId);

    // Store summary in analytics
    await prisma.performanceAnalytics.upsert({
      where: { attemptId: session.attemptId },
      create: {
        attemptId: session.attemptId,
        totalScore: 0,
        totalTimeTaken: 0,
        proctoringSummary: JSON.stringify(summary),
        trustScore: summary.trustScore,
      },
      update: {
        proctoringSummary: JSON.stringify(summary),
        trustScore: summary.trustScore,
      },
    });

    // Auto-flag if recommended
    if (summary.flagRecommendation) {
      await prisma.testAttempt.update({
        where: { id: session.attemptId },
        data: {
          isFlagged: true,
          flagReason: `Auto-flagged: Trust score ${summary.trustScore.toFixed(1)}%, ${summary.totalViolations} violations`,
        },
      });
    }

    res.json({
      success: true,
      summary,
    });

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: session.attemptId },
      select: { testId: true },
    });
    if (attempt) {
      emitToProctorTargets(attempt.testId, session.attemptId, 'candidate-status', {
        attemptId: session.attemptId,
        testId: attempt.testId,
        sessionId,
        status: {
          online: false,
          cameraEnabled: false,
          microphoneEnabled: false,
          screenShareEnabled: false,
          faceDetected: false,
          lookingAtScreen: false,
        },
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
};

/**
 * Get proctoring session details (for admin)
 */
export const getSessionDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;

    const session = await prisma.proctorSession.findUnique({
      where: { id: sessionId },
      include: {
        attempt: {
          include: {
            candidate: { select: { id: true, name: true, email: true } },
            test: { select: { id: true, name: true } },
          },
        },
        events: {
          orderBy: { timestamp: 'desc' },
        },
        recordings: {
          orderBy: { startTime: 'asc' },
        },
        faceSnapshots: {
          orderBy: { capturedAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const trustScore = await calculateTrustScore(sessionId);

    res.json({
      success: true,
      session: {
        ...session,
        trustScore,
      },
    });
  } catch (error) {
    console.error('Error getting session details:', error);
    res.status(500).json({ error: 'Failed to get session details' });
  }
};

/**
 * Get all proctoring events for a session (for admin)
 */
export const getSessionEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const { severity, eventType, reviewed } = req.query;

    const where: any = { sessionId };

    if (severity) {
      where.severity = severity;
    }
    if (eventType) {
      where.eventType = eventType;
    }
    if (reviewed !== undefined) {
      where.reviewed = reviewed === 'true';
    }

    const events = await prisma.proctorEvent.findMany({
      where,
      orderBy: { timestamp: 'desc' },
    });

    res.json({
      success: true,
      events,
    });
  } catch (error) {
    console.error('Error getting session events:', error);
    res.status(500).json({ error: 'Failed to get events' });
  }
};

/**
 * Review/dismiss proctoring event (for admin)
 */
export const reviewEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { eventId } = req.params;
    const { dismissed, reviewNotes } = req.body;
    const adminId = (req as any).admin?.id;

    const event = await prisma.proctorEvent.update({
      where: { id: eventId },
      data: {
        reviewed: true,
        reviewedAt: new Date(),
        reviewedBy: adminId,
        dismissed: dismissed || false,
        reviewNotes,
      },
    });

    // If dismissed, recalculate trust score
    if (dismissed) {
      const session = await prisma.proctorSession.findFirst({
        where: { events: { some: { id: eventId } } },
      });

      if (session) {
        const newTrustScore = await calculateTrustScore(session.id);
        await prisma.performanceAnalytics.update({
          where: { attemptId: session.attemptId },
          data: { trustScore: newTrustScore },
        });
      }
    }

    res.json({
      success: true,
      event,
    });
  } catch (error) {
    console.error('Error reviewing event:', error);
    res.status(500).json({ error: 'Failed to review event' });
  }
};

/**
 * Get recordings for a session (for admin)
 */
export const getSessionRecordings = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;

    const recordings = await prisma.proctorRecording.findMany({
      where: { sessionId },
      include: {
        violationClips: true,
      },
      orderBy: { startTime: 'asc' },
    });

    res.json({
      success: true,
      recordings,
    });
  } catch (error) {
    console.error('Error getting recordings:', error);
    res.status(500).json({ error: 'Failed to get recordings' });
  }
};

/**
 * Get proctoring summary for an attempt
 */
export const getAttemptProctoringSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { attemptId } = req.params;

    const summary = await generateProctoringSummary(attemptId);

    const session = await prisma.proctorSession.findUnique({
      where: { attemptId },
      select: {
        id: true,
        cameraEnabled: true,
        microphoneEnabled: true,
        screenShareEnabled: true,
        monitorCount: true,
        externalMonitorDetected: true,
        faceVerified: true,
        startedAt: true,
        endedAt: true,
      },
    });

    res.json({
      success: true,
      summary,
      sessionInfo: session,
    });
  } catch (error) {
    console.error('Error getting proctoring summary:', error);
    res.status(500).json({ error: 'Failed to get summary' });
  }
};

/**
 * Update device pairing for mobile proctoring
 */
export const updateMobileDevice = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const { mobileDeviceId, verified } = req.body;

    const existingSession = await prisma.proctorSession.findUnique({
      where: { id: sessionId },
      select: { sessionMetadata: true },
    });
    if (!existingSession) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const metadataPatch = {
      mobileDeviceId,
      mobileVerified: verified || false,
      mobileUpdatedAt: new Date().toISOString(),
    };

    const session = await prisma.proctorSession.update({
      where: { id: sessionId },
      data: {
        mobileDeviceId,
        mobileVerified: verified || false,
        sessionMetadata: mergeSessionMetadata(existingSession.sessionMetadata, metadataPatch),
      },
    });

    res.json({
      success: true,
      session: {
        mobileDeviceId: session.mobileDeviceId,
        mobileVerified: session.mobileVerified,
      },
    });
  } catch (error) {
    console.error('Error updating mobile device:', error);
    res.status(500).json({ error: 'Failed to update mobile device' });
  }
};

/**
 * Update monitor count (called when external monitor detected)
 */
export const updateMonitorCount = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const parsedMonitorCount = Math.max(1, Number(req.body?.monitorCount) || 1);

    const existingSession = await prisma.proctorSession.findUnique({
      where: { id: sessionId },
      select: { attemptId: true, monitorCount: true, sessionMetadata: true },
    });
    if (!existingSession) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const previousMonitorCount = existingSession.monitorCount || 1;
    const metadataPatch = {
      monitorCount: parsedMonitorCount,
      externalMonitorDetected: parsedMonitorCount > 1,
      monitorUpdatedAt: new Date().toISOString(),
    };

    const session = await prisma.proctorSession.update({
      where: { id: sessionId },
      data: {
        monitorCount: parsedMonitorCount,
        externalMonitorDetected: parsedMonitorCount > 1,
        sessionMetadata: mergeSessionMetadata(existingSession.sessionMetadata, metadataPatch),
      },
    });

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: existingSession.attemptId },
      select: { testId: true },
    });

    // Trigger violation only when transitioning from single-monitor to multi-monitor.
    if (attempt && parsedMonitorCount > 1 && previousMonitorCount <= 1) {
      await emitSecondaryMonitorViolation(
        sessionId,
        existingSession.attemptId,
        attempt.testId,
        parsedMonitorCount
      );
    }

    res.json({
      success: true,
      monitorCount: session.monitorCount,
      externalMonitorDetected: session.externalMonitorDetected,
    });
    if (attempt) {
      emitToProctorTargets(attempt.testId, existingSession.attemptId, 'candidate-status', {
        attemptId: existingSession.attemptId,
        testId: attempt.testId,
        sessionId,
        status: {
          online: true,
          monitorCount: session.monitorCount,
          externalMonitorDetected: session.externalMonitorDetected,
        },
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('Error updating monitor count:', error);
    res.status(500).json({ error: 'Failed to update monitor count' });
  }
};

/**
 * Get live proctoring candidates for a test (admin dashboard)
 */
export const getLiveTestSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { testId } = req.params;
    const adminId = (req as any).admin?.id;

    const test = await prisma.test.findUnique({
      where: { id: testId },
      select: { adminId: true },
    });

    if (!test || test.adminId !== adminId) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const attempts = await prisma.testAttempt.findMany({
      where: {
        testId,
        status: 'in_progress',
      },
      select: {
        id: true,
        status: true,
        startTime: true,
        violations: true,
        isFlagged: true,
        candidate: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        analytics: {
          select: {
            trustScore: true,
          },
        },
        proctorSession: {
          include: {
            events: {
              orderBy: { timestamp: 'desc' },
              take: 1,
            },
            faceSnapshots: {
              orderBy: { capturedAt: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { startTime: 'desc' },
    });

    const now = Date.now();
    const liveCandidates = attempts.map(attempt => {
      const session = attempt.proctorSession;
      const latestEvent = session?.events?.[0];
      const latestSnapshot = session?.faceSnapshots?.[0];
      const latestEventTime = latestEvent ? new Date(latestEvent.timestamp).getTime() : 0;
      const latestSnapshotTime = latestSnapshot ? new Date(latestSnapshot.capturedAt).getTime() : 0;
      const sessionStartTime = session ? new Date(session.startedAt).getTime() : 0;
      const latestSignalTime = Math.max(latestEventTime, latestSnapshotTime, sessionStartTime);
      const online = !!session && !session.endedAt && now - latestSignalTime < 120000;

      return {
        sessionId: session?.id || '',
        attemptId: attempt.id,
        candidate: attempt.candidate,
        status: {
          online,
          cameraEnabled: session?.cameraEnabled || false,
          microphoneEnabled: session?.microphoneEnabled || false,
          screenShareEnabled: session?.screenShareEnabled || false,
          monitorCount: session?.monitorCount || 1,
          externalMonitorDetected: session?.externalMonitorDetected || false,
          faceVerified: session?.faceVerified || false,
        },
        violations: attempt.violations,
        isFlagged: attempt.isFlagged,
        trustScore: attempt.analytics?.trustScore ?? 100,
        livePreviewUrl: latestEvent?.snapshotUrl || latestSnapshot?.imageUrl || null,
        lastViolation: latestEvent
          ? {
              type: latestEvent.eventType,
              severity: latestEvent.severity,
              description: latestEvent.description,
              timestamp: latestEvent.timestamp,
            }
          : null,
      };
    });

    res.json({
      success: true,
      testId,
      total: liveCandidates.length,
      candidates: liveCandidates,
    });
  } catch (error) {
    console.error('Error getting live test sessions:', error);
    res.status(500).json({ error: 'Failed to fetch live sessions' });
  }
};
