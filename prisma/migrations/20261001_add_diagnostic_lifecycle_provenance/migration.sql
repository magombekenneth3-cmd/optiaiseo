-- Phase 2: Diagnostic Lifecycle Provenance
-- Additive migration — all new columns are nullable, no data loss

-- Add finding provenance to remediation/mutation models
ALTER TABLE "SelfHealingLog" ADD COLUMN IF NOT EXISTS "diagnosticFindingId" TEXT;
ALTER TABLE "SeoFixProposal" ADD COLUMN IF NOT EXISTS "diagnosticFindingId" TEXT;
ALTER TABLE "SeoFixProposal" ADD COLUMN IF NOT EXISTS "findingFingerprint" TEXT;
ALTER TABLE "MutationOperation" ADD COLUMN IF NOT EXISTS "diagnosticFindingId" TEXT;
ALTER TABLE "MutationOperation" ADD COLUMN IF NOT EXISTS "findingFingerprint" TEXT;
ALTER TABLE "ActionProposal" ADD COLUMN IF NOT EXISTS "diagnosticFindingId" TEXT;
ALTER TABLE "ActionProposal" ADD COLUMN IF NOT EXISTS "findingFingerprint" TEXT;

-- Add lifecycle state to DiagnosticFindingRecord
ALTER TABLE "DiagnosticFindingRecord" ADD COLUMN IF NOT EXISTS "lifecycleState" TEXT NOT NULL DEFAULT 'OPEN';

-- Indexes for finding provenance lookups
CREATE INDEX IF NOT EXISTS "SelfHealingLog_diagnosticFindingId_idx" ON "SelfHealingLog"("diagnosticFindingId");
CREATE INDEX IF NOT EXISTS "SeoFixProposal_diagnosticFindingId_idx" ON "SeoFixProposal"("diagnosticFindingId");
CREATE INDEX IF NOT EXISTS "MutationOperation_diagnosticFindingId_idx" ON "MutationOperation"("diagnosticFindingId");
CREATE INDEX IF NOT EXISTS "ActionProposal_diagnosticFindingId_idx" ON "ActionProposal"("diagnosticFindingId");
CREATE INDEX IF NOT EXISTS "DiagnosticFindingRecord_siteId_lifecycleState_idx" ON "DiagnosticFindingRecord"("siteId", "lifecycleState");

-- Evidence deduplication unique constraint (null findingId values are distinct per PostgreSQL)
CREATE UNIQUE INDEX IF NOT EXISTS "SEOEvidenceRecord_findingId_evidenceHash_key" ON "SEOEvidenceRecord"("findingId", "evidenceHash");

-- Foreign keys for models with Prisma relations
ALTER TABLE "SelfHealingLog"
  ADD CONSTRAINT "SelfHealingLog_diagnosticFindingId_fkey"
  FOREIGN KEY ("diagnosticFindingId") REFERENCES "DiagnosticFindingRecord"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MutationOperation"
  ADD CONSTRAINT "MutationOperation_diagnosticFindingId_fkey"
  FOREIGN KEY ("diagnosticFindingId") REFERENCES "DiagnosticFindingRecord"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ActionProposal"
  ADD CONSTRAINT "ActionProposal_diagnosticFindingId_fkey"
  FOREIGN KEY ("diagnosticFindingId") REFERENCES "DiagnosticFindingRecord"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
