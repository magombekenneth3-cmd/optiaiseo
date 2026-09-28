-- Evidence-Driven Diagnostic Engine Tables
-- Run this SQL on Railway's Postgres if prisma migrate is not accessible.

-- SEOEvidenceRecord: immutable evidence observations
CREATE TABLE IF NOT EXISTS "SEOEvidenceRecord" (
    "id"            TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
    "siteId"        TEXT        NOT NULL,
    "findingId"     TEXT,
    "source"        TEXT        NOT NULL,
    "url"           TEXT,
    "observedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observedValue" JSONB,
    "expectedValue" JSONB,
    "httpStatus"    INTEGER,
    "confidence"    DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidenceHash"  TEXT        NOT NULL,

    CONSTRAINT "SEOEvidenceRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SEOEvidenceRecord_siteId_observedAt_idx"
    ON "SEOEvidenceRecord"("siteId", "observedAt" DESC);
CREATE INDEX IF NOT EXISTS "SEOEvidenceRecord_findingId_idx"
    ON "SEOEvidenceRecord"("findingId");
CREATE INDEX IF NOT EXISTS "SEOEvidenceRecord_evidenceHash_idx"
    ON "SEOEvidenceRecord"("evidenceHash");

-- DiagnosticFindingRecord: diagnosed SEO issues with root cause
CREATE TABLE IF NOT EXISTS "DiagnosticFindingRecord" (
    "id"                   TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
    "siteId"               TEXT        NOT NULL,
    "fingerprint"          TEXT        NOT NULL,
    "issueType"            TEXT        NOT NULL,
    "status"               TEXT        NOT NULL DEFAULT 'FAIL',
    "severity"             TEXT        NOT NULL DEFAULT 'medium',
    "scopeType"            TEXT        NOT NULL DEFAULT 'PAGE',
    "scopeUrls"            TEXT[]      DEFAULT ARRAY[]::TEXT[],
    "rootCause"            TEXT        NOT NULL,
    "confidence"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedOutcome"      TEXT        NOT NULL,
    "remediationType"      TEXT        NOT NULL DEFAULT 'MANUAL',
    "verificationCriteria" JSONB,
    "dependencies"         TEXT[]      DEFAULT ARRAY[]::TEXT[],
    "priorityScore"        INTEGER,
    "priorityComponents"   JSONB,
    "policyVersion"        TEXT,
    "resolvedAt"           TIMESTAMP(3),
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosticFindingRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DiagnosticFindingRecord_siteId_fingerprint_key"
    ON "DiagnosticFindingRecord"("siteId", "fingerprint");
CREATE INDEX IF NOT EXISTS "DiagnosticFindingRecord_siteId_status_idx"
    ON "DiagnosticFindingRecord"("siteId", "status");
CREATE INDEX IF NOT EXISTS "DiagnosticFindingRecord_siteId_issueType_idx"
    ON "DiagnosticFindingRecord"("siteId", "issueType");
CREATE INDEX IF NOT EXISTS "DiagnosticFindingRecord_siteId_severity_createdAt_idx"
    ON "DiagnosticFindingRecord"("siteId", "severity", "createdAt" DESC);

-- Foreign keys
ALTER TABLE "SEOEvidenceRecord"
    ADD CONSTRAINT "SEOEvidenceRecord_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SEOEvidenceRecord"
    ADD CONSTRAINT "SEOEvidenceRecord_findingId_fkey"
    FOREIGN KEY ("findingId") REFERENCES "DiagnosticFindingRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DiagnosticFindingRecord"
    ADD CONSTRAINT "DiagnosticFindingRecord_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
