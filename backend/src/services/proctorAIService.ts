/**
 * AI Proctoring Service
 *
 * This service handles AI-powered analysis of proctoring data including:
 * - Face detection and verification
 * - Gaze/eye tracking analysis
 * - Audio anomaly detection
 * - Object detection (phone, secondary screens)
 * - Behavior pattern analysis
 *
 * The actual AI processing happens client-side using TensorFlow.js models,
 * this service handles the backend analysis, storage, and decision making.
 */

import prisma from '../utils/db';
import { uploadSnapshot, uploadRecording } from './fileStorageService';

// Violation severity thresholds
const SEVERITY_THRESHOLDS = {
  critical: 0.9,
  high: 0.75,
  medium: 0.5,
  low: 0.3,
};

const AUDIO_WARNING_LEVEL = Number(process.env.AUDIO_WARNING_LEVEL || 42);
const AUDIO_CRITICAL_LEVEL = Number(process.env.AUDIO_CRITICAL_LEVEL || 58);
const AUDIO_VOICE_MIN_LEVEL = Number(process.env.AUDIO_VOICE_MIN_LEVEL || 16);
const TEMP_DISABLE_AUDIO_PROCTORING = true;
const NON_VIOLATION_EVENTS = new Set(['camera_resumed', 'tab_switch_resume', 'window_focus_return']);
// Low-priority AI violations: logged for trust score but do NOT count toward the violation limit
// phone_detected is intentionally excluded — it is high priority and counts as a real violation
const LOW_PRIORITY_EVENTS = new Set([
  'suspicious_audio',
  'unauthorized_object_detected',
  'eyes_closed_long',
  'rapid_typing',
  'unusual_mouse_movement',
]);
// Phone detection carries a 1.5× trust-score deduction multiplier on top of its critical severity
const PHONE_DEDUCTION_MULTIPLIER = 1.5;
const REPORT_EVENT_TYPES = new Set(
  [
    ...(
      process.env.PROCTOR_REPORT_EVENTS ||
      'tab_switch,window_blur,fullscreen_exit,copy_paste_attempt,camera_blocked,multiple_faces,phone_detected,face_not_detected,looking_away,voice_detected,secondary_monitor_detected'
    )
      .split(',')
      .map(v => v.trim().toLowerCase())
      .filter(Boolean),
    // Keep no-face violations in trust math even if env list is missing it.
    'face_not_detected',
  ]
);
const TRUST_EVENT_WEIGHT_MAP: Record<string, number> = {
  tab_switch: 3,
  window_blur: 3,
  fullscreen_exit: 2,
  copy_paste_attempt: 5,
  camera_blocked: 20,
  multiple_faces: 15,
  phone_detected: 20,
  face_not_detected: 15,
  looking_away: 1,
  voice_detected: 15,
  secondary_monitor_detected: 20,
};

// Violation types and their base severity
const VIOLATION_SEVERITY_MAP: Record<string, string> = {
  face_not_detected: 'critical',
  multiple_faces: 'critical',
  looking_away: 'high',
  camera_blocked: 'critical',
  camera_resumed: 'low',
  eyes_closed_long: 'low',
  phone_detected: 'critical',
  external_monitor: 'critical',
  secondary_monitor_detected: 'critical',
  suspicious_audio: 'low',
  voice_detected: 'critical',
  tab_switch: 'medium',
  screen_share_stopped: 'critical',
  copy_paste_attempt: 'medium',
  devtools_open: 'critical',
  fullscreen_exit: 'high',
  window_blur: 'medium',
  rapid_typing: 'low',
  unusual_mouse_movement: 'low',
};

export interface FaceDetectionResult {
  faceDetected: boolean;
  faceCount: number;
  confidence: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
  landmarks?: { leftEye: [number, number]; rightEye: [number, number]; nose: [number, number]; mouth: [number, number] };
}

