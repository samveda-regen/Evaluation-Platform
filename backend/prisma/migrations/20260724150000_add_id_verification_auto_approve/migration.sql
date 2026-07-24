-- Per-test auto-approve gate and threshold for ID verification. When autoApproveId
-- is enabled, a face-match score at/above the threshold auto-verifies the candidate
-- instead of routing to the admin queue. A null threshold falls back to the
-- ID_VERIFICATION_AUTO_APPROVE_THRESHOLD env default at the service layer.
ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "autoApproveId" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "idVerificationAutoApproveThreshold" DOUBLE PRECISION;
