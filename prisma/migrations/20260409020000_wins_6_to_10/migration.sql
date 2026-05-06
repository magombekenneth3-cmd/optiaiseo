-- ==========================================================================
-- Migration: wins_6_to_10_new_features
-- Adds tables for: BenchmarkStat, StrategyMemory, EmbedLead, Referral, Commission
-- Also adds referralId column to User
-- ==========================================================================

-- Win 8: Benchmark percentile stats
CREATE TABLE IF NOT EXISTS "BenchmarkStat" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "niche"      TEXT NOT NULL,
    "techStack"  TEXT NOT NULL,
    "metric"     TEXT NOT NULL,
    "p25"        DOUBLE PRECISION NOT NULL,
    "p50"        DOUBLE PRECISION NOT NULL,
    "p75"        DOUBLE PRECISION NOT NULL,
    "p90"        DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "updatedAt"  TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "BenchmarkStat_niche_techStack_metric_key" ON "BenchmarkStat" ("niche", "techStack", "metric");
CREATE INDEX IF NOT EXISTS "BenchmarkStat_niche_metric_idx" ON "BenchmarkStat" ("niche", "metric");

-- Win 9: Strategy Memory
CREATE TABLE IF NOT EXISTS "StrategyMemory" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "userId"     TEXT NOT NULL,
    "siteId"     TEXT NOT NULL,
    "memoryType" TEXT NOT NULL,
    "content"    TEXT NOT NULL,
    "metadata"   JSONB,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"  TIMESTAMP(3),
    CONSTRAINT "StrategyMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
    CONSTRAINT "StrategyMemory_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "StrategyMemory_userId_siteId_createdAt_idx" ON "StrategyMemory" ("userId", "siteId", "createdAt");

-- Win 7: Embed leads
CREATE TABLE IF NOT EXISTS "EmbedLead" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "ownerId"   TEXT NOT NULL,
    "email"     TEXT NOT NULL,
    "domain"    TEXT NOT NULL,
    "scores"    JSONB NOT NULL,
    "embedKey"  TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmbedLead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "EmbedLead_ownerId_createdAt_idx" ON "EmbedLead" ("ownerId", "createdAt");
CREATE INDEX IF NOT EXISTS "EmbedLead_embedKey_idx" ON "EmbedLead" ("embedKey");

-- Win 10: Referral programme
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralId" TEXT;

CREATE TABLE IF NOT EXISTS "Referral" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "ownerId"     TEXT NOT NULL,
    "code"        TEXT NOT NULL,
    "signups"     INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Referral_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Referral_ownerId_key" ON "Referral" ("ownerId");
CREATE UNIQUE INDEX IF NOT EXISTS "Referral_code_key" ON "Referral" ("code");
CREATE INDEX IF NOT EXISTS "Referral_code_idx" ON "Referral" ("code");

ALTER TABLE "User" ADD CONSTRAINT "User_referralId_fkey"
    FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE SET NULL
    NOT VALID;

CREATE TABLE IF NOT EXISTS "Commission" (
    "id"              TEXT NOT NULL PRIMARY KEY,
    "referralId"      TEXT NOT NULL,
    "referrerId"      TEXT NOT NULL,
    "amountCents"     INTEGER NOT NULL,
    "month"           TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'pending',
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Commission_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE,
    CONSTRAINT "Commission_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Commission_stripeInvoiceId_key" ON "Commission" ("stripeInvoiceId");
CREATE INDEX IF NOT EXISTS "Commission_referrerId_status_idx" ON "Commission" ("referrerId", "status");
CREATE INDEX IF NOT EXISTS "Commission_month_idx" ON "Commission" ("month");
