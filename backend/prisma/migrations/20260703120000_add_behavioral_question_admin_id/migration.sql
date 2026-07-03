-- Custom behavioral questions had no owner, so every admin's custom
-- behavioral questions were visible/editable by every other admin.
-- Adds the same adminId ownership column MCQQuestion/CodingQuestion already have.
ALTER TABLE "BehavioralQuestion" ADD COLUMN IF NOT EXISTS "adminId" TEXT;
CREATE INDEX IF NOT EXISTS "BehavioralQuestion_adminId_idx" ON "BehavioralQuestion"("adminId");
ALTER TABLE "BehavioralQuestion" ADD CONSTRAINT "BehavioralQuestion_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
