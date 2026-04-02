-- Add canonical session metadata blob
ALTER TABLE "ProctorSession" ADD COLUMN "sessionMetadata" JSONB;

-- Store per-session telemetry payloads (analysis + external events)
CREATE TABLE "ProctorTelemetry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'analysis',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProctorTelemetry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProctorTelemetry_sessionId_idx" ON "ProctorTelemetry"("sessionId");
CREATE INDEX "ProctorTelemetry_createdAt_idx" ON "ProctorTelemetry"("createdAt");

ALTER TABLE "ProctorTelemetry" ADD CONSTRAINT "ProctorTelemetry_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "ProctorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
