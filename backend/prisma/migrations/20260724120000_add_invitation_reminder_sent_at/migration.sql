-- Tracks whether a "test closes soon" reminder has already been emailed to an
-- invited candidate who hasn't started yet, so the reminder sweep sends at most once.
ALTER TABLE "TestInvitation" ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3);
