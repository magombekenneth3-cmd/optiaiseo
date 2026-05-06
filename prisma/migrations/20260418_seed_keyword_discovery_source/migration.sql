ALTER TABLE "SeedKeyword"
  ADD COLUMN IF NOT EXISTS "source"       TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "discoveredAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "SeedKeyword_source_discoveredAt_idx"
  ON "SeedKeyword" ("siteId", "source", "discoveredAt");

UPDATE "SeedKeyword" SET "source" = 'manual' WHERE "source" IS NULL;
