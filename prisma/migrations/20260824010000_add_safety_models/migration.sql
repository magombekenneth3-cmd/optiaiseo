-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ActionPerformance_siteId_actionType_key" ON "ActionPerformance"("siteId", "actionType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ActionPerformance_siteId_idx" ON "ActionPerformance"("siteId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LearnedSignal_siteId_status_idx" ON "LearnedSignal"("siteId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LearnedSignal_siteId_actionType_idx" ON "LearnedSignal"("siteId", "actionType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LearnedSignal_siteId_signalType_actionType_idx" ON "LearnedSignal"("siteId", "signalType", "actionType");

-- AddForeignKey
ALTER TABLE "ActionPerformance" ADD CONSTRAINT "ActionPerformance_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnedSignal" ADD CONSTRAINT "LearnedSignal_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
