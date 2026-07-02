import { Response } from 'express';
import type { AuthenticatedRequest } from '../types/index.js';
import prisma from '../utils/db.js';

type RawNotification = {
  id: string;
  adminId: string;
  type: string;
  attemptId: string | null;
  testId: string | null;
  testName: string;
  candidateName: string;
  candidateId: string | null;
  autoSubmit: boolean;
  timestamp: Date;
  isRead: boolean;
  createdAt: Date;
};

export async function ensureNotificationTable(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "Notification" (
      "id"            TEXT NOT NULL,
      "adminId"       TEXT NOT NULL,
      "type"          TEXT NOT NULL DEFAULT 'completed',
      "attemptId"     TEXT,
      "testId"        TEXT,
      "testName"      TEXT NOT NULL DEFAULT '',
      "candidateName" TEXT NOT NULL DEFAULT '',
      "candidateId"   TEXT,
      "autoSubmit"    BOOLEAN NOT NULL DEFAULT false,
      "timestamp"     TIMESTAMPTZ NOT NULL DEFAULT now(),
      "isRead"        BOOLEAN NOT NULL DEFAULT false,
      "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
    )
  `;
  await prisma.$executeRaw`ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "candidateId" TEXT`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Notification_adminId_idx" ON "Notification" ("adminId")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification" ("createdAt" DESC)`;
}

export async function saveNotification(payload: {
  adminId: string;
  type: 'started' | 'completed' | 'verification_pending';
  attemptId: string;
  testId: string;
  testName: string;
  candidateName: string;
  candidateId?: string;
  autoSubmit?: boolean;
}): Promise<void> {
  try {
    const id = `${payload.type}-${payload.attemptId || payload.candidateId}`;
    const autoSubmit = payload.autoSubmit ?? false;
    await prisma.$executeRaw`
      INSERT INTO "Notification" (id, "adminId", type, "attemptId", "testId", "testName", "candidateName", "candidateId", "autoSubmit", timestamp, "isRead", "createdAt")
      VALUES (
        ${id},
        ${payload.adminId},
        ${payload.type},
        ${payload.attemptId},
        ${payload.testId},
        ${payload.testName},
        ${payload.candidateName},
        ${payload.candidateId ?? null},
        ${autoSubmit},
        now(),
        false,
        now()
      )
      ON CONFLICT ("id") DO NOTHING
    `;
  } catch (err) {
    console.error('Failed to save notification:', err);
  }
}

export async function getNotifications(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const adminId = req.admin!.id;
    const rows = await prisma.$queryRaw<RawNotification[]>`
      SELECT id, "adminId", type, "attemptId", "testId", "testName", "candidateName", "candidateId",
             "autoSubmit", timestamp, "isRead", "createdAt"
      FROM "Notification"
      WHERE "adminId" = ${adminId}
      ORDER BY "createdAt" DESC
      LIMIT 300
    `;
    res.json({
      notifications: rows.map(r => ({
        id: r.id,
        attemptId: r.attemptId,
        testId: r.testId,
        testName: r.testName,
        candidateName: r.candidateName,
        candidateId: r.candidateId,
        autoSubmit: r.autoSubmit,
        type: r.type,
        timestamp: r.timestamp,
        isRead: r.isRead,
      })),
    });
  } catch (err) {
    console.error('getNotifications error:', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
}

export async function markAllRead(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const adminId = req.admin!.id;
    await prisma.$executeRaw`UPDATE "Notification" SET "isRead" = true WHERE "adminId" = ${adminId}`;
    res.json({ success: true });
  } catch (err) {
    console.error('markAllRead error:', err);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
}

export async function clearAllNotifications(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const adminId = req.admin!.id;
    await prisma.$executeRaw`DELETE FROM "Notification" WHERE "adminId" = ${adminId}`;
    res.json({ success: true });
  } catch (err) {
    console.error('clearAllNotifications error:', err);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
}

export async function deleteOneNotification(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const adminId = req.admin!.id;
    const { id } = req.params;
    await prisma.$executeRaw`DELETE FROM "Notification" WHERE id = ${id} AND "adminId" = ${adminId}`;
    res.json({ success: true });
  } catch (err) {
    console.error('deleteOneNotification error:', err);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
}
