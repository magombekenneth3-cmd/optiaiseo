/*
  Warnings:

  - A unique constraint covering the columns `[siteId,createdAt]` on the table `AeoSnapshot` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "BacklinkDetail" DROP CONSTRAINT "BacklinkDetail_siteId_fkey";

-- DropForeignKey
ALTER TABLE "Commission" DROP CONSTRAINT "Commission_referralId_fkey";

-- DropForeignKey
ALTER TABLE "Commission" DROP CONSTRAINT "Commission_referrerId_fkey";

-- DropForeignKey
ALTER TABLE "EmbedLead" DROP CONSTRAINT "EmbedLead_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "HealingOutcome" DROP CONSTRAINT "HealingOutcome_siteId_fkey";

-- DropForeignKey
ALTER TABLE "MetricSnapshot" DROP CONSTRAINT "MetricSnapshot_siteId_fkey";

-- DropForeignKey
ALTER TABLE "Referral" DROP CONSTRAINT "Referral_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "StrategyMemory" DROP CONSTRAINT "StrategyMemory_siteId_fkey";

-- DropForeignKey
ALTER TABLE "StrategyMemory" DROP CONSTRAINT "StrategyMemory_userId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_referralId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "credits" INTEGER NOT NULL DEFAULT 50;

-- CreateTable
CREATE TABLE "SerpFeature" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "rankSnapshotId" TEXT,
    "keyword" TEXT NOT NULL,
    "hasAiOverview" BOOLEAN NOT NULL DEFAULT false,
    "hasSnippet" BOOLEAN NOT NULL DEFAULT false,
    "hasPaa" BOOLEAN NOT NULL DEFAULT false,
    "hasLocalPack" BOOLEAN NOT NULL DEFAULT false,
    "hasVideo" BOOLEAN NOT NULL DEFAULT false,
    "brandInAio" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SerpFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UptimeAlert" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" INTEGER,
    "durationMs" INTEGER,
    "alertSent" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UptimeAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SerpFeature_siteId_keyword_idx" ON "SerpFeature"("siteId", "keyword");

-- CreateIndex
CREATE INDEX "SerpFeature_siteId_capturedAt_idx" ON "SerpFeature"("siteId", "capturedAt" DESC);

-- CreateIndex
CREATE INDEX "UptimeAlert_siteId_createdAt_idx" ON "UptimeAlert"("siteId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AeoEvent_siteId_createdAt_idx" ON "AeoEvent"("siteId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AeoSnapshot_siteId_createdAt_key" ON "AeoSnapshot"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "Audit_siteId_fixStatus_runTimestamp_idx" ON "Audit"("siteId", "fixStatus", "runTimestamp" DESC);

-- CreateIndex
CREATE INDEX "RankSnapshot_siteId_keyword_recordedAt_idx" ON "RankSnapshot"("siteId", "keyword", "recordedAt" DESC);

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyMemory" ADD CONSTRAINT "StrategyMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyMemory" ADD CONSTRAINT "StrategyMemory_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbedLead" ADD CONSTRAINT "EmbedLead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklinkDetail" ADD CONSTRAINT "BacklinkDetail_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealingOutcome" ADD CONSTRAINT "HealingOutcome_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerpFeature" ADD CONSTRAINT "SerpFeature_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerpFeature" ADD CONSTRAINT "SerpFeature_rankSnapshotId_fkey" FOREIGN KEY ("rankSnapshotId") REFERENCES "RankSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UptimeAlert" ADD CONSTRAINT "UptimeAlert_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
