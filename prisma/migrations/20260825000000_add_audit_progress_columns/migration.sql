-- Add explicit progress tracking columns to Audit.
-- These replace the broken pattern of marking COMPLETED immediately after fan-out.
ALTER TABLE "Audit" ADD COLUMN IF NOT EXISTS "totalPages"     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Audit" ADD COLUMN IF NOT EXISTS "completedPages" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Audit" ADD COLUMN IF NOT EXISTS "failedPages"    INTEGER NOT NULL DEFAULT 0;
