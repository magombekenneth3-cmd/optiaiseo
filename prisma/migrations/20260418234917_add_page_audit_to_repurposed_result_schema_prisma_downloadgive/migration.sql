/*
  Warnings:

  - A unique constraint covering the columns `[siteId,slug]` on the table `Blog` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[shareToken]` on the table `Site` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Blog" ADD COLUMN     "citationCriteria" JSONB,
ADD COLUMN     "citationScore" INTEGER;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "shareToken" TEXT,
ADD COLUMN     "slackWebhookUrl" TEXT,
ADD COLUMN     "zapierWebhookUrl" TEXT;

-- CreateTable
CREATE TABLE "RepurposedResult" (
    "id" TEXT NOT NULL,
    "blogId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "pageAuditId" TEXT,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepurposedResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedQuery" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "queryText" TEXT NOT NULL,
    "intent" TEXT NOT NULL DEFAULT 'informational',
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'auto',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueryResult" (
    "id" TEXT NOT NULL,
    "trackedQueryId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "mentioned" BOOLEAN NOT NULL DEFAULT false,
    "mentionPosition" INTEGER NOT NULL DEFAULT 0,
    "isAuthoritative" BOOLEAN NOT NULL DEFAULT false,
    "citationUrl" TEXT,
    "competitorsCited" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "responseSnippet" TEXT NOT NULL DEFAULT '',
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueryResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "payload" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepurposedResult_blogId_key" ON "RepurposedResult"("blogId");

-- CreateIndex
CREATE INDEX "RepurposedResult_siteId_createdAt_idx" ON "RepurposedResult"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "RepurposedResult_pageAuditId_idx" ON "RepurposedResult"("pageAuditId");

-- CreateIndex
CREATE INDEX "TrackedQuery_siteId_isActive_idx" ON "TrackedQuery"("siteId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedQuery_siteId_queryText_key" ON "TrackedQuery"("siteId", "queryText");

-- CreateIndex
CREATE INDEX "QueryResult_trackedQueryId_checkedAt_idx" ON "QueryResult"("trackedQueryId", "checkedAt" DESC);

-- CreateIndex
CREATE INDEX "QueryResult_checkedAt_idx" ON "QueryResult"("checkedAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_target_createdAt_idx" ON "AuditLog"("target", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Blog_siteId_slug_key" ON "Blog"("siteId", "slug");

-- CreateIndex
CREATE INDEX "SelfHealingLog_siteId_status_createdAt_idx" ON "SelfHealingLog"("siteId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Site_shareToken_key" ON "Site"("shareToken");

-- AddForeignKey
ALTER TABLE "RepurposedResult" ADD CONSTRAINT "RepurposedResult_blogId_fkey" FOREIGN KEY ("blogId") REFERENCES "Blog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepurposedResult" ADD CONSTRAINT "RepurposedResult_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepurposedResult" ADD CONSTRAINT "RepurposedResult_pageAuditId_fkey" FOREIGN KEY ("pageAuditId") REFERENCES "PageAudit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedQuery" ADD CONSTRAINT "TrackedQuery_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryResult" ADD CONSTRAINT "QueryResult_trackedQueryId_fkey" FOREIGN KEY ("trackedQueryId") REFERENCES "TrackedQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "SeedKeyword_source_discoveredAt_idx" RENAME TO "SeedKeyword_siteId_source_discoveredAt_idx";
