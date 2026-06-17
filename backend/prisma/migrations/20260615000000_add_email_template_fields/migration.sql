-- Add email template fields to Test table
-- These columns power the Email Insights page custom templates for invite and confirmation emails.
ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "inviteEmailSubject" TEXT;
ALTER ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "confirmEmailBody" TEXT;
TABLE "Test" ADD COLUMN IF NOT EXISTS "inviteEmailBody" TEXT;
ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "confirmEmailSubject" TEXT;