export interface GazeTrackingResult {
  gazeDirection: 'center' | 'left' | 'right' | 'up' | 'down' | 'unknown';
  confidence: number;
  isLookingAtScreen: boolean;
  eyeOpenness?: { left: number; right: number };
}

export interface AudioAnalysisResult {
  hasVoice: boolean;
  voiceCount: number;
  confidence: number;
  backgroundNoise: boolean;
  suspiciousSound: boolean;
  audioLevel: number;
}

export interface ObjectDetectionResult {
  objects: Array<{
    type: string;
    confidence: number;
    boundingBox: { x: number; y: number; width: number; height: number };
  }>;
  phoneDetected: boolean;
  secondScreenDetected: boolean;
}

export interface ProctoringAnalysis {
  timestamp: number;
  frameData?: string; // Optional JPEG base64 frame for external CV services
  face?: FaceDetectionResult;
  gaze?: GazeTrackingResult;
  audio?: AudioAnalysisResult;
  objects?: ObjectDetectionResult;
  screenInfo?: {
    monitorCount: number;
    isFullscreen: boolean;
    tabVisible: boolean;
  };
}

export interface ViolationEvent {
  eventType: string;
  severity: string;
  confidence: number;
  description: string;
  duration?: number;
  metadata?: Record<string, any>;
  snapshotData?: string; // Base64 encoded image
  audioClipData?: string; // Base64 encoded audio
}

/**
 * Calculate severity based on violation type and confidence
 */
function calculateSeverity(eventType: string, confidence: number): string {
  const baseSeverity = VIOLATION_SEVERITY_MAP[eventType] || 'medium';

  // Adjust severity based on confidence
  if (confidence >= SEVERITY_THRESHOLDS.critical) {
    if (baseSeverity === 'critical') return 'critical';
    if (baseSeverity === 'high') return 'critical';
    return 'high';
  } else if (confidence >= SEVERITY_THRESHOLDS.high) {
    if (baseSeverity === 'critical') return 'critical';
    return baseSeverity;
  } else if (confidence >= SEVERITY_THRESHOLDS.medium) {
    if (baseSeverity === 'critical') return 'high';
    if (baseSeverity === 'high') return 'medium';
    return baseSeverity;
  }

  return 'low';
}

/**
 * Analyze proctoring data and detect violations
 */
