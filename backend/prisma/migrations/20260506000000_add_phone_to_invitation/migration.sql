-- Add phone field to TestInvitation
ALTER TABLE "TestInvitation" ADD COLUMN IF NOT EXISTS "phone" TEXT;
