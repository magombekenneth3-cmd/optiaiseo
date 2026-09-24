-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM ('EXTERNAL_SOURCE', 'FIRST_PARTY_EXPERIENCE', 'FIRST_PARTY_DATA', 'GSC_DATA', 'SERP_OBSERVATION', 'INFERENCE', 'LLM_GENERATED');

-- CreateEnum
CREATE TYPE "BlogClaimType" AS ENUM ('STATISTIC', 'FACT', 'QUOTE', 'COMPARISON', 'EXPERIENCE', 'OPINION', 'RECOMMENDATION');

-- CreateEnum
CREATE TYPE "BlogClaimStatus" AS ENUM ('PENDING', 'SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'DISPUTED', 'RETRACTED');

-- CreateEnum
CREATE TYPE "EvidenceSupportLevel" AS ENUM ('STRONG', 'MODERATE', 'WEAK', 'CONTRADICTORY', 'NEUTRAL');

-- CreateTable
CREATE TABLE "ResearchArtifact" (
    "id" TEXT NOT NULL,
    "blogId" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "publisher" TEXT,
    "publishedAt" TIMESTAMP(3),
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceType" "EvidenceSourceType" NOT NULL,
    "contentHash" TEXT,
    "snippet" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "authorityScore" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceItem" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "sourceType" "EvidenceSourceType" NOT NULL,
    "content" TEXT NOT NULL,
    "extractedClaim" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogClaim" (
    "id" TEXT NOT NULL,
    "blogId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "type" "BlogClaimType" NOT NULL,
    "status" "BlogClaimStatus" NOT NULL DEFAULT 'PENDING',
    "sectionId" TEXT,
    "position" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvidence" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "supportLevel" "EvidenceSupportLevel" NOT NULL,
    "reasoning" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchArtifact_blogId_idx" ON "ResearchArtifact"("blogId");
CREATE INDEX "ResearchArtifact_blogId_sourceType_idx" ON "ResearchArtifact"("blogId", "sourceType");

-- CreateIndex
CREATE INDEX "EvidenceItem_artifactId_idx" ON "EvidenceItem"("artifactId");
CREATE INDEX "EvidenceItem_sourceType_idx" ON "EvidenceItem"("sourceType");

-- CreateIndex
CREATE INDEX "BlogClaim_blogId_idx" ON "BlogClaim"("blogId");
CREATE INDEX "BlogClaim_blogId_status_idx" ON "BlogClaim"("blogId", "status");
CREATE INDEX "BlogClaim_blogId_type_idx" ON "BlogClaim"("blogId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimEvidence_claimId_evidenceId_key" ON "ClaimEvidence"("claimId", "evidenceId");
CREATE INDEX "ClaimEvidence_claimId_idx" ON "ClaimEvidence"("claimId");
CREATE INDEX "ClaimEvidence_evidenceId_idx" ON "ClaimEvidence"("evidenceId");

-- AddForeignKey
ALTER TABLE "ResearchArtifact" ADD CONSTRAINT "ResearchArtifact_blogId_fkey" FOREIGN KEY ("blogId") REFERENCES "Blog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "ResearchArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogClaim" ADD CONSTRAINT "BlogClaim_blogId_fkey" FOREIGN KEY ("blogId") REFERENCES "Blog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "BlogClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
