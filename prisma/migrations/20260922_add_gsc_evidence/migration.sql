-- AlterTable: Add gscEvidence column to Blog
-- Purely additive. No backfill required.
-- Existing blogs remain with gscEvidence = NULL.
-- Non-GSC pipelines (USER_KEYWORD, COMPETITOR_GAP, etc.) leave this NULL.
-- GSC_GAP blogs store a validated GscOpportunityEvidence JSON object.

ALTER TABLE "Blog" ADD COLUMN "gscEvidence" JSONB;
