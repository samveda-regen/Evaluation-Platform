-- Speaking questions: admin-configurable cap on how many times a candidate may re-record their
-- answer (null/unset = unlimited, matching existing behavior for questions created before this).
ALTER TABLE "CommunicationQuestion" ADD COLUMN "retakeLimit" INTEGER;

-- Server-side telemetry/enforcement-state counterpart, mirroring CommunicationAnswer.replayCount.
ALTER TABLE "CommunicationAnswer" ADD COLUMN "retakeCount" INTEGER DEFAULT 0;
