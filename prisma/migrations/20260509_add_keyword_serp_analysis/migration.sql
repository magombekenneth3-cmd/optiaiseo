-- CreateTable
CREATE TABLE IF NOT EXISTS "KeywordSerpAnalysis" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "landingUrl" TEXT NOT NULL,
    "serpResults" JSONB NOT NULL,
    "fixes" JSONB NOT NULL,
    "headingGaps" JSONB NOT NULL,
    "wordCountAvg" INTEGER NOT NULL,
    "wordCountPage" INTEGER NOT NULL,
    "drGap" INTEGER,
    "rdGapRoot" INTEGER,
    "rdGapPage" INTEGER,
    "opportunityDoms" JSONB NOT NULL DEFAULT '[]',
    "intentMismatch" BOOLEAN NOT NULL DEFAULT false,
    "intentNote" TEXT,
    "contentType" TEXT,
    "disclaimerNeeded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordSerpAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "KeywordSerpAnalysis_siteId_keyword_key" ON "KeywordSerpAnalysis"("siteId", "keyword");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KeywordSerpAnalysis_siteId_idx" ON "KeywordSerpAnalysis"("siteId");

-- AddForeignKey
ALTER TABLE "KeywordSerpAnalysis" ADD CONSTRAINT "KeywordSerpAnalysis_siteId_fkey" 
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
