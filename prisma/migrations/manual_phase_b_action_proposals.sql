-- AlterTable
ALTER TABLE "GrowthDecision" ADD COLUMN     "opportunityStatus" TEXT NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE "TrendingTopic" ALTER COLUMN "expiresAt" SET DEFAULT now() + interval '30 days';

-- CreateTable
CREATE TABLE "ActionProposal" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "operationId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "targetModel" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "proposedChanges" JSONB NOT NULL,
    "expectedOutcome" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "safetyTier" INTEGER NOT NULL DEFAULT 1,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalExpiresAt" TIMESTAMP(3),
    "approvalHash" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastAttemptAt" TIMESTAMP(3),
    "lastAttemptError" TEXT,
    "verificationCriteria" JSONB NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verificationResult" TEXT,
    "verificationDetails" JSONB,
    "generatedBy" TEXT NOT NULL DEFAULT 'system:proposal-generator',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ActionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActionProposal_operationId_key" ON "ActionProposal"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "ActionProposal_idempotencyKey_key" ON "ActionProposal"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ActionProposal_siteId_status_idx" ON "ActionProposal"("siteId", "status");

-- CreateIndex
CREATE INDEX "ActionProposal_decisionId_idx" ON "ActionProposal"("decisionId");

-- CreateIndex
CREATE INDEX "ActionProposal_status_createdAt_idx" ON "ActionProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ActionProposal_siteId_actionType_idx" ON "ActionProposal"("siteId", "actionType");

-- CreateIndex
CREATE INDEX "ActionProposal_approvalExpiresAt_idx" ON "ActionProposal"("approvalExpiresAt");

-- CreateIndex
CREATE INDEX "GrowthDecision_siteId_opportunityStatus_idx" ON "GrowthDecision"("siteId", "opportunityStatus");

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "GrowthDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "MutationOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

┌─────────────────────────────────────────────────────────┐
│  Update available 5.22.0 -> 8.0.0-rc.12                 │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘
