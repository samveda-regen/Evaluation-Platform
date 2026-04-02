import { Response } from 'express';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';
import { callLLM } from '../services/llmService.js';

const REPORT_EVENT_TYPES = Array.from(
  new Set([
    ...(
      process.env.PROCTOR_REPORT_EVENTS ||
      'tab_switch,window_blur,fullscreen_exit,copy_paste_attempt,camera_blocked,multiple_faces,phone_detected,face_not_detected,looking_away,voice_detected,secondary_monitor_detected'
    )
      .split(',')
      .map(v => v.trim().toLowerCase())
      .filter(Boolean),
    // Keep no-face violations in trust reports even if env list is missing it.
    'face_not_detected',
  ])
);

type TrustRiskLevel = 'low' | 'medium' | 'high' | 'critical';

function toNormalizedConfidence(confidence?: number | null): number {
  const raw = confidence ?? 0.5;
  if (raw <= 1) return Math.max(0, Math.min(1, raw));
  return Math.max(0, Math.min(1, raw / 100));
}

// Phone detection carries a 1.5× deduction multiplier — it is high priority
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

function calculateTrustFromEvents(
  events: Array<{ eventType: string; severity: string; confidence: number | null }>
): number {
  if (events.length === 0) return 100;

  let deductions = 0;
  for (const event of events) {
    const confidence = toNormalizedConfidence(event.confidence);
    const weight = TRUST_EVENT_WEIGHT_MAP[event.eventType];
    if (typeof weight === 'number') {
      deductions += weight * confidence;
      continue;
    }
    switch (event.severity) {
      case 'critical':
        deductions += 20 * confidence;
        break;
      case 'high':
        deductions += 10 * confidence;
        break;
      case 'medium':
        deductions += 5 * confidence;
        break;
      default:
        deductions += 2 * confidence;
        break;
    }
  }

  return Math.max(0, Math.min(100, 100 - deductions));
}

function riskLevelFromTrustScore(score: number): TrustRiskLevel {
  if (score < 30) return 'critical';
  if (score < 50) return 'high';
  if (score < 75) return 'medium';
  return 'low';
}

