import { Response } from 'express';

import type { AuthenticatedRequest } from '../types/index.js';
import prisma from '../utils/db.js';
import {
  InvitationServiceError,
  getPublicInvitationDetails,
  sendBulkTestInvitations
} from '../services/invitationService.js';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Internal server error';
}

export async function sendTestInvitations(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId } = req.params;
    const customMessage = typeof req.body.customMessage === 'string'
      ? req.body.customMessage
      : undefined;

    if (!req.file) {
      res.status(400).json({ error: 'Invitation file is required.' });
      return;
    }

    const summary = await sendBulkTestInvitations({
      testId,
      adminId: req.admin!.id,
      file: req.file,
      customMessage
    });

    res.json(summary);
  } catch (error) {
    if (error instanceof InvitationServiceError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    console.error('Send invitations error:', error);
    res.status(500).json({ error: getErrorMessage(error) });
  }
}

export async function getInvitationDetails(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const details = await getPublicInvitationDetails(req.params.token);

    res.json({
      invitation: details.invitation,
      test: details.test
    });
  } catch (error) {
    if (error instanceof InvitationServiceError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    console.error('Get invitation details error:', error);
    res.status(500).json({ error: getErrorMessage(error) });
  }
}

export async function getInvitationDashboard(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const adminId = req.admin!.id;
    const now = new Date();

    const invitations = await prisma.testInvitation.findMany({
      where: {
        test: { adminId },
        status: { in: ['PENDING', 'SENT'] }
      },
      select: {
        testId: true,
        email: true,
        test: { select: { endTime: true } }
      }
    });

    const invited = invitations.length;

    if (invited === 0) {
      res.json({
        stats: {
          invited: 0,
          started: 0,
          completed: 0,
          notStarted: 0,
          expired: 0
        }
      });
      return;
    }

    const emails = Array.from(new Set(invitations.map((invitation) => invitation.email.toLowerCase())));
    const testIds = Array.from(new Set(invitations.map((invitation) => invitation.testId)));

    const attempts = await prisma.testAttempt.findMany({
      where: {
        testId: { in: testIds },
        candidate: { email: { in: emails } }
      },
      select: {
        testId: true,
        status: true,
        candidate: { select: { email: true } }
      }
    });

    const attemptMap = new Map<string, string>();
    for (const attempt of attempts) {
      const key = `${attempt.testId}:${attempt.candidate.email.toLowerCase()}`;
      attemptMap.set(key, attempt.status);
    }

    let started = 0;
    let completed = 0;
    let notStarted = 0;
    let expired = 0;

    for (const invitation of invitations) {
      const key = `${invitation.testId}:${invitation.email.toLowerCase()}`;
      const attemptStatus = attemptMap.get(key);

      if (attemptStatus) {
        if (attemptStatus === 'submitted' || attemptStatus === 'auto_submitted') {
          completed += 1;
        } else {
          started += 1;
        }
        continue;
      }

      if (invitation.test.endTime && invitation.test.endTime < now) {
        expired += 1;
      } else {
        notStarted += 1;
      }
    }

    res.json({
      stats: {
        invited,
        started,
        completed,
        notStarted,
        expired
      }
    });
  } catch (error) {
    console.error('Get invitation dashboard error:', error);
    res.status(500).json({ error: getErrorMessage(error) });
  }
}

export async function getTestInvitationDashboard(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId } = req.params;
    const adminId = req.admin!.id;
    const now = new Date();

    const test = await prisma.test.findFirst({
      where: { id: testId, adminId },
      select: { id: true, name: true, endTime: true }
    });

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const invitations = await prisma.testInvitation.findMany({
      where: { testId: test.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        sentAt: true,
        createdAt: true,
        consumedAt: true
      }
    });

    const invited = invitations.length;

    if (invited === 0) {
      res.json({
        test: { id: test.id, name: test.name },
        stats: {
          invited: 0,
          started: 0,
          completed: 0,
          notStarted: 0,
          expired: 0
        },
        invitations: []
      });
      return;
    }

    const emails = Array.from(new Set(invitations.map((invitation) => invitation.email.toLowerCase())));
    const attempts = await prisma.testAttempt.findMany({
      where: {
        testId: test.id,
        candidate: { email: { in: emails } }
      },
      select: {
        status: true,
        candidate: { select: { email: true } }
      }
    });

    const attemptMap = new Map<string, string>();
    for (const attempt of attempts) {
      const key = attempt.candidate.email.toLowerCase();
      attemptMap.set(key, attempt.status);
    }

    let started = 0;
    let completed = 0;
    let notStarted = 0;
    let expired = 0;

    const mappedInvitations = invitations.map((invitation) => {
      const attemptStatus = attemptMap.get(invitation.email.toLowerCase());
      let lifecycleStatus: 'Started' | 'Completed' | 'Not Started' | 'Expired';

      if (attemptStatus) {
        if (attemptStatus === 'submitted' || attemptStatus === 'auto_submitted') {
          completed += 1;
          lifecycleStatus = 'Completed';
        } else {
          started += 1;
          lifecycleStatus = 'Started';
        }
      } else if (test.endTime && test.endTime < now) {
        expired += 1;
        lifecycleStatus = 'Expired';
      } else {
        notStarted += 1;
        lifecycleStatus = 'Not Started';
      }

      return {
        id: invitation.id,
        name: invitation.name,
        email: invitation.email,
        inviteStatus: invitation.status,
        sentAt: invitation.sentAt,
        createdAt: invitation.createdAt,
        consumedAt: invitation.consumedAt,
        lifecycleStatus
      };
    });

    res.json({
      test: { id: test.id, name: test.name },
      stats: {
        invited,
        started,
        completed,
        notStarted,
        expired
      },
      invitations: mappedInvitations
    });
  } catch (error) {
    console.error('Get test invitation dashboard error:', error);
    res.status(500).json({ error: getErrorMessage(error) });
  }
}

export async function deleteTestInvitationCandidate(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId, invitationId } = req.params;
    const adminId = req.admin!.id;

    const invitation = await prisma.testInvitation.findFirst({
      where: {
        id: invitationId,
        testId,
        test: { adminId }
      },
      select: {
        id: true,
        testId: true,
        email: true
      }
    });

    if (!invitation) {
      res.status(404).json({ error: 'Invitation not found for this test' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      const candidate = await tx.candidate.findUnique({
        where: { email: invitation.email },
        select: { id: true }
      });

      if (candidate) {
        await tx.testAttempt.deleteMany({
          where: {
            testId: invitation.testId,
            candidateId: candidate.id
          }
        });
      }

      await tx.testInvitation.delete({
        where: { id: invitation.id }
      });
    });

    res.json({ message: 'Candidate removed from test successfully' });
  } catch (error) {
    console.error('Delete test invitation candidate error:', error);
    res.status(500).json({ error: getErrorMessage(error) });
  }
}
