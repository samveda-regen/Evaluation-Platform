-- Adds a short, human-typeable access code to invitations, separate from the
-- long random token used in the clickable invite link.
ALTER TABLE "TestInvitation" ADD COLUMN IF NOT EXISTS "accessCode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "TestInvitation_accessCode_key" ON "TestInvitation"("accessCode");
