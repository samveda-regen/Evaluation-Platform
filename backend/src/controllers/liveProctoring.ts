import { Response } from 'express';
import prisma from '../utils/db';
import { AuthenticatedRequest } from '../types/index';
import {
  buildLiveRoomName,
  createLiveProctoringToken,
  getLiveKitUrl,
  isLiveKitConfigured,
} from '../services/liveProctoringService';

export async function getCandidateLiveToken(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const candidate = req.candidate;
    const { attemptId } = req.params;

    if (!candidate || candidate.attemptId !== attemptId) {
      res.status(403).json({ error: 'Candidate is not allowed to publish this live session' });
      return;
    }

    if (!isLiveKitConfigured()) {
      res.status(503).json({ error: 'Live proctoring is not configured' });
      return;
    }

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        testId: true,
        candidateId: true,
        status: true,
        candidate: { select: { name: true, email: true } },
        test: { select: { proctorEnabled: true } },
      },
    });

    if (!attempt || attempt.candidateId !== candidate.id) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    if (!attempt.test.proctorEnabled || attempt.status !== 'in_progress') {
      res.status(409).json({ error: 'Live proctoring is available only during an active proctored exam' });
      return;
    }

    const roomName = buildLiveRoomName(attempt.testId, attempt.id);
    const identity = `candidate:${attempt.id}`;
    const token = await createLiveProctoringToken({
      role: 'candidate',
      roomName,
      identity,
      displayName: attempt.candidate.name || attempt.candidate.email,
      metadata: {
        attemptId: attempt.id,
        testId: attempt.testId,
        candidateId: attempt.candidateId,
      },
    });

    res.json({
      success: true,
      url: getLiveKitUrl(),
      token,
      roomName,
      identity,
    });
  } catch (error) {
    console.error('Error creating candidate LiveKit token:', error);
    res.status(500).json({ error: 'Failed to create live proctoring token' });
  }
}

export async function getAdminLiveToken(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const admin = req.admin;
    const { attemptId } = req.params;

    if (!admin) {
      res.status(401).json({ error: 'Admin authentication required' });
      return;
    }

    if (!isLiveKitConfigured()) {
      res.status(503).json({ error: 'Live proctoring is not configured' });
      return;
    }

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        testId: true,
        candidateId: true,
        status: true,
        candidate: { select: { name: true, email: true } },
        test: { select: { adminId: true, name: true } },
      },
    });

    if (!attempt || attempt.test.adminId !== admin.id) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    const roomName = buildLiveRoomName(attempt.testId, attempt.id);
    const identity = `admin:${admin.id}:${attempt.id}`;
    const token = await createLiveProctoringToken({
      role: 'admin',
      roomName,
      identity,
      displayName: admin.email,
      metadata: {
        attemptId: attempt.id,
        testId: attempt.testId,
        candidateId: attempt.candidateId,
      },
    });

    res.json({
      success: true,
      url: getLiveKitUrl(),
      token,
      roomName,
      identity,
      candidate: attempt.candidate,
      test: attempt.test,
    });
  } catch (error) {
    console.error('Error creating admin LiveKit token:', error);
    res.status(500).json({ error: 'Failed to create live proctoring viewer token' });
  }
}
