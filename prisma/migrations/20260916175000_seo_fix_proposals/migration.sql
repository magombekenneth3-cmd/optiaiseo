CREATE TABLE "SeoFixProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "baseSha" TEXT,
    "issueLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "expiresAt" DATETIME NOT NULL,
    "dispatchedAt" DATETIME,
    "prUrl" TEXT,
    "deploymentUrl" TEXT,
    "deployedAt" DATETIME,
    "measuredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "SeoFixProposal_siteId_userId_status_idx" ON "SeoFixProposal"("siteId", "userId", "status");
CREATE INDEX "SeoFixProposal_expiresAt_idx" ON "SeoFixProposal"("expiresAt");
