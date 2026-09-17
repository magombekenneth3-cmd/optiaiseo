-- Make backlink records link-level rather than domain/anchor-level, preserve
-- legacy rows, and retain accurate, retry-safe gained/lost domain events.

ALTER TABLE "BacklinkDetail"
  ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "linkKey" TEXT,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';

-- Legacy records do not retain a source URL. Give them a stable unique key so
-- the migration is lossless; the next complete sync will replace them with
-- real link-level records.
UPDATE "BacklinkDetail"
SET "linkKey" = CONCAT('legacy:', "id")
WHERE "linkKey" IS NULL OR "linkKey" = '';

ALTER TABLE "BacklinkDetail"
  ALTER COLUMN "linkKey" SET NOT NULL;

ALTER TABLE "BacklinkDetail"
  DROP CONSTRAINT IF EXISTS "BacklinkDetail_siteId_srcDomain_anchorText_key";
DROP INDEX IF EXISTS "BacklinkDetail_siteId_srcDomain_anchorText_key";

ALTER TABLE "BacklinkDetail"
  DROP CONSTRAINT IF EXISTS "BacklinkDetail_siteId_linkKey_key";

ALTER TABLE "BacklinkDetail"
  ADD CONSTRAINT "BacklinkDetail_siteId_linkKey_key" UNIQUE ("siteId", "linkKey");

CREATE INDEX IF NOT EXISTS "BacklinkDetail_siteId_status_idx"
  ON "BacklinkDetail" ("siteId", "status");

ALTER TABLE "BacklinkAlert"
  DROP CONSTRAINT IF EXISTS "BacklinkAlert_siteId_domain_type_key";
DROP INDEX IF EXISTS "BacklinkAlert_siteId_domain_type_key";

ALTER TABLE "BacklinkAlert"
  ADD COLUMN IF NOT EXISTS "eventKey" TEXT;

UPDATE "BacklinkAlert"
SET "eventKey" = CONCAT('legacy:', "id")
WHERE "eventKey" IS NULL OR "eventKey" = '';

ALTER TABLE "BacklinkAlert"
  ALTER COLUMN "eventKey" SET NOT NULL;

ALTER TABLE "BacklinkAlert"
  DROP CONSTRAINT IF EXISTS "BacklinkAlert_siteId_eventKey_key";

ALTER TABLE "BacklinkAlert"
  ADD CONSTRAINT "BacklinkAlert_siteId_eventKey_key"
  UNIQUE ("siteId", "eventKey");

CREATE INDEX IF NOT EXISTS "BacklinkAlert_siteId_type_detectedAt_idx"
  ON "BacklinkAlert" ("siteId", "type", "detectedAt" DESC);

-- BacklinkDetail stores link-level observations and may be bounded. Keep a
-- separate domain inventory so a limited details page can never manufacture
-- gained/lost alerts.
CREATE TABLE IF NOT EXISTS "BacklinkReferringDomain" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "domainRating" DOUBLE PRECISION,
  "backlinks" INTEGER NOT NULL DEFAULT 0,
  "spamScore" DOUBLE PRECISION,
  "firstSeen" TIMESTAMP(3),
  "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'active',
  CONSTRAINT "BacklinkReferringDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BacklinkReferringDomain_siteId_domain_key"
  ON "BacklinkReferringDomain" ("siteId", "domain");
CREATE INDEX IF NOT EXISTS "BacklinkReferringDomain_siteId_status_idx"
  ON "BacklinkReferringDomain" ("siteId", "status");
CREATE INDEX IF NOT EXISTS "BacklinkReferringDomain_siteId_lastSeen_idx"
  ON "BacklinkReferringDomain" ("siteId", "lastSeen");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BacklinkReferringDomain_siteId_fkey') THEN
    ALTER TABLE "BacklinkReferringDomain"
      ADD CONSTRAINT "BacklinkReferringDomain_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- A complete empty scan is meaningful: it is a baseline, not an unscanned
-- site. Keep that state separately from the per-domain inventory.
CREATE TABLE IF NOT EXISTS "BacklinkInventory" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "initializedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastCompletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "totalDomains" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "BacklinkInventory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BacklinkInventory_siteId_key"
  ON "BacklinkInventory" ("siteId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BacklinkInventory_siteId_fkey') THEN
    ALTER TABLE "BacklinkInventory"
      ADD CONSTRAINT "BacklinkInventory_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
