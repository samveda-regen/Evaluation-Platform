-- Per-test customizable subject/body for the "haven't started yet" reminder
-- email, mirroring the existing invite/confirm email template columns.
ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "reminderEmailSubject" TEXT;
ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "reminderEmailBody" TEXT;