function safeParseJSON<T>(raw?: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function getTrustReports(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const adminId = req.admin!.id;
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || '20', 10)));
    const search = ((req.query.search as string) || '').trim();
    const testId = ((req.query.testId as string) || '').trim();
    const risk = ((req.query.risk as string) || '').trim().toLowerCase();
    const flaggedOnly = (req.query.flagged as string) === 'true';
    const skip = (page - 1) * limit;

    if (testId) {
      const ownedTest = await prisma.test.findFirst({
        where: { id: testId, adminId },
        select: { id: true },
      });
      if (!ownedTest) {
        res.status(404).json({ error: 'Test not found' });
        return;
      }
    }

    const where: Record<string, any> = {
      test: { adminId },
    };
    if (testId) where.testId = testId;
    if (flaggedOnly) where.isFlagged = true;
    if (search) {
      where.OR = [
        { candidate: { name: { contains: search } } },
        { candidate: { email: { contains: search } } },
        { test: { name: { contains: search } } },
      ];
    }

    const [attempts, total, tests] = await Promise.all([
      prisma.testAttempt.findMany({
        where,
        include: {
          candidate: { select: { id: true, name: true, email: true } },
          test: { select: { id: true, name: true, testCode: true } },
          analytics: { select: { trustScore: true, proctoringSummary: true } },
          proctorSession: { select: { id: true } },
        },
        orderBy: { startTime: 'desc' },
        skip,
        take: limit,
      }),
      prisma.testAttempt.count({ where }),
      prisma.test.findMany({
        where: { adminId },
        select: {
          id: true,
          name: true,
          testCode: true,
          _count: { select: { attempts: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const sessionIds = attempts
      .map(a => a.proctorSession?.id)
      .filter((v): v is string => !!v);

    const events = sessionIds.length
      ? await prisma.proctorEvent.findMany({
          where: {
            sessionId: { in: sessionIds },
            dismissed: false,
            eventType: { in: REPORT_EVENT_TYPES },
          },
          select: {
            id: true,
            sessionId: true,
            eventType: true,
            severity: true,
            confidence: true,
            metadata: true,
            timestamp: true,
            snapshotUrl: true,
          },
          orderBy: { timestamp: 'desc' },
        })
      : [];

    const eventsBySession = new Map<string, typeof events>();
    for (const event of events) {
      const bucket = eventsBySession.get(event.sessionId) || [];
      bucket.push(event);
      eventsBySession.set(event.sessionId, bucket);
    }

    const reportRows = attempts.map(attempt => {
      const sessionId = attempt.proctorSession?.id;
      const sessionEvents = sessionId ? eventsBySession.get(sessionId) || [] : [];

      const counts = {
        tabSwitch: sessionEvents.filter(e => e.eventType === 'tab_switch').length,
        focusLoss: sessionEvents.filter(e => e.eventType === 'window_blur').length,
        fullscreenExit: sessionEvents.filter(e => e.eventType === 'fullscreen_exit').length,
        copyPaste: sessionEvents.filter(e => e.eventType === 'copy_paste_attempt').length,
        cameraBlocked: sessionEvents.filter(e => e.eventType === 'camera_blocked').length,
        phone: sessionEvents.filter(e => e.eventType === 'phone_detected').length,
        multipleFaces: sessionEvents.filter(e => e.eventType === 'multiple_faces').length,
        faceAbsent: sessionEvents.filter(e => e.eventType === 'face_not_detected').length,
        lookingAway: sessionEvents.filter(e => e.eventType === 'looking_away').length,
        voice: sessionEvents.filter(e => e.eventType === 'voice_detected').length,
        secondaryMonitor: sessionEvents.filter(e => e.eventType === 'secondary_monitor_detected').length,
        suspiciousAudio: sessionEvents.filter(e => e.eventType === 'suspicious_audio').length,
        unauthorizedObject: sessionEvents.filter(e => e.eventType === 'unauthorized_object_detected').length,
      };
      const totalViolations = sessionEvents.length;

      const derivedTrust = calculateTrustFromEvents(sessionEvents);
      const trustScore =
        typeof attempt.analytics?.trustScore === 'number'
          ? attempt.analytics.trustScore
          : derivedTrust;

      const riskLevel = riskLevelFromTrustScore(trustScore);
      const parsedSummary = safeParseJSON<{ llmSummary?: string }>(attempt.analytics?.proctoringSummary || null);
      const latestEvent = sessionEvents[0];

      return {
        attemptId: attempt.id,
        testId: attempt.testId,
        testName: attempt.test.name,
        testCode: attempt.test.testCode,
        candidateId: attempt.candidateId,
        candidateName: attempt.candidate.name,
        candidateEmail: attempt.candidate.email,
        status: attempt.status,
        isFlagged: attempt.isFlagged,
        startTime: attempt.startTime,
        endTime: attempt.endTime,
        trustScore: Number(trustScore.toFixed(1)),
        riskLevel,
        totalViolations,
        violations: counts,
        latestViolationAt: latestEvent?.timestamp || null,
        latestSnapshotUrl: latestEvent?.snapshotUrl || null,
        llmSummary: parsedSummary?.llmSummary || null,
      };
    });

    const filteredRows = reportRows.filter(row => (risk ? row.riskLevel === risk : true));

    res.json({
      reports: filteredRows,
      filters: {
        reportEventTypes: REPORT_EVENT_TYPES,
        riskLevels: ['low', 'medium', 'high', 'critical'],
      },
      testTree: tests.map(test => ({
        id: test.id,
        name: test.name,
        testCode: test.testCode,
        attempts: test._count.attempts,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get trust reports error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function reEvaluateTrustReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId } = req.params;
    const adminId = req.admin!.id;

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        candidate: { select: { id: true, name: true, email: true } },
        test: { select: { id: true, name: true, testCode: true, adminId: true } },
        proctorSession: { select: { id: true } },
      },
    });

    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }
    if (attempt.test.adminId !== adminId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const events = attempt.proctorSession
      ? await prisma.proctorEvent.findMany({
          where: {
            sessionId: attempt.proctorSession.id,
            dismissed: false,
            eventType: { in: REPORT_EVENT_TYPES },
          },
          select: {
            eventType: true,
            severity: true,
            confidence: true,
            metadata: true,
            timestamp: true,
          },
          orderBy: { timestamp: 'desc' },
        })
      : [];

    const trustScore = Number(calculateTrustFromEvents(events).toFixed(1));
    const riskLevel = riskLevelFromTrustScore(trustScore);
    const counts = {
      tabSwitch: events.filter(e => e.eventType === 'tab_switch').length,
      focusLoss: events.filter(e => e.eventType === 'window_blur').length,
      fullscreenExit: events.filter(e => e.eventType === 'fullscreen_exit').length,
      copyPaste: events.filter(e => e.eventType === 'copy_paste_attempt').length,
      cameraBlocked: events.filter(e => e.eventType === 'camera_blocked').length,
      phone: events.filter(e => e.eventType === 'phone_detected').length,
      multipleFaces: events.filter(e => e.eventType === 'multiple_faces').length,
      faceAbsent: events.filter(e => e.eventType === 'face_not_detected').length,
      lookingAway: events.filter(e => e.eventType === 'looking_away').length,
      voice: events.filter(e => e.eventType === 'voice_detected').length,
      secondaryMonitor: events.filter(e => e.eventType === 'secondary_monitor_detected').length,
      suspiciousAudio: events.filter(e => e.eventType === 'suspicious_audio').length,
      unauthorizedObject: events.filter(e => e.eventType === 'unauthorized_object_detected').length,
    };

    let llmSummary = `Trust score ${trustScore}%. Risk level ${riskLevel}.`;
    try {
      const llmResponse = await callLLM(
        [
          {
            role: 'system',
            content:
              'You are a test integrity analyst. Return exactly one short paragraph (max 70 words), plain text.',
          },
          {
            role: 'user',
            content: [
              `Candidate: ${attempt.candidate.name} (${attempt.candidate.email})`,
              `Test: ${attempt.test.name} (${attempt.test.testCode})`,
              `Trust Score: ${trustScore}`,
              `Risk Level: ${riskLevel}`,
              `Violations: tab_switch=${counts.tabSwitch}, focus_loss=${counts.focusLoss}, fullscreen_exit=${counts.fullscreenExit}, copy_paste=${counts.copyPaste}, camera_blocked=${counts.cameraBlocked}, phone=${counts.phone}, multiple_faces=${counts.multipleFaces}, face_not_detected=${counts.faceAbsent}, looking_away=${counts.lookingAway}, voice=${counts.voice}, secondary_monitor=${counts.secondaryMonitor}`,
              `Total reportable violations: ${events.length}`,
              'Provide a concise integrity assessment with one recommendation.',
            ].join('\n'),
          },
        ],
        {
          provider: (process.env.LLM_PROVIDER as 'openai' | 'anthropic' | undefined) || 'openai',
          model: process.env.LLM_MODEL || undefined,
          temperature: 0.2,
          maxTokens: 180,
        }
      );
      if (llmResponse.content?.trim()) {
        llmSummary = llmResponse.content.trim();
      }
    } catch (llmError) {
      console.warn('Trust report LLM summary fallback:', llmError);
    }

    const startedAtMs = new Date(attempt.startTime).getTime();
    const endedAtMs = new Date(attempt.endTime || new Date()).getTime();
    const totalTimeTaken = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000));
    const proctoringSummary = {
      generatedAt: new Date().toISOString(),
      trustScore,
      riskLevel,
      totalViolations: events.length,
      violations: counts,
      llmSummary,
      reportEventTypes: REPORT_EVENT_TYPES,
    };

    await prisma.performanceAnalytics.upsert({
      where: { attemptId },
      create: {
        attemptId,
        totalScore: attempt.score || 0,
        totalTimeTaken,
        trustScore,
        proctoringSummary: JSON.stringify(proctoringSummary),
      },
      update: {
        trustScore,
        proctoringSummary: JSON.stringify(proctoringSummary),
      },
    });

    res.json({
      attemptId,
      trustScore,
      riskLevel,
      totalViolations: events.length,
      violations: counts,
      llmSummary,
      generatedAt: proctoringSummary.generatedAt,
    });
  } catch (error) {
    console.error('Re-evaluate trust report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
