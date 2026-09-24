-- Phase 2: Add 4-dimensional scoring and audit confidence to AeoSnapshot
-- All columns are nullable with defaults so existing rows are unaffected.

-- AeoSnapshot: dimension scores (0–100 each)
ALTER TABLE "AeoSnapshot" ADD COLUMN "technicalReadiness"  INTEGER DEFAULT 0;
ALTER TABLE "AeoSnapshot" ADD COLUMN "contentReadiness"    INTEGER DEFAULT 0;
ALTER TABLE "AeoSnapshot" ADD COLUMN "aiVisibility"        INTEGER DEFAULT 0;
ALTER TABLE "AeoSnapshot" ADD COLUMN "citationQuality"     INTEGER DEFAULT 0;

-- AeoSnapshot: audit confidence metadata
ALTER TABLE "AeoSnapshot" ADD COLUMN "confidenceLevel"     TEXT    DEFAULT 'low';
ALTER TABLE "AeoSnapshot" ADD COLUMN "confidenceScore"     INTEGER DEFAULT 0;
ALTER TABLE "AeoSnapshot" ADD COLUMN "successfulProviders" INTEGER DEFAULT 0;
ALTER TABLE "AeoSnapshot" ADD COLUMN "totalProviders"      INTEGER DEFAULT 0;

-- AeoReport: structured JSON for full dimension + confidence objects
ALTER TABLE "AeoReport" ADD COLUMN "dimensions"      JSONB;
ALTER TABLE "AeoReport" ADD COLUMN "auditConfidence"  JSONB;
