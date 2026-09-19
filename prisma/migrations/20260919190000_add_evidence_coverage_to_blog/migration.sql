-- AddColumn: evidenceCoverage and missingEvidence to Blog
-- Evidence coverage score (0–100) from the evidence-extractor pipeline.
-- Null for blogs generated before the evidence gate was introduced.

ALTER TABLE "Blog" ADD COLUMN IF NOT EXISTS "evidenceCoverage" INTEGER;
ALTER TABLE "Blog" ADD COLUMN IF NOT EXISTS "missingEvidence" TEXT[] NOT NULL DEFAULT '{}';
