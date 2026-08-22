-- Add rssFeedUrl column to Site if it doesn't exist
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "rssFeedUrl" TEXT;

-- Create EvidenceSnapshot table if it doesn't exist
CREATE TABLE IF NOT EXISTS "EvidenceSnapshot" (
    "evidenceSnapshotId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inputHash" TEXT NOT NULL,
    "canonicalPayload" JSONB NOT NULL,
    "featureSetVersion" TEXT NOT NULL DEFAULT 'gsc-lh-aeo-v1',
    "checksum" TEXT NOT NULL,

    CONSTRAINT "EvidenceSnapshot_pkey" PRIMARY KEY ("evidenceSnapshotId")
);

-- Add foreign key constraint
ALTER TABLE "EvidenceSnapshot" ADD CONSTRAINT "EvidenceSnapshot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add indexes
CREATE INDEX IF NOT EXISTS "EvidenceSnapshot_siteId_createdAt_idx" ON "EvidenceSnapshot"("siteId" DESC, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "EvidenceSnapshot_inputHash_idx" ON "EvidenceSnapshot"("inputHash");
