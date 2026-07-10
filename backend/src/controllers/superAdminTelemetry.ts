import { Response } from 'express';
import prisma from '../utils/db.js';
import { AuthenticatedRequest } from '../types/index.js';
import { getLiveTelemetrySnapshot } from '../services/telemetryRingBuffer.js';

const TELEMETRY_DISCLAIMER =
  'failedRequestRatePct measures admin-API request health (5xx share), not client-side network packet loss, which this stack has no way to measure.';

export async function fetchLiveTelemetry() {
  const activeSessions = await prisma.proctorSession.count({ where: { endedAt: null } });
  return {
    capturedAt: new Date().toISOString(),
    activeSessions,
    ...getLiveTelemetrySnapshot(),
    disclaimer: TELEMETRY_DISCLAIMER,
  };
}

export async function fetchTelemetryHistory(limit = 120) {
  const cappedLimit = Math.min(500, Math.max(1, limit));
  const snapshots = await prisma.telemetrySnapshot.findMany({
    orderBy: { capturedAt: 'desc' },
    take: cappedLimit,
  });
  return snapshots.reverse();
}

export async function getLiveTelemetry(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    res.json(await fetchLiveTelemetry());
  } catch (error) {
    console.error('Get live telemetry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getTelemetryHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const limit = Number.parseInt(String(req.query.limit ?? '120'), 10) || 120;
    const snapshots = await fetchTelemetryHistory(limit);
    res.json({ snapshots });
  } catch (error) {
    console.error('Get telemetry history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