export function analyzeProctoring(analysis: ProctoringAnalysis): ViolationEvent[] {
  const violations: ViolationEvent[] = [];

  // Face detection analysis
  if (analysis.face) {
    if (!analysis.face.faceDetected) {
      violations.push({
        eventType: 'face_not_detected',
        severity: 'critical',
        confidence: 0.9,
        description: 'No face detected in camera frame',
        metadata: { faceCount: 0 },
      });
    } else if (analysis.face.faceCount > 1) {
      violations.push({
        eventType: 'multiple_faces',
        severity: 'critical',
        confidence: analysis.face.confidence,
        description: `Multiple faces detected (${analysis.face.faceCount} faces)`,
        metadata: { faceCount: analysis.face.faceCount },
      });
    }
  }

  // Gaze tracking analysis
  if (analysis.gaze) {
    if (!analysis.gaze.isLookingAtScreen && analysis.gaze.confidence > 0.5) {
      violations.push({
        eventType: 'looking_away',
        severity: 'high',
        confidence: analysis.gaze.confidence,
        description: `Candidate looking ${analysis.gaze.gazeDirection}`,
        metadata: { direction: analysis.gaze.gazeDirection },
      });
    }

    // Check for prolonged eye closure
    if (analysis.gaze.eyeOpenness) {
      const avgOpenness = (analysis.gaze.eyeOpenness.left + analysis.gaze.eyeOpenness.right) / 2;
      if (avgOpenness < 0.3) {
        violations.push({
          eventType: 'eyes_closed_long',
          severity: 'low',
          confidence: 0.8,
          description: 'Eyes appear to be closed for extended period',
          metadata: { eyeOpenness: avgOpenness },
        });
      }
    }
  }

  // Audio analysis
  if (analysis.audio && !TEMP_DISABLE_AUDIO_PROCTORING) {
    const effectiveVoice = analysis.audio.hasVoice || analysis.audio.audioLevel >= AUDIO_VOICE_MIN_LEVEL;
    const multipleVoicesDetected = (analysis.audio.voiceCount || 0) > 1;
    // voice_detected is temporarily disabled; keep multi-voice signal only
    // as context for suspicious_audio severity decisions below.

    if (analysis.audio.audioLevel >= AUDIO_CRITICAL_LEVEL) {
      violations.push({
        eventType: 'suspicious_audio',
        severity: 'high',
        confidence: Math.max(0.8, analysis.audio.confidence || 0.8),
        description: `High audio level detected (${analysis.audio.audioLevel.toFixed(1)})`,
        metadata: { audioLevel: analysis.audio.audioLevel, threshold: AUDIO_CRITICAL_LEVEL },
      });
    } else if (analysis.audio.audioLevel >= AUDIO_WARNING_LEVEL && analysis.audio.hasVoice) {
      violations.push({
        eventType: 'suspicious_audio',
        severity: 'medium',
        confidence: Math.max(0.6, analysis.audio.confidence || 0.6),
        description: `Sustained voice/background audio detected (${analysis.audio.audioLevel.toFixed(1)})`,
        metadata: { audioLevel: analysis.audio.audioLevel, threshold: AUDIO_WARNING_LEVEL },
      });
    }

    if (effectiveVoice && !multipleVoicesDetected && analysis.audio.audioLevel >= AUDIO_WARNING_LEVEL) {
      violations.push({
        eventType: 'suspicious_audio',
        severity: 'low',
        confidence: Math.max(0.55, analysis.audio.confidence || 0.55),
        description: `Voice/background noise detected (${analysis.audio.audioLevel.toFixed(1)})`,
        metadata: { audioLevel: analysis.audio.audioLevel },
      });
    }

    if (analysis.audio.suspiciousSound) {
      violations.push({
        eventType: 'suspicious_audio',
        severity: 'medium',
        confidence: analysis.audio.confidence,
        description: 'Suspicious audio pattern detected',
        metadata: { audioLevel: analysis.audio.audioLevel },
      });
    }
  }

  // Object detection analysis
  if (analysis.objects) {
    if (analysis.objects.phoneDetected) {
      violations.push({
        eventType: 'phone_detected',
        severity: 'critical',
        confidence: analysis.objects.objects.find(o => o.type === 'cell phone')?.confidence || 0.9,
        description: 'Mobile phone detected in camera frame',
        metadata: { objects: analysis.objects.objects },
      });
    }

    // Secondary monitor violations are tracked by dedicated monitor-count transition checks.
  }

  // Screen info analysis
  if (analysis.screenInfo) {
    // Secondary monitor violations are tracked by dedicated monitor-count transition checks.

    if (!analysis.screenInfo.isFullscreen) {
      violations.push({
        eventType: 'fullscreen_exit',
        severity: 'high',
        confidence: 1.0,
        description: 'Fullscreen mode exited',
      });
    }

    if (!analysis.screenInfo.tabVisible) {
      violations.push({
        eventType: 'tab_switch',
        severity: 'medium',
        confidence: 1.0,
        description: 'Test tab is not visible',
      });
    }
  }

  return violations;
}

/**
 * Store violation event in database
 */
