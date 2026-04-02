-- Add ownership columns if they do not exist.
ALTER TABLE "MCQQuestion" ADD COLUMN IF NOT EXISTS "adminId" TEXT;
ALTER TABLE "CodingQuestion" ADD COLUMN IF NOT EXISTS "adminId" TEXT;

-- Backfill MCQ ownership from linked tests.
UPDATE "MCQQuestion" q
SET "adminId" = s."adminId"
FROM (
  SELECT eq."mcqQuestionId" AS qid, MIN(e."adminId") AS "adminId"
  FROM "TestQuestion" eq
  JOIN "Test" e ON e.id = eq."testId"
  WHERE eq."mcqQuestionId" IS NOT NULL
  GROUP BY eq."mcqQuestionId"
) s
WHERE q.id = s.qid
  AND q."adminId" IS NULL;

-- Backfill Coding ownership from linked tests.
UPDATE "CodingQuestion" q
SET "adminId" = s."adminId"
FROM (
  SELECT eq."codingQuestionId" AS qid, MIN(e."adminId") AS "adminId"
  FROM "TestQuestion" eq
  JOIN "Test" e ON e.id = eq."testId"
  WHERE eq."codingQuestionId" IS NOT NULL
  GROUP BY eq."codingQuestionId"
) s
WHERE q.id = s.qid
  AND q."adminId" IS NULL;

-- For unlinked library entries, assign to earliest admin to keep data visible.
UPDATE "MCQQuestion"
SET "adminId" = (
  SELECT id FROM "Admin" ORDER BY "createdAt" ASC LIMIT 1
)
WHERE "adminId" IS NULL;

UPDATE "CodingQuestion"
SET "adminId" = (
  SELECT id FROM "Admin" ORDER BY "createdAt" ASC LIMIT 1
)
WHERE "adminId" IS NULL;

-- Add indexes for ownership filters.
CREATE INDEX IF NOT EXISTS "MCQQuestion_adminId_idx" ON "MCQQuestion" ("adminId");
CREATE INDEX IF NOT EXISTS "CodingQuestion_adminId_idx" ON "CodingQuestion" ("adminId");

-- Add foreign keys if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MCQQuestion_adminId_fkey'
  ) THEN
    ALTER TABLE "MCQQuestion"
    ADD CONSTRAINT "MCQQuestion_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "Admin"("id")
    ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CodingQuestion_adminId_fkey'
  ) THEN
    ALTER TABLE "CodingQuestion"
    ADD CONSTRAINT "CodingQuestion_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "Admin"("id")
    ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;
