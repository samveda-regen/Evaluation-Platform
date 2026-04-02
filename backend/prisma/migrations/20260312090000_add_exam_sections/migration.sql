-- CreateTable
CREATE TABLE "TestSection" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "questionsPerCandidate" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "TestSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAttemptQuestion" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "testQuestionId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,

    CONSTRAINT "TestAttemptQuestion_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "TestQuestion" ADD COLUMN     "sectionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TestSection_testId_orderIndex_key" ON "TestSection"("testId", "orderIndex");

-- CreateIndex
CREATE INDEX "TestSection_testId_idx" ON "TestSection"("testId");

-- CreateIndex
CREATE UNIQUE INDEX "TestAttemptQuestion_attemptId_testQuestionId_key" ON "TestAttemptQuestion"("attemptId", "testQuestionId");

-- CreateIndex
CREATE UNIQUE INDEX "TestAttemptQuestion_attemptId_orderIndex_key" ON "TestAttemptQuestion"("attemptId", "orderIndex");

-- CreateIndex
CREATE INDEX "TestAttemptQuestion_attemptId_idx" ON "TestAttemptQuestion"("attemptId");

-- CreateIndex
CREATE INDEX "TestQuestion_sectionId_idx" ON "TestQuestion"("sectionId");

-- AddForeignKey
ALTER TABLE "TestSection" ADD CONSTRAINT "TestSection_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "TestSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAttemptQuestion" ADD CONSTRAINT "TestAttemptQuestion_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "TestAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAttemptQuestion" ADD CONSTRAINT "TestAttemptQuestion_testQuestionId_fkey" FOREIGN KEY ("testQuestionId") REFERENCES "TestQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