export async function storeViolation(
  sessionId: string,
  violation: ViolationEvent
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    let snapshotUrl: string | undefined;
    let audioClipUrl: string | undefined;

    // Get attempt ID from session
    const session = await prisma.proctorSession.findUnique({
      where: { id: sessionId },
      select: { attemptId: true },
    });

    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    // Upload snapshot if provided
    if (violation.snapshotData) {
      const buffer = Buffer.from(violation.snapshotData, 'base64');
      const result = await uploadSnapshot(buffer, session.attemptId, 'violation');
      if (result.success) {
        snapshotUrl = result.cdnUrl || result.url;
      }
    }

    // Upload audio clip if provided
    if (violation.audioClipData) {
      const buffer = Buffer.from(violation.audioClipData, 'base64');
      const result = await uploadRecording(buffer, session.attemptId, 'audio', 'audio/webm');
      if (result.success) {
        audioClipUrl = result.cdnUrl || result.url;
      }
    }

    // Store in database
    const event = await prisma.proctorEvent.create({
      data: {
        sessionId,
        eventType: violation.eventType,
        severity: violation.severity,
        confidence: violation.confidence,
        description: violation.description,
        metadata: violation.metadata ? JSON.stringify(violation.metadata) : null,
        snapshotUrl,
        audioClipUrl,
        duration: typeof violation.duration === 'number' ? Math.max(0, Math.floor(violation.duration)) : null,
      },
    });

    // Update attempt violation count.
    // Skip informational resume events and low-priority AI violations
    // (low-priority events are logged for trust score but don't count toward the violation limit).
    if (!NON_VIOLATION_EVENTS.has(violation.eventType) && !LOW_PRIORITY_EVENTS.has(violation.eventType)) {
      await prisma.testAttempt.update({
        where: { id: session.attemptId },
        data: {
          violations: { increment: 1 },
        },
      });
    }

    return { success: true, eventId: event.id };
  } catch (error) {
    console.error('Error storing violation:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to store violation',
    };
  }
}

/**
 * Store face snapshot for verification or periodic check
 */
export async function storeFaceSnapshot(
  sessionId: string,
  imageData: string,
  purpose: 'verification' | 'periodic_check' | 'violation_evidence',
  analysisResult?: FaceDetectionResult & Partial<GazeTrackingResult>
): Promise<{ success: boolean; snapshotId?: string; error?: string }> {
  try {
    const session = await prisma.proctorSession.findUnique({
      where: { id: sessionId },
      select: { attemptId: true },
    });

    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    // Upload image
    const buffer = Buffer.from(imageData, 'base64');
    const uploadResult = await uploadSnapshot(buffer, session.attemptId, 'face');

    if (!uploadResult.success) {
      return { success: false, error: uploadResult.error };
    }

    // Store in database
    const snapshot = await prisma.faceSnapshot.create({
      data: {
        sessionId,
        imageUrl: uploadResult.cdnUrl || uploadResult.url!,
        purpose,
        matchScore: analysisResult?.confidence,
        faceCount: analysisResult?.faceCount,
        gazeDirection: analysisResult?.gazeDirection ? JSON.stringify({ direction: analysisResult.gazeDirection }) : null,
      },
    });

    return { success: true, snapshotId: snapshot.id };
  } catch (error) {
    console.error('Error storing face snapshot:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to store snapshot',
    };
  }
}

/**
 * Calculate trust score based on session events
 */
export async function calculateTrustScore(sessionId: string): Promise<number> {
  try {
    const events = await prisma.proctorEvent.findMany({
      where: {
        sessionId,
        dismissed: false,
        eventType: { in: Array.from(REPORT_EVENT_TYPES) },
      },
    });

    if (events.length === 0) {
      return 100; // Perfect score if no violations
    }

    let deductions = 0;

    for (const event of events) {
      // Backward/forward compatible normalization:
      // - legacy/local pipeline often stores 0..1
      // - python CV adapter stores 0..100
      const rawConfidence = event.confidence || 0.5;
      const confidence = Math.max(0, Math.min(1, rawConfidence > 1 ? rawConfidence / 100 : rawConfidence));
      const weight = TRUST_EVENT_WEIGHT_MAP[event.eventType];
      if (typeof weight === 'number') {
        deductions += weight * confidence;
        continue;
      }
      const phoneMultiplier = event.eventType === 'phone_detected' ? PHONE_DEDUCTION_MULTIPLIER : 1;
      switch (event.severity) {
        case 'critical':
          deductions += 20 * confidence * phoneMultiplier;
          break;
        case 'high':
          deductions += 10 * confidence * phoneMultiplier;
          break;
        case 'medium':
          deductions += 5 * confidence * phoneMultiplier;
          break;
        default:
          deductions += 2 * confidence * phoneMultiplier;
          break;
      }
    }

    // Cap deductions at 100
    return Math.max(0, Math.min(100, 100 - deductions));
  } catch (error) {
    console.error('Error calculating trust score:', error);
    return 50; // Default middle score on error
  }
}

