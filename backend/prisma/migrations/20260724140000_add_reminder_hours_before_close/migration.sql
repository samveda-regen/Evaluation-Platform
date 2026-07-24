-- Per-test override for how many hours before the access window closes the
-- reminder sweep should email candidates who haven't started yet.
ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "reminderHoursBeforeClose" INTEGER NOT NULL DEFAULT 24;
