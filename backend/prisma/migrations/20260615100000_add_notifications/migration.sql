CREATE TABLE IF NOT EXISTS "Notification" (
  "id"            TEXT NOT NULL,
  "adminId"       TEXT NOT NULL,
  "type"          TEXT NOT NULL DEFAULT 'completed',
  "attemptId"     TEXT,
  "testId"        TEXT,
  "testName"      TEXT NOT NULL DEFAULT '',
  "candidateName" TEXT NOT NULL DEFAULT '',
  "autoSubmit"    BOOLEAN NOT NULL DEFAULT false,
  "timestamp"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "isRead"        BOOLEAN NOT NULL DEFAULT false,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Notification_adminId_idx"  ON "Notification" ("adminId");
CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification" ("createdAt" DESC);
