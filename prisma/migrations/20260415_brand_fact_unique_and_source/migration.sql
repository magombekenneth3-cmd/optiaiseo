-- prisma/migrations/20260415_brand_fact_unique_and_source/migration.sql
--
-- Adds a unique constraint on (siteId, factType, value) to BrandFact so that
-- entity-kg-sync.ts can use a proper prisma.brandFact.upsert() keyed on this
-- triple instead of the fragile findFirst + create dance that caused duplicates
-- on every audit run.
--
-- Also ensures the sourceUrl column exists (it was added in the Prisma schema
-- but may be missing on older databases that were never re-migrated).

-- Ensure sourceUrl column exists (idempotent)
ALTER TABLE "BrandFact" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT;

-- Remove duplicate rows before adding the constraint so the migration does not
-- fail on existing data. Keeps the row with the most recent updatedAt.
--
-- Uncomment and run manually if you have existing duplicates:
-- DELETE FROM "BrandFact" a
-- USING "BrandFact" b
-- WHERE a."siteId" = b."siteId"
--   AND a."factType" = b."factType"
--   AND a."value" = b."value"
--   AND a."updatedAt" < b."updatedAt";

-- Add unique constraint (idempotent via IF NOT EXISTS on the index)
CREATE UNIQUE INDEX IF NOT EXISTS "BrandFact_siteId_factType_value_key"
  ON "BrandFact" ("siteId", "factType", "value");
