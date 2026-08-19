-- Migration: fix_site_cascade_missing_fks
-- 
-- Two models (CompetitorAlertLog, EvidenceSnapshot) stored siteId as a plain
-- String with no foreign key constraint, causing orphan rows to persist after
-- a Site was deleted.  This migration:
--   1. Deletes any existing orphan rows (pre-flight cleanup).
--   2. Adds NOT NULL FK constraints with ON DELETE CASCADE so that future
--      site deletions automatically remove the associated rows.

-- ── Step 1: remove existing orphan rows ──────────────────────────────────────

DELETE FROM "CompetitorAlertLog"
WHERE "siteId" NOT IN (SELECT "id" FROM "Site");

DELETE FROM "EvidenceSnapshot"
WHERE "siteId" NOT IN (SELECT "id" FROM "Site");

-- ── Step 2: add foreign key constraints ──────────────────────────────────────

-- CompetitorAlertLog.siteId → Site.id (CASCADE DELETE)
ALTER TABLE "CompetitorAlertLog"
  ADD CONSTRAINT "CompetitorAlertLog_siteId_fkey"
  FOREIGN KEY ("siteId")
  REFERENCES "Site"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- EvidenceSnapshot.siteId → Site.id (CASCADE DELETE)
ALTER TABLE "EvidenceSnapshot"
  ADD CONSTRAINT "EvidenceSnapshot_siteId_fkey"
  FOREIGN KEY ("siteId")
  REFERENCES "Site"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
