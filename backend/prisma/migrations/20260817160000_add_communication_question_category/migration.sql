-- CreateEnum
CREATE TYPE "CommunicationSubType" AS ENUM ('WRITTEN', 'LISTENING', 'READING', 'SPEAKING');

-- CreateEnum
CREATE TYPE "WrittenStimulusType" AS ENUM ('NONE', 'IMAGE', 'AUDIO');

-- AlterEnum
ALTER TYPE "QuestionRepositoryCategory" ADD VALUE 'COMMUNICATION';

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "communicationQuestionId" TEXT;

-- AlterTable
ALTER TABLE "TestQuestion" ADD COLUMN     "communicationQuestionId" TEXT;

-- CreateTable
CREATE TABLE "ReadingPassage" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "passageText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "adminId" TEXT,

    CONSTRAINT "ReadingPassage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationQuestion" (
    "id" TEXT NOT NULL,
    "source" "QuestionSource" NOT NULL DEFAULT 'CUSTOM',
    "repositoryCategory" "QuestionRepositoryCategory" NOT NULL DEFAULT 'COMMUNICATION',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "subType" "CommunicationSubType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "marks" INTEGER NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT 'medium',
    "topic" TEXT,
    "tags" TEXT,
    "stimulusType" "WrittenStimulusType",
    "evaluationNotes" TEXT,
    "options" TEXT,
    "correctAnswers" TEXT,
    "explanation" TEXT,
    "isMultipleChoice" BOOLEAN NOT NULL DEFAULT false,
    "replayLimit" INTEGER DEFAULT 1,
    "allowRewind" BOOLEAN DEFAULT true,
    "allowSpeedChange" BOOLEAN DEFAULT true,
    "fixedPlaybackSpeed" DOUBLE PRECISION DEFAULT 1.0,
    "passageId" TEXT,
    "recordingTimeLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "adminId" TEXT,

    CONSTRAINT "CommunicationQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationAnswer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answerText" TEXT,
    "selectedOptions" TEXT,
    "audioAssetId" TEXT,
    "transcript" TEXT,
    "replayCount" INTEGER DEFAULT 0,
    "isCorrect" BOOLEAN,
    "marksObtained" DOUBLE PRECISION,
    "gradingDetail" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReadingPassage_adminId_idx" ON "ReadingPassage"("adminId");

-- CreateIndex
CREATE INDEX "CommunicationQuestion_source_idx" ON "CommunicationQuestion"("source");

-- CreateIndex
CREATE INDEX "CommunicationQuestion_repositoryCategory_idx" ON "CommunicationQuestion"("repositoryCategory");

-- CreateIndex
CREATE INDEX "CommunicationQuestion_subType_idx" ON "CommunicationQuestion"("subType");

-- CreateIndex
CREATE INDEX "CommunicationQuestion_difficulty_idx" ON "CommunicationQuestion"("difficulty");

-- CreateIndex
CREATE INDEX "CommunicationQuestion_isEnabled_idx" ON "CommunicationQuestion"("isEnabled");

-- CreateIndex
CREATE INDEX "CommunicationQuestion_adminId_idx" ON "CommunicationQuestion"("adminId");

-- CreateIndex
CREATE INDEX "CommunicationQuestion_passageId_idx" ON "CommunicationQuestion"("passageId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationAnswer_attemptId_questionId_key" ON "CommunicationAnswer"("attemptId", "questionId");

-- AddForeignKey
ALTER TABLE "ReadingPassage" ADD CONSTRAINT "ReadingPassage_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationQuestion" ADD CONSTRAINT "CommunicationQuestion_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "ReadingPassage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationQuestion" ADD CONSTRAINT "CommunicationQuestion_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_communicationQuestionId_fkey" FOREIGN KEY ("communicationQuestionId") REFERENCES "CommunicationQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationAnswer" ADD CONSTRAINT "CommunicationAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "TestAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationAnswer" ADD CONSTRAINT "CommunicationAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CommunicationQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_communicationQuestionId_fkey" FOREIGN KEY ("communicationQuestionId") REFERENCES "CommunicationQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
