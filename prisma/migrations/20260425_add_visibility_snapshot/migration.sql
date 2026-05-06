-- Migration: 20260425_add_visibility_snapshot
-- Adds VisibilitySnapshot table, difficulty column to RankSnapshot,
-- and unique constraint on SerpFeature(siteId, keyword)

-- ── 1. VisibilitySnapshot ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "VisibilitySnapshot" (
    "id"             TEXT        NOT NULL,
    "siteId"         TEXT        NOT NULL,
    "date"           TEXT        NOT NULL,
    "score"          DOUBLE PRECISION NOT NULL,
    "top3Pct"        DOUBLE PRECISION NOT NULL,
    "top10Pct"       DOUBLE PRECISION NOT NULL,
    "keywordsUsed"   INTEGER     NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisibilitySnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VisibilitySnapshot_siteId_date_key" UNIQUE ("siteId", "date"),
    CONSTRAINT "VisibilitySnapshot_siteId_fkey"
        FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "VisibilitySnapshot_siteId_date_idx"
    ON "VisibilitySnapshot"("siteId", "date" DESC);

-- ── 2. RankSnapshot — add difficulty column ───────────────────────────────────
ALTER TABLE "RankSnapshot" ADD COLUMN IF NOT EXISTS "difficulty" INTEGER;

-- ── 3. SerpFeature — unique constraint for upsert idempotency ────────────────
-- Only add if it doesn't exist yet.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'SerpFeature'
          AND indexname  = 'SerpFeature_siteId_keyword_key'
    ) THEN
        CREATE UNIQUE INDEX "SerpFeature_siteId_keyword_key"
            ON "SerpFeature"("siteId", "keyword");
    END IF;
END $$;
