-- Phase D.6: Create D.6 tables + partial unique index fix.
--
-- The 20260824010000_add_safety_models migration was never applied to production
-- (Prisma skipped it due to ordering). This migration creates the tables first,
-- then applies the partial unique index fix.
--
-- All statements use IF NOT EXISTS / IF EXISTS for idempotency.

-- ═══════════════════════════════════════════════════════════════════════════════
-- Part A: Create D.6 tables (from 20260824010000_add_safety_models)
-- ═══════════════════════════════════════════════════════════════════════════════

-- CreateTable: ActionPerformance
CREATE TABLE IF NOT EXISTS "ActionPerformance" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "totalExperiments" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "inconclusive" INTEGER NOT NULL,
    "aborted" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "avgPositionDelta" DOUBLE PRECISION,
    "avgClicksLift" DOUBLE PRECISION,
    "avgCtrLift" DOUBLE PRECISION,
    "avgConfidence" DOUBLE PRECISION,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedVersion" TEXT NOT NULL DEFAULT 'd6-v1',
    "experimentCount" INTEGER NOT NULL,

    CONSTRAINT "ActionPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable: LearnedSignal
CREATE TABLE IF NOT EXISTS "LearnedSignal" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "adjustment" DOUBLE PRECISION NOT NULL,
    "magnitude" TEXT NOT NULL,
    "derivedFrom" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "activatedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "supersededBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnedSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: ActionPerformance
CREATE UNIQUE INDEX IF NOT EXISTS "ActionPerformance_siteId_actionType_key" ON "ActionPerformance"("siteId", "actionType");
CREATE INDEX IF NOT EXISTS "ActionPerformance_siteId_idx" ON "ActionPerformance"("siteId");

-- CreateIndex: LearnedSignal base indexes
CREATE INDEX IF NOT EXISTS "LearnedSignal_siteId_status_idx" ON "LearnedSignal"("siteId", "status");
CREATE INDEX IF NOT EXISTS "LearnedSignal_siteId_actionType_idx" ON "LearnedSignal"("siteId", "actionType");

-- AddForeignKey
ALTER TABLE "ActionPerformance" ADD CONSTRAINT "ActionPerformance_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearnedSignal" ADD CONSTRAINT "LearnedSignal_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Part B: Partial unique index fix (original D.6 Gate 7 fix)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Step 1: Drop the old four-column unique constraint (if it existed)
DROP INDEX IF EXISTS "LearnedSignal_siteId_signalType_actionType_status_key";

-- Step 2: Create partial unique index — at most one ACTIVE per key
CREATE UNIQUE INDEX IF NOT EXISTS "learned_signal_one_active"
ON "LearnedSignal" ("siteId", "signalType", "actionType")
WHERE "status" = 'ACTIVE';

-- Step 3: Add composite index for registry lookups
CREATE INDEX IF NOT EXISTS "LearnedSignal_siteId_signalType_actionType_idx"
ON "LearnedSignal" ("siteId", "signalType", "actionType");
