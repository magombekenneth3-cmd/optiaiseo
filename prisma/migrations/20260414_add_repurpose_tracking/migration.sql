-- prisma/migrations/20260414_add_repurpose_tracking/migration.sql
--
-- Extends AeoEvent to track which repurposed content formats generated
-- AI citations. Enables post-repurpose citation attribution.
--
-- The AeoEvent.metadata Json column already exists and accepts arbitrary
-- JSON — no column additions needed for basic tracking.
--
-- Queryable repurposeFormat column for analytics:
--   Values: 'linkedin' | 'thread' | 'youtube' | 'reddit' | 'podcast' | NULL
--   NULL means the event was not repurpose-related.

ALTER TABLE "AeoEvent" ADD COLUMN IF NOT EXISTS "repurposeFormat" TEXT;

-- Partial index: only indexes rows where repurposeFormat is set.
-- Keeps the index small — most AeoEvent rows are not repurpose events.
CREATE INDEX IF NOT EXISTS "AeoEvent_repurposeFormat_idx"
  ON "AeoEvent" ("siteId", "repurposeFormat")
  WHERE "repurposeFormat" IS NOT NULL;
