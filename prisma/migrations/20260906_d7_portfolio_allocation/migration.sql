-- CreateTable OpportunityScoreRecord
CREATE TABLE IF NOT EXISTS "OpportunityScoreRecord" (
    "id"                 TEXT NOT NULL,
    "opportunityId"      TEXT NOT NULL,
    "scoringVersion"     TEXT NOT NULL,
    "impactScore"        DOUBLE PRECISION NOT NULL,
    "confidenceScore"    DOUBLE PRECISION NOT NULL,
    "evidenceScore"      DOUBLE PRECISION NOT NULL,
    "urgencyScore"       DOUBLE PRECISION NOT NULL,
    "effortScore"        DOUBLE PRECISION NOT NULL,
    "riskScore"          DOUBLE PRECISION NOT NULL,
    "finalScore"         DOUBLE PRECISION NOT NULL,
    "decision"           TEXT NOT NULL,
    "decisionReasons"    JSONB NOT NULL,
    "evidenceHash"       TEXT NOT NULL,
    "evidenceVerifiedAt" TIMESTAMP(3),
    "weightsUsed"        JSONB NOT NULL,
    "learningVersion"    TEXT,
    "scoredAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpportunityScoreRecord_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "OpportunityScoreRecord" ADD COLUMN IF NOT EXISTS "learningVersion" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PortfolioAllocation" (
    "id"                   TEXT NOT NULL,
    "siteId"               TEXT NOT NULL,
    "opportunityId"        TEXT NOT NULL,
    "cycleId"              TEXT NOT NULL,
    "optimizerVersion"     TEXT NOT NULL,
    "decision"             TEXT NOT NULL,
    "rank"                 INTEGER,
    "utilityScore"         DOUBLE PRECISION,
    "reasonCodes"          JSONB NOT NULL,
    "scoreRecordId"        TEXT NOT NULL,
    "evidenceHash"         TEXT NOT NULL,
    "learningVersion"      TEXT,
    "constraintSnapshot"   JSONB NOT NULL,
    "candidateSnapshot"    JSONB NOT NULL,
    "experimentPreference" TEXT,
    "allocatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PortfolioAllocation_cycleId_opportunityId_key" ON "PortfolioAllocation"("cycleId", "opportunityId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PortfolioAllocation_siteId_decision_expiresAt_idx" ON "PortfolioAllocation"("siteId", "decision", "expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PortfolioAllocation_siteId_cycleId_idx" ON "PortfolioAllocation"("siteId", "cycleId");

-- AddForeignKey (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PortfolioAllocation_siteId_fkey') THEN
    ALTER TABLE "PortfolioAllocation" ADD CONSTRAINT "PortfolioAllocation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PortfolioAllocation_opportunityId_fkey') THEN
    ALTER TABLE "PortfolioAllocation" ADD CONSTRAINT "PortfolioAllocation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "GrowthDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
