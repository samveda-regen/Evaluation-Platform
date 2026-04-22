import { Response } from 'express';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';
import { callLLM } from '../services/llmService.js';
import {
  calculateTrustScoreFromEvents,
  riskLevelFromTrustScore,
  TRUST_REPORT_EVENT_TYPES,
} from '../services/trustScoreService.js';

type TrustRiskLevel = 'low' | 'medium' | 'high' | 'critical';
type TrustEvent = {
  id?: string;
  sessionId?: string;
  eventType: string;
  severity: string;
  confidence: number | null;
  metadata?: string | null;
  snapshotUrl?: string | null;
  timestamp?: Date;
};

type ViolationProof = {
  eventId: string | null;
  eventType: string;
  severity: string;
  timestamp: string | null;
  snapshotUrl: string;
  isAiEvent: boolean;
  source: string;
};

type TrustViolationCounts = {
  tabSwitch: number;
  focusLoss: number;
  fullscreenExit: number;
  copyPaste: number;
  devtoolsOpen: number;
  cameraBlocked: number;
  secondaryMonitor: number;
  screenshotEvidence: number;
  phone: number;
  multipleFaces: number;
  faceAbsent: number;
  lookingAway: number;
  voice: number;
  suspiciousAudio: number;
  unauthorizedObject: number;
};

