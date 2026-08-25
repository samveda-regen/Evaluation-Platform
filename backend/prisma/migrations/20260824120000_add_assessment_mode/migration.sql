ALTER TABLE "Test"
ADD COLUMN IF NOT EXISTS "assessmentMode" TEXT NOT NULL DEFAULT 'SEB';

ALTER TABLE "Test"
ADD COLUMN IF NOT EXISTS "normalBrowserInviteEmailSubject" TEXT,
ADD COLUMN IF NOT EXISTS "normalBrowserInviteEmailBody" TEXT,
ADD COLUMN IF NOT EXISTS "normalBrowserConfirmEmailSubject" TEXT,
ADD COLUMN IF NOT EXISTS "normalBrowserConfirmEmailBody" TEXT,
ADD COLUMN IF NOT EXISTS "normalBrowserReminderEmailSubject" TEXT,
ADD COLUMN IF NOT EXISTS "normalBrowserReminderEmailBody" TEXT;
