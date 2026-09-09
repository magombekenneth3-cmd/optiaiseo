-- AlterTable: Experiment schema sync
ALTER TABLE "Experiment" ADD COLUMN IF NOT EXISTS "opportunityId" TEXT;
ALTER TABLE "Experiment" ADD COLUMN IF NOT EXISTS "hypothesis" TEXT;
ALTER TABLE "Experiment" ADD COLUMN IF NOT EXISTS "successMetric" TEXT;
ALTER TABLE "Experiment" ADD COLUMN IF NOT EXISTS "successThreshold" DOUBLE PRECISION;
ALTER TABLE "Experiment" ADD COLUMN IF NOT EXISTS "statusReason" TEXT;
ALTER TABLE "Experiment" ADD COLUMN IF NOT EXISTS "configVersion" TEXT DEFAULT 'd5-v1';
ALTER TABLE "Experiment" ADD COLUMN IF NOT EXISTS "configHash" TEXT;
ALTER TABLE "Experiment" ADD COLUMN IF NOT EXISTS "maxDurationDays" INTEGER DEFAULT 28;
ALTER TABLE "Experiment" ADD COLUMN IF NOT EXISTS "maxMutationCount" INTEGER DEFAULT 1;
ALTER TABLE "Experiment" ADD COLUMN IF NOT EXISTS "maxBudgetUnits" INTEGER DEFAULT 1;
ALTER TABLE "Experiment" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "Experiment" ADD COLUMN IF NOT EXISTS "endsAt" TIMESTAMP(3);
ALTER TABLE "Experiment" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "Experiment" ADD COLUMN IF NOT EXISTS "outcome" TEXT;
ALTER TABLE "Experiment" ADD COLUMN IF NOT EXISTS "outcomeConfidence" DOUBLE PRECISION;
ALTER TABLE "Experiment" ADD COLUMN IF NOT EXISTS "outcomeDetails" JSONB;

-- Make legacy fields optional
ALTER TABLE "Experiment" ALTER COLUMN "decisionId" DROP NOT NULL;
ALTER TABLE "Experiment" ALTER COLUMN "targetUrl" DROP NOT NULL;
ALTER TABLE "Experiment" ALTER COLUMN "actionExecuted" DROP NOT NULL;
ALTER TABLE "Experiment" ALTER COLUMN "executedAt" DROP NOT NULL;
ALTER TABLE "Experiment" ALTER COLUMN "evaluationDate" DROP NOT NULL;
ALTER TABLE "Experiment" ALTER COLUMN "baseline" DROP NOT NULL;
ALTER TABLE "Experiment" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Indexes
CREATE INDEX IF NOT EXISTS "Experiment_siteId_outcome_idx" ON "Experiment"("siteId", "outcome");
CREATE INDEX IF NOT EXISTS "Experiment_endsAt_status_idx" ON "Experiment"("endsAt", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "Experiment_siteId_opportunityId_key" ON "Experiment"("siteId", "opportunityId");

-- CreateTable: ExperimentVariant
CREATE TABLE IF NOT EXISTS "ExperimentVariant" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "proposalId" TEXT,
    "operationId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExperimentVariant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExperimentVariant_proposalId_key" ON "ExperimentVariant"("proposalId");
CREATE UNIQUE INDEX IF NOT EXISTS "ExperimentVariant_operationId_key" ON "ExperimentVariant"("operationId");
CREATE INDEX IF NOT EXISTS "ExperimentVariant_experimentId_idx" ON "ExperimentVariant"("experimentId");
CREATE INDEX IF NOT EXISTS "ExperimentVariant_proposalId_idx" ON "ExperimentVariant"("proposalId");
CREATE UNIQUE INDEX IF NOT EXISTS "ExperimentVariant_experimentId_variantKey_key" ON "ExperimentVariant"("experimentId", "variantKey");

ALTER TABLE "ExperimentVariant" DROP CONSTRAINT IF EXISTS "ExperimentVariant_experimentId_fkey";
ALTER TABLE "ExperimentVariant" ADD CONSTRAINT "ExperimentVariant_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: ExperimentMeasurement
CREATE TABLE IF NOT EXISTS "ExperimentMeasurement" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "measurementDay" INTEGER NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metrics" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExperimentMeasurement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ExperimentMeasurement_experimentId_measuredAt_idx" ON "ExperimentMeasurement"("experimentId", "measuredAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ExperimentMeasurement_experimentId_variantKey_measurementDay_key" ON "ExperimentMeasurement"("experimentId", "variantKey", "measurementDay");

ALTER TABLE "ExperimentMeasurement" DROP CONSTRAINT IF EXISTS "ExperimentMeasurement_experimentId_fkey";
ALTER TABLE "ExperimentMeasurement" ADD CONSTRAINT "ExperimentMeasurement_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
