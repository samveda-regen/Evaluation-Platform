-- Allow multiple TestAttempt rows per (test, candidate) so re-evaluations create
-- a new history row instead of overwriting the previous attempt's data.

-- 1. Add attemptNumber, defaulting existing rows to 1 (their only/first attempt today)
ALTER TABLE "TestAttempt" ADD COLUMN "attemptNumber" INTEGER NOT NULL DEFAULT 1;

-- 2. Drop the old constraint that limited candidates to one attempt per test
DROP INDEX "TestAttempt_testId_candidateId_key";

-- 3. Add the new constraint: unique per (test, candidate, attemptNumber)
CREATE UNIQUE INDEX "TestAttempt_testId_candidateId_attemptNumber_key" ON "TestAttempt"("testId", "candidateId", "attemptNumber");

-- 4. Index to speed up "find latest attempt for this candidate+test" lookups
CREATE INDEX "TestAttempt_testId_candidateId_idx" ON "TestAttempt"("testId", "candidateId");
