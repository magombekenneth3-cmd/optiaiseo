ALTER TABLE "KeywordSerpAnalysis"
  ADD COLUMN IF NOT EXISTS "yourPageH2s"       JSONB        NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "clientDR"           INTEGER,
  ADD COLUMN IF NOT EXISTS "clientRDs"          INTEGER,
  ADD COLUMN IF NOT EXISTS "toxicCount"         INTEGER,
  ADD COLUMN IF NOT EXISTS "topAnchors"         JSONB        NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "newLastWeek"        INTEGER,
  ADD COLUMN IF NOT EXISTS "lostLastWeek"       INTEGER,
  ADD COLUMN IF NOT EXISTS "dofollowRatio"      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "userPageScrapedOk"  BOOLEAN      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "status"             TEXT         NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "errorMessage"       TEXT,
  ADD COLUMN IF NOT EXISTS "completedAt"        TIMESTAMP(3);

-- Index on status so the polling query (status != 'COMPLETED') stays fast
CREATE INDEX IF NOT EXISTS "KeywordSerpAnalysis_status_idx"
  ON "KeywordSerpAnalysis"("status");
