-- CreateTable
CREATE TABLE "PageAudit" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "overallScore" INTEGER NOT NULL DEFAULT 0,
    "categoryScores" JSONB NOT NULL DEFAULT '{}',
    "issueList" JSONB NOT NULL DEFAULT '[]',
    "runTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageAudit_auditId_idx" ON "PageAudit"("auditId");

-- CreateIndex
CREATE INDEX "PageAudit_siteId_runTimestamp_idx" ON "PageAudit"("siteId", "runTimestamp" DESC);

-- AddForeignKey
ALTER TABLE "PageAudit" ADD CONSTRAINT "PageAudit_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageAudit" ADD CONSTRAINT "PageAudit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