/**
 * Generate proctoring summary for an attempt
 */
export async function generateProctoringSummary(attemptId: string): Promise<{
  totalViolations: number;
  violationsByType: Record<string, number>;
  violationsBySeverity: Record<string, number>;
  trustScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  flagRecommendation: boolean;
}> {
  try {
    const session = await prisma.proctorSession.findUnique({
      where: { attemptId },
      include: {
        events: {
          where: { dismissed: false },
        },
      },
    });

    if (!session) {
      return {
        totalViolations: 0,
        violationsByType: {},
        violationsBySeverity: {},
        trustScore: 100,
        riskLevel: 'low',
        flagRecommendation: false,
      };
    }

    const events = session.events.filter(
      event => !NON_VIOLATION_EVENTS.has(event.eventType) && REPORT_EVENT_TYPES.has(event.eventType)
    );
    const violationsByType: Record<string, number> = {};
    const violationsBySeverity: Record<string, number> = {};

    for (const event of events) {
      violationsByType[event.eventType] = (violationsByType[event.eventType] || 0) + 1;
      violationsBySeverity[event.severity] = (violationsBySeverity[event.severity] || 0) + 1;
    }

    const trustScore = await calculateTrustScore(session.id);

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (trustScore < 30) riskLevel = 'critical';
    else if (trustScore < 50) riskLevel = 'high';
    else if (trustScore < 75) riskLevel = 'medium';

    // Recommend flagging if critical violations or very low trust score
    const flagRecommendation =
      (violationsBySeverity['critical'] || 0) > 0 ||
      trustScore < 40 ||
      events.length > 10;

    return {
      totalViolations: events.length,
      violationsByType,
      violationsBySeverity,
      trustScore,
      riskLevel,
      flagRecommendation,
    };
  } catch (error) {
    console.error('Error generating proctoring summary:', error);
    return {
      totalViolations: 0,
      violationsByType: {},
      violationsBySeverity: {},
      trustScore: 50,
      riskLevel: 'medium',
      flagRecommendation: false,
    };
  }
}

/**
 * Compare face with reference for verification
 * Returns a similarity score 0-100
 */
export async function compareFaces(
  referenceFaceData: string,
  currentFaceData: string
): Promise<{ match: boolean; score: number; error?: string }> {
  // Note: In production, this would use a proper face comparison API
  // For now, we return a placeholder that assumes client-side comparison
  // The actual face comparison happens on the client using TensorFlow.js face-api

  try {
    // This is a placeholder - actual implementation would:
    // 1. Extract face embeddings from both images
    // 2. Calculate cosine similarity between embeddings
    // 3. Return match result based on threshold

    // For production, integrate with:
    // - AWS Rekognition
    // - Azure Face API
    // - Google Cloud Vision
    // - Or use face-api.js embeddings sent from client

    return {
      match: true,
      score: 85, // Placeholder score
    };
  } catch (error) {
    return {
      match: false,
      score: 0,
      error: error instanceof Error ? error.message : 'Face comparison failed',
    };
  }
}

export default {
  analyzeProctoring,
  storeViolation,
  storeFaceSnapshot,
  calculateTrustScore,
  generateProctoringSummary,
  compareFaces,
};
