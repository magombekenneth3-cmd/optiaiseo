ALTER TABLE "Blog"
  ADD COLUMN "generationRequestId" TEXT,
  ADD COLUMN "generationAttemptId" TEXT,
  ADD COLUMN "generationInput" JSONB;

CREATE UNIQUE INDEX "Blog_siteId_generationRequestId_key"
  ON "Blog"("siteId", "generationRequestId");
