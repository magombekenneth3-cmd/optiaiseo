-- Part 3 schema additions
-- MetricSnapshot, BacklinkDetail, HealingOutcome

CREATE TABLE IF NOT EXISTS "MetricSnapshot" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "siteId"         TEXT NOT NULL,
  "capturedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "overallScore"   DOUBLE PRECISION,
  "aeoScore"       DOUBLE PRECISION,
  "coreWebVitals"  DOUBLE PRECISION,
  "schemaScore"    DOUBLE PRECISION,
  "keywordCount"   INTEGER,
  "backlinksCount" INTEGER,
  "organicTraffic" INTEGER,
  CONSTRAINT "MetricSnapshot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "MetricSnapshot_siteId_capturedAt_idx" ON "MetricSnapshot" ("siteId", "capturedAt");

CREATE TABLE IF NOT EXISTS "BacklinkDetail" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "siteId"       TEXT NOT NULL,
  "srcDomain"    TEXT NOT NULL,
  "anchorText"   TEXT NOT NULL,
  "domainRating" DOUBLE PRECISION,
  "isDoFollow"   BOOLEAN NOT NULL DEFAULT true,
  "firstSeen"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeen"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isToxic"      BOOLEAN NOT NULL DEFAULT false,
  "toxicReason"  TEXT,
  CONSTRAINT "BacklinkDetail_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "BacklinkDetail_siteId_srcDomain_anchorText_key" ON "BacklinkDetail" ("siteId", "srcDomain", "anchorText");
CREATE INDEX IF NOT EXISTS "BacklinkDetail_siteId_isToxic_idx" ON "BacklinkDetail" ("siteId", "isToxic");
CREATE INDEX IF NOT EXISTS "BacklinkDetail_siteId_firstSeen_idx" ON "BacklinkDetail" ("siteId", "firstSeen");

CREATE TABLE IF NOT EXISTS "HealingOutcome" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "siteId"        TEXT NOT NULL,
  "healingLogId"  TEXT NOT NULL,
  "issueType"     TEXT NOT NULL,
  "fixAppliedAt"  TIMESTAMP(3) NOT NULL,
  "measuredAt"    TIMESTAMP(3),
  "trafficBefore" INTEGER,
  "trafficAfter"  INTEGER,
  "rankBefore"    DOUBLE PRECISION,
  "rankAfter"     DOUBLE PRECISION,
  "outcome"       TEXT,
  "impactScore"   DOUBLE PRECISION,
  CONSTRAINT "HealingOutcome_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "HealingOutcome_healingLogId_key" ON "HealingOutcome" ("healingLogId");
CREATE INDEX IF NOT EXISTS "HealingOutcome_siteId_issueType_idx" ON "HealingOutcome" ("siteId", "issueType");
CREATE INDEX IF NOT EXISTS "HealingOutcome_fixAppliedAt_idx" ON "HealingOutcome" ("fixAppliedAt");
CREATE INDEX IF NOT EXISTS "HealingOutcome_measuredAt_idx" ON "HealingOutcome" ("measuredAt");
