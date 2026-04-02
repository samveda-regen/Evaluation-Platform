/*
  Warnings:

  - You are about to drop the column `category` on the `BehavioralQuestion` table. All the data in the column will be lost.
  - You are about to drop the column `skills` on the `BehavioralQuestion` table. All the data in the column will be lost.
  - You are about to drop the column `sourceType` on the `BehavioralQuestion` table. All the data in the column will be lost.
  - The `difficulty` column on the `BehavioralQuestion` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `category` on the `CodingQuestion` table. All the data in the column will be lost.
  - You are about to drop the column `skills` on the `CodingQuestion` table. All the data in the column will be lost.
  - You are about to drop the column `sourceType` on the `CodingQuestion` table. All the data in the column will be lost.
  - The `difficulty` column on the `CodingQuestion` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `category` on the `MCQQuestion` table. All the data in the column will be lost.
  - You are about to drop the column `skills` on the `MCQQuestion` table. All the data in the column will be lost.
  - You are about to drop the column `sourceType` on the `MCQQuestion` table. All the data in the column will be lost.
  - The `difficulty` column on the `MCQQuestion` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `marks` to the `BehavioralQuestion` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "QuestionSource" AS ENUM ('QUESTION_BANK', 'CUSTOM');

-- CreateEnum
CREATE TYPE "QuestionRepositoryCategory" AS ENUM ('CODING', 'MCQ', 'BEHAVIORAL');

-- DropIndex
DROP INDEX "BehavioralQuestion_sourceType_idx";

-- DropIndex
DROP INDEX "BehavioralQuestion_topic_idx";

-- DropIndex
DROP INDEX "CodingQuestion_sourceType_idx";

-- DropIndex
DROP INDEX "CodingQuestion_topic_idx";

-- DropIndex
DROP INDEX "MCQQuestion_sourceType_idx";

-- DropIndex
DROP INDEX "MCQQuestion_topic_idx";

-- AlterTable
ALTER TABLE "BehavioralQuestion" DROP COLUMN "category",
DROP COLUMN "skills",
DROP COLUMN "sourceType",
ADD COLUMN     "expectedAnswer" TEXT,
ADD COLUMN     "marks" INTEGER NOT NULL,
ADD COLUMN     "repositoryCategory" "QuestionRepositoryCategory" NOT NULL DEFAULT 'BEHAVIORAL',
ADD COLUMN     "source" "QuestionSource" NOT NULL DEFAULT 'CUSTOM',
ADD COLUMN     "tags" TEXT,
DROP COLUMN "difficulty",
ADD COLUMN     "difficulty" TEXT NOT NULL DEFAULT 'medium';

-- AlterTable
ALTER TABLE "CandidateIdentity" ADD COLUMN     "documentAuthScore" DOUBLE PRECISION,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "faceMatchScore" DOUBLE PRECISION,
ADD COLUMN     "faceReferenceUrl" TEXT,
ADD COLUMN     "idDocumentNumber" TEXT,
ADD COLUMN     "idDocumentType" TEXT,
ADD COLUMN     "idDocumentUrl" TEXT,
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "livenessScore" DOUBLE PRECISION,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedBy" TEXT;

-- AlterTable
ALTER TABLE "CodingQuestion" DROP COLUMN "category",
DROP COLUMN "skills",
DROP COLUMN "sourceType",
ADD COLUMN     "autoEvaluate" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "repositoryCategory" "QuestionRepositoryCategory" NOT NULL DEFAULT 'CODING',
ADD COLUMN     "source" "QuestionSource" NOT NULL DEFAULT 'CUSTOM',
ADD COLUMN     "tags" TEXT,
DROP COLUMN "difficulty",
ADD COLUMN     "difficulty" TEXT NOT NULL DEFAULT 'medium';

-- AlterTable
ALTER TABLE "TestAnalytics" ADD COLUMN     "averageTimeTaken" INTEGER,
ADD COLUMN     "averageTrustScore" DOUBLE PRECISION,
ADD COLUMN     "fastestCompletion" INTEGER,
ADD COLUMN     "flaggedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "highestScore" DOUBLE PRECISION,
ADD COLUMN     "lastCalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lowestScore" DOUBLE PRECISION,
ADD COLUMN     "medianScore" DOUBLE PRECISION,
ADD COLUMN     "passRate" DOUBLE PRECISION,
ADD COLUMN     "questionDifficulty" TEXT,
ADD COLUMN     "scoreDistribution" TEXT,
ADD COLUMN     "slowestCompletion" INTEGER,
ADD COLUMN     "timeDistribution" TEXT,
ADD COLUMN     "totalViolations" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TestQuestion" ADD COLUMN     "behavioralQuestionId" TEXT;

-- AlterTable
ALTER TABLE "MCQQuestion" DROP COLUMN "category",
DROP COLUMN "skills",
DROP COLUMN "sourceType",
ADD COLUMN     "repositoryCategory" "QuestionRepositoryCategory" NOT NULL DEFAULT 'MCQ',
ADD COLUMN     "source" "QuestionSource" NOT NULL DEFAULT 'CUSTOM',
ADD COLUMN     "tags" TEXT,
DROP COLUMN "difficulty",
ADD COLUMN     "difficulty" TEXT NOT NULL DEFAULT 'medium';

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "duration" INTEGER,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "processingError" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'uploaded',
ADD COLUMN     "storageBucket" TEXT,
ADD COLUMN     "thumbnailUrl" TEXT,
ADD COLUMN     "uploadedBy" TEXT,
ADD COLUMN     "width" INTEGER;

-- AlterTable
ALTER TABLE "PerformanceAnalytics" ADD COLUMN     "aiInsights" TEXT,
ADD COLUMN     "averageTimePerQuestion" INTEGER,
ADD COLUMN     "codingMetrics" TEXT,
ADD COLUMN     "easyAccuracy" DOUBLE PRECISION,
ADD COLUMN     "easyCorrect" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "easyTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hardAccuracy" DOUBLE PRECISION,
ADD COLUMN     "hardCorrect" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hardTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mediumAccuracy" DOUBLE PRECISION,
ADD COLUMN     "mediumCorrect" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mediumTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "overallGrade" TEXT,
ADD COLUMN     "percentile" DOUBLE PRECISION,
ADD COLUMN     "proctoringSummary" TEXT,
ADD COLUMN     "recommendations" TEXT,
ADD COLUMN     "skillAnalysis" TEXT,
ADD COLUMN     "strengths" TEXT,
ADD COLUMN     "topicAnalysis" TEXT,
ADD COLUMN     "trustScore" DOUBLE PRECISION,
ADD COLUMN     "weaknesses" TEXT;

-- DropEnum
DROP TYPE "Difficulty";

-- DropEnum
DROP TYPE "QuestionCategory";

-- DropEnum
DROP TYPE "QuestionSourceType";

-- CreateTable
CREATE TABLE "BehavioralAnswer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answerText" TEXT NOT NULL,
    "marksObtained" DOUBLE PRECISION,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BehavioralAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctorSession" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "cameraEnabled" BOOLEAN NOT NULL DEFAULT false,
    "microphoneEnabled" BOOLEAN NOT NULL DEFAULT false,
    "screenShareEnabled" BOOLEAN NOT NULL DEFAULT false,
    "browserInfo" TEXT,
    "screenResolution" TEXT,
    "deviceFingerprint" TEXT,
    "ipAddress" TEXT,
    "mobileDeviceId" TEXT,
    "mobileVerified" BOOLEAN NOT NULL DEFAULT false,
    "monitorCount" INTEGER NOT NULL DEFAULT 1,
    "externalMonitorDetected" BOOLEAN NOT NULL DEFAULT false,
    "faceVerified" BOOLEAN NOT NULL DEFAULT false,
    "faceMatchScore" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ProctorSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctorEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "confidence" DOUBLE PRECISION,
    "description" TEXT,
    "metadata" TEXT,
    "snapshotUrl" TEXT,
    "audioClipUrl" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration" INTEGER,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewNotes" TEXT,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProctorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctorRecording" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "recordingType" TEXT NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "storageBucket" TEXT,
    "storageKey" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "duration" INTEGER,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'recording',
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProctorRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViolationClip" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "clipUrl" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "violationType" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViolationClip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceSnapshot" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "matchScore" DOUBLE PRECISION,
    "faceCount" INTEGER,
    "gazeDirection" TEXT,
    "emotionData" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileStorage" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "category" TEXT NOT NULL,
    "attemptId" TEXT,
    "questionId" TEXT,
    "candidateId" TEXT,
    "sessionId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileStorage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BehavioralAnswer_attemptId_questionId_key" ON "BehavioralAnswer"("attemptId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProctorSession_attemptId_key" ON "ProctorSession"("attemptId");

-- CreateIndex
CREATE INDEX "FileStorage_category_idx" ON "FileStorage"("category");

-- CreateIndex
CREATE INDEX "FileStorage_attemptId_idx" ON "FileStorage"("attemptId");

-- CreateIndex
CREATE INDEX "FileStorage_questionId_idx" ON "FileStorage"("questionId");

-- CreateIndex
CREATE INDEX "FileStorage_candidateId_idx" ON "FileStorage"("candidateId");

-- CreateIndex
CREATE INDEX "FileStorage_sessionId_idx" ON "FileStorage"("sessionId");

-- CreateIndex
CREATE INDEX "BehavioralQuestion_source_idx" ON "BehavioralQuestion"("source");

-- CreateIndex
CREATE INDEX "BehavioralQuestion_repositoryCategory_idx" ON "BehavioralQuestion"("repositoryCategory");

-- CreateIndex
CREATE INDEX "BehavioralQuestion_difficulty_idx" ON "BehavioralQuestion"("difficulty");

-- CreateIndex
CREATE INDEX "CodingQuestion_source_idx" ON "CodingQuestion"("source");

-- CreateIndex
CREATE INDEX "CodingQuestion_repositoryCategory_idx" ON "CodingQuestion"("repositoryCategory");

-- CreateIndex
CREATE INDEX "CodingQuestion_difficulty_idx" ON "CodingQuestion"("difficulty");

-- CreateIndex
CREATE INDEX "MCQQuestion_source_idx" ON "MCQQuestion"("source");

-- CreateIndex
CREATE INDEX "MCQQuestion_repositoryCategory_idx" ON "MCQQuestion"("repositoryCategory");

-- CreateIndex
CREATE INDEX "MCQQuestion_difficulty_idx" ON "MCQQuestion"("difficulty");

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_behavioralQuestionId_fkey" FOREIGN KEY ("behavioralQuestionId") REFERENCES "BehavioralQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BehavioralAnswer" ADD CONSTRAINT "BehavioralAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "TestAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BehavioralAnswer" ADD CONSTRAINT "BehavioralAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "BehavioralQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorSession" ADD CONSTRAINT "ProctorSession_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "TestAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorEvent" ADD CONSTRAINT "ProctorEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProctorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorRecording" ADD CONSTRAINT "ProctorRecording_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProctorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationClip" ADD CONSTRAINT "ViolationClip_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "ProctorRecording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceSnapshot" ADD CONSTRAINT "FaceSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProctorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
