-- Add DetectedService table and serviceId (nullable) to Competitor.
-- Existing competitors are unaffected — serviceId defaults to NULL.

CREATE TABLE IF NOT EXISTS "DetectedService" (
    "id"        TEXT NOT NULL,
    "siteId"    TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "label"     TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DetectedService_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DetectedService_siteId_name_key" UNIQUE ("siteId", "name")
);

CREATE INDEX IF NOT EXISTS "DetectedService_siteId_idx" ON "DetectedService"("siteId");

ALTER TABLE "DetectedService"
    ADD CONSTRAINT "DetectedService_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add nullable serviceId to Competitor (backward-compatible)
ALTER TABLE "Competitor"
    ADD COLUMN IF NOT EXISTS "serviceId" TEXT;

ALTER TABLE "Competitor"
    ADD CONSTRAINT "Competitor_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "DetectedService"("id") ON DELETE SET NULL ON UPDATE CASCADE;
