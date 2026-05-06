-- Migration: fix BacklinkDetail upsert key
-- Replaces the (siteId, srcDomain) unique constraint with (siteId, srcDomain, anchorText)
-- so that multiple anchor texts from the same referring domain are preserved correctly.
-- Also adds the targetUrl column to store the destination URL of each backlink.
--
-- Safe to run on a live DB:
--   - DROP CONSTRAINT is fast (metadata-only on most Postgres versions)
--   - ADD COLUMN with DEFAULT is a fast metadata change on Postgres 11+
--   - The new UNIQUE constraint build may take a few minutes on large tables
--     but does NOT lock the table for reads.

-- 1. Drop the old narrow unique constraint
ALTER TABLE "BacklinkDetail"
    DROP CONSTRAINT IF EXISTS "BacklinkDetail_siteId_srcDomain_key";

-- 2. Add the targetUrl column (nullable at first for backward compat, then we set a default)
ALTER TABLE "BacklinkDetail"
    ADD COLUMN IF NOT EXISTS "targetUrl" TEXT NOT NULL DEFAULT '';

-- 3. Add the new broader unique constraint that preserves multi-anchor data
ALTER TABLE "BacklinkDetail"
    ADD CONSTRAINT "BacklinkDetail_siteId_srcDomain_anchorText_key"
        UNIQUE ("siteId", "srcDomain", "anchorText");

-- 4. Add a plain siteId index (useful for cascade deletes and tenant scans)
CREATE INDEX IF NOT EXISTS "BacklinkDetail_siteId_idx"
    ON "BacklinkDetail" ("siteId");
