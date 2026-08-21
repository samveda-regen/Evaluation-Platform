ALTER TABLE "ProctorRecording"
ADD COLUMN "recordingKey" TEXT,
ADD COLUMN "egressId" TEXT;

CREATE UNIQUE INDEX "ProctorRecording_recordingKey_key"
ON "ProctorRecording"("recordingKey");

CREATE UNIQUE INDEX "ProctorRecording_egressId_key"
ON "ProctorRecording"("egressId");

CREATE INDEX "ProctorRecording_sessionId_status_idx"
ON "ProctorRecording"("sessionId", "status");