function getEventMetadata(event: Pick<TrustEvent, 'metadata'>): Record<string, unknown> {
  if (!event.metadata) return {};
  try {
    const parsed = JSON.parse(event.metadata);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function isAiProctorEvent(event: TrustEvent): boolean {
  const metadata = getEventMetadata(event);
  const source = String(metadata.source || '').toLowerCase();
  const aiSource = String(metadata.aiSource || '').toLowerCase();
  const hasAiTrace = typeof metadata.aiTraceId === 'string' && metadata.aiTraceId.length > 0;

  return source === 'external_ai_engine' || aiSource.length > 0 || hasAiTrace;
}

function buildViolationCounts(events: TrustEvent[]): TrustViolationCounts {
  return {
    tabSwitch: events.filter(e => e.eventType === 'tab_switch').length,
    focusLoss: events.filter(e => e.eventType === 'window_blur').length,
    fullscreenExit: events.filter(e => e.eventType === 'fullscreen_exit').length,
    copyPaste: events.filter(e => e.eventType === 'copy_paste_attempt').length,
    devtoolsOpen: events.filter(e => e.eventType === 'devtools_open').length,
    cameraBlocked: events.filter(e => e.eventType === 'camera_blocked').length,
    secondaryMonitor: events.filter(e => e.eventType === 'secondary_monitor_detected').length,
    screenshotEvidence: events.filter(e => !!e.snapshotUrl).length,
    // Legacy keys preserved for existing frontend compatibility.
    phone: 0,
    multipleFaces: 0,
    faceAbsent: 0,
    lookingAway: 0,
    voice: 0,
    suspiciousAudio: 0,
    unauthorizedObject: 0,
  };
}

function safeParseJSON<T>(raw?: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getSnapshotUrls(events: TrustEvent[], max = 8): string[] {
  const urls = events
    .map(event => event.snapshotUrl)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
  return Array.from(new Set(urls)).slice(0, max);
}

function buildViolationProofs(events: TrustEvent[], max = 12): ViolationProof[] {
  return events
    .filter((event): event is TrustEvent & { snapshotUrl: string } => !!event.snapshotUrl)
    .slice(0, max)
    .map(event => {
      const metadata = getEventMetadata(event);
      const snapshotSource = String(
        metadata.snapshotSource ||
          metadata.snapshotEvidenceSource ||
          metadata.source ||
          (isAiProctorEvent(event) ? 'ai_camera' : 'screen_or_camera')
      );
      return {
        eventId: event.id || null,
        eventType: event.eventType,
        severity: event.severity,
        timestamp: event.timestamp ? event.timestamp.toISOString() : null,
        snapshotUrl: event.snapshotUrl,
        isAiEvent: isAiProctorEvent(event),
        source: snapshotSource,
      };
    });
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

    const events: TrustEvent[] = sessionIds.length
      ? await prisma.proctorEvent.findMany({
          where: {
            sessionId: { in: sessionIds },
            dismissed: false,
            eventType: { in: TRUST_REPORT_EVENT_TYPES },
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

    const eventsBySession = new Map<string, TrustEvent[]>();
    for (const event of events) {
      const sessionId = event.sessionId;
      if (!sessionId) continue;
      const bucket = eventsBySession.get(sessionId) || [];
      bucket.push(event);
      eventsBySession.set(sessionId, bucket);
    }

    const reportRows = attempts.map(attempt => {
      const sessionId = attempt.proctorSession?.id;
      const rawSessionEvents = sessionId ? eventsBySession.get(sessionId) || [] : [];

      const counts = buildViolationCounts(rawSessionEvents);
      const totalViolations = rawSessionEvents.length;
      const trustScore = calculateTrustScoreFromEvents(rawSessionEvents);
      const riskLevel = riskLevelFromTrustScore(trustScore);
      const parsedSummary = safeParseJSON<{ llmSummary?: string }>(attempt.analytics?.proctoringSummary || null);
      const latestEvent = rawSessionEvents[0];
      const latestSnapshotEvent = rawSessionEvents.find(event => !!event.snapshotUrl);
      const snapshotUrls = getSnapshotUrls(rawSessionEvents);
      const violationProofs = buildViolationProofs(rawSessionEvents);

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
        trustScore,
        riskLevel,
        totalViolations,
        trustRelevantViolations: rawSessionEvents.length,
        violations: counts,
        latestViolationAt: latestEvent?.timestamp || null,
        latestSnapshotUrl: latestSnapshotEvent?.snapshotUrl || null,
        screenshotCount: counts.screenshotEvidence,
        snapshotUrls,
        violationProofs,
        llmSummary: parsedSummary?.llmSummary || null,
      };
    });

    const filteredRows = reportRows.filter(row => (risk ? row.riskLevel === risk : true));

    res.json({
      reports: filteredRows,
      filters: {
        reportEventTypes: TRUST_REPORT_EVENT_TYPES,
        trustScoringEventTypes: TRUST_REPORT_EVENT_TYPES,
        excludedAiEventTypes: [],
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

    const eventsRaw: TrustEvent[] = attempt.proctorSession
      ? await prisma.proctorEvent.findMany({
          where: {
            sessionId: attempt.proctorSession.id,
            dismissed: false,
            eventType: { in: TRUST_REPORT_EVENT_TYPES },
          },
          select: {
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

    const trustScore = calculateTrustScoreFromEvents(eventsRaw);
    const riskLevel = riskLevelFromTrustScore(trustScore);
    const counts = buildViolationCounts(eventsRaw);
    const snapshotUrls = getSnapshotUrls(eventsRaw);

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
              `Violations: tab_switch=${counts.tabSwitch}, focus_loss=${counts.focusLoss}, fullscreen_exit=${counts.fullscreenExit}, copy_paste=${counts.copyPaste}, devtools_open=${counts.devtoolsOpen}, camera_blocked=${counts.cameraBlocked}, secondary_monitor=${counts.secondaryMonitor}, screenshot_evidence=${counts.screenshotEvidence}`,
              `Total reportable violations: ${eventsRaw.length}`,
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
      totalViolations: eventsRaw.length,
      trustRelevantViolations: eventsRaw.length,
      violations: counts,
      screenshotCount: counts.screenshotEvidence,
      snapshotUrls,
      llmSummary,
      reportEventTypes: TRUST_REPORT_EVENT_TYPES,
      trustScoringEventTypes: TRUST_REPORT_EVENT_TYPES,
      excludedAiEventTypes: [],
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
      totalViolations: eventsRaw.length,
      trustRelevantViolations: eventsRaw.length,
      violations: counts,
      screenshotCount: counts.screenshotEvidence,
      latestSnapshotUrl: snapshotUrls[0] || null,
      llmSummary,
      generatedAt: proctoringSummary.generatedAt,
    });
  } catch (error) {
    console.error('Re-evaluate trust report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
