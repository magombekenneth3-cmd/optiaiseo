-- Phase 3: Persistent query sets for reproducible audits

-- AeoQuerySet: versioned groupings of tracked queries
CREATE TABLE "AeoQuerySet" (
    "id"          TEXT NOT NULL,
    "siteId"      TEXT NOT NULL,
    "version"     INTEGER NOT NULL DEFAULT 1,
    "tier"        TEXT NOT NULL DEFAULT 'standard',
    "queryCount"  INTEGER NOT NULL DEFAULT 0,
    "generatedBy" TEXT NOT NULL DEFAULT 'auto',
    "fingerprint" TEXT,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"   TIMESTAMP(3),

    CONSTRAINT "AeoQuerySet_pkey" PRIMARY KEY ("id")
);

-- Link TrackedQuery to AeoQuerySet (nullable FK)
ALTER TABLE "TrackedQuery" ADD COLUMN "querySetId" TEXT;

-- Foreign keys
ALTER TABLE "AeoQuerySet"
  ADD CONSTRAINT "AeoQuerySet_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TrackedQuery"
  ADD CONSTRAINT "TrackedQuery_querySetId_fkey"
  FOREIGN KEY ("querySetId") REFERENCES "AeoQuerySet"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE UNIQUE INDEX "AeoQuerySet_siteId_fingerprint_key" ON "AeoQuerySet"("siteId", "fingerprint");
CREATE INDEX "AeoQuerySet_siteId_isActive_idx" ON "AeoQuerySet"("siteId", "isActive");
CREATE INDEX "AeoQuerySet_siteId_tier_idx" ON "AeoQuerySet"("siteId", "tier");
CREATE INDEX "TrackedQuery_querySetId_idx" ON "TrackedQuery"("querySetId");
