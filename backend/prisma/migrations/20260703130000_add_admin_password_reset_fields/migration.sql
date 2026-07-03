-- Forgot-password flow: only the SHA-256 hash of the reset token is stored,
-- never the raw token, alongside a short expiry so links go stale.
ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS "resetPasswordTokenHash" TEXT;
ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS "resetPasswordExpiresAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Admin_resetPasswordTokenHash_idx" ON "Admin"("resetPasswordTokenHash");
