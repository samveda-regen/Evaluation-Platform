import prisma from '../utils/db';

export type TrustScoreRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type TrustScoreEventInput = {
  sessionId?: string | null;
  eventType: string;
  severity: string;
  confidence?: number | null;
};

const PHONE_DEDUCTION_MULTIPLIER = 1.5;
const DEFAULT_REPORT_EVENT_TYPES =
  'tab_switch,window_blur,fullscreen_exit,copy_paste_attempt,camera_blocked,multiple_faces,phone_detected,face_not_detected,looking_away,voice_detected,secondary_monitor_detected';

export const TRUST_REPORT_EVENT_TYPES = Array.from(
  new Set(
    [
      ...(process.env.PROCTOR_REPORT_EVENTS || DEFAULT_REPORT_EVENT_TYPES)
        .split(',')
        .map(v => v.trim().toLowerCase())
        .filter(Boolean),
      // Keep no-face violations in trust math even if env configuration omits it.
      'face_not_detected',
    ]
  )
);

const TRUST_REPORT_EVENT_TYPE_SET = new Set(TRUST_REPORT_EVENT_TYPES);

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

export function isTrustReportEventType(eventType: string): boolean {
  return TRUST_REPORT_EVENT_TYPE_SET.has(eventType);
}

export function normalizeTrustConfidence(confidence?: number | null): number {
  const rawConfidence = confidence ?? 0.5;
  return Math.max(0, Math.min(1, rawConfidence > 1 ? rawConfidence / 100 : rawConfidence));
}

export function calculateTrustScoreFromEvents(events: TrustScoreEventInput[]): number {
  const reportEvents = events.filter(event => isTrustReportEventType(event.eventType));
  if (reportEvents.length === 0) {
    return 100;
  }

  let deductions = 0;

  for (const event of reportEvents) {
    const confidence = normalizeTrustConfidence(event.confidence);
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

  return Number(Math.max(0, Math.min(100, 100 - deductions)).toFixed(1));
}

export function riskLevelFromTrustScore(score: number): TrustScoreRiskLevel {
  if (score < 30) return 'critical';
  if (score < 50) return 'high';
  if (score < 75) return 'medium';
  return 'low';
}

export async function getTrustScoreForSessionId(sessionId: string): Promise<number> {
  const events = await prisma.proctorEvent.findMany({
    where: {
      sessionId,
      dismissed: false,
      eventType: { in: TRUST_REPORT_EVENT_TYPES },
    },
    select: {
      eventType: true,
      severity: true,
      confidence: true,
    },
  });

  return calculateTrustScoreFromEvents(events);
}

export async function getTrustScoresForAttemptIds(attemptIds: string[]): Promise<Map<string, number>> {
  const scoresByAttemptId = new Map<string, number>();

  for (const attemptId of attemptIds) {
    scoresByAttemptId.set(attemptId, 100);
  }

  if (attemptIds.length === 0) {
    return scoresByAttemptId;
  }

  const sessions = await prisma.proctorSession.findMany({
    where: { attemptId: { in: attemptIds } },
    select: {
      id: true,
      attemptId: true,
    },
  });

  if (sessions.length === 0) {
    return scoresByAttemptId;
  }

  const sessionIds = sessions.map(session => session.id);
  const attemptIdBySessionId = new Map(sessions.map(session => [session.id, session.attemptId]));
  const events = await prisma.proctorEvent.findMany({
    where: {
      sessionId: { in: sessionIds },
      dismissed: false,
      eventType: { in: TRUST_REPORT_EVENT_TYPES },
    },
    select: {
      sessionId: true,
      eventType: true,
      severity: true,
      confidence: true,
    },
  });

  const eventsBySessionId = new Map<string, TrustScoreEventInput[]>();
  for (const event of events) {
    const bucket = eventsBySessionId.get(event.sessionId) || [];
    bucket.push(event);
    eventsBySessionId.set(event.sessionId, bucket);
  }

  for (const session of sessions) {
    const sessionEvents = eventsBySessionId.get(session.id) || [];
    scoresByAttemptId.set(session.attemptId, calculateTrustScoreFromEvents(sessionEvents));
  }

  return scoresByAttemptId;
}
