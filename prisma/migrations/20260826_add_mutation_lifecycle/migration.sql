-- Migration: add_mutation_lifecycle
-- Phase 1 of the centralized MutationOperation lifecycle.
-- All changes are additive (no column drops, no renames).
-- MutationOperation uses onDelete: RESTRICT from Site to preserve audit history.

-- AlterTable: Blog — add optimistic concurrency version
ALTER TABLE "Blog" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable: GrowthDecision — add approval metadata
ALTER TABLE "GrowthDecision" ADD COLUMN     "approvalExpiresAt" TIMESTAMP(3),
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "mutationHash" TEXT;

-- AlterTable: Site — add mutation kill switches
ALTER TABLE "Site" ADD COLUMN     "automationsPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "effectCmsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "effectGithubEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "effectIndexNowEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable: MutationOperation
CREATE TABLE "MutationOperation" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "authorizedBy" TEXT,
    "authPolicyVersion" TEXT,
    "authorizedAt" TIMESTAMP(3),
    "mutationType" TEXT NOT NULL,
    "targetModel" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "expectedVersion" INTEGER NOT NULL,
    "mutationPayload" JSONB NOT NULL,
    "mutationHash" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "affectedFields" TEXT[],
    "diffSizeBytes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "executionClaimedBy" TEXT,
    "executionClaimedAt" TIMESTAMP(3),
    "executionLeaseExpiresAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalExpiresAt" TIMESTAMP(3),
    "approvalHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "MutationOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: MutationSnapshot
CREATE TABLE "MutationSnapshot" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "targetModel" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetVersion" INTEGER NOT NULL,
    "beforeState" JSONB NOT NULL,
    "afterState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MutationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable: MutationEffect
CREATE TABLE "MutationEffect" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "effectType" TEXT NOT NULL,
    "platform" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "confirmationMode" TEXT NOT NULL DEFAULT 'POLL',
    "compensationPolicy" TEXT NOT NULL DEFAULT 'IRREVERSIBLE',
    "externalId" TEXT,
    "externalError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MutationEffect_pkey" PRIMARY KEY ("id")
);

-- CreateTable: MutationAuditEvent
CREATE TABLE "MutationAuditEvent" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MutationAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: MutationOperation
CREATE UNIQUE INDEX "MutationOperation_idempotencyKey_key" ON "MutationOperation"("idempotencyKey");
CREATE INDEX "MutationOperation_siteId_status_idx" ON "MutationOperation"("siteId", "status");
CREATE INDEX "MutationOperation_siteId_targetModel_targetId_idx" ON "MutationOperation"("siteId", "targetModel", "targetId");
CREATE INDEX "MutationOperation_actorId_createdAt_idx" ON "MutationOperation"("actorId", "createdAt" DESC);
CREATE INDEX "MutationOperation_status_createdAt_idx" ON "MutationOperation"("status", "createdAt");
CREATE INDEX "MutationOperation_approvalExpiresAt_idx" ON "MutationOperation"("approvalExpiresAt");

-- CreateIndex: MutationSnapshot
CREATE UNIQUE INDEX "MutationSnapshot_operationId_key" ON "MutationSnapshot"("operationId");
CREATE INDEX "MutationSnapshot_targetModel_targetId_targetVersion_idx" ON "MutationSnapshot"("targetModel", "targetId", "targetVersion");
CREATE INDEX "MutationSnapshot_targetModel_targetId_createdAt_idx" ON "MutationSnapshot"("targetModel", "targetId", "createdAt" DESC);

-- CreateIndex: MutationEffect
CREATE UNIQUE INDEX "MutationEffect_idempotencyKey_key" ON "MutationEffect"("idempotencyKey");
CREATE INDEX "MutationEffect_operationId_idx" ON "MutationEffect"("operationId");
CREATE INDEX "MutationEffect_status_nextRetryAt_idx" ON "MutationEffect"("status", "nextRetryAt");
CREATE INDEX "MutationEffect_effectType_status_idx" ON "MutationEffect"("effectType", "status");

-- CreateIndex: MutationAuditEvent
CREATE INDEX "MutationAuditEvent_operationId_createdAt_idx" ON "MutationAuditEvent"("operationId", "createdAt");
CREATE INDEX "MutationAuditEvent_eventType_createdAt_idx" ON "MutationAuditEvent"("eventType", "createdAt");
CREATE INDEX "MutationAuditEvent_actorId_createdAt_idx" ON "MutationAuditEvent"("actorId", "createdAt" DESC);

-- AddForeignKey: MutationOperation → Site (RESTRICT — preserves audit trail)
ALTER TABLE "MutationOperation" ADD CONSTRAINT "MutationOperation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: MutationSnapshot → MutationOperation (CASCADE — children of operation)
ALTER TABLE "MutationSnapshot" ADD CONSTRAINT "MutationSnapshot_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "MutationOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: MutationEffect → MutationOperation (CASCADE)
ALTER TABLE "MutationEffect" ADD CONSTRAINT "MutationEffect_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "MutationOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: MutationAuditEvent → MutationOperation (CASCADE)
ALTER TABLE "MutationAuditEvent" ADD CONSTRAINT "MutationAuditEvent_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "MutationOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
