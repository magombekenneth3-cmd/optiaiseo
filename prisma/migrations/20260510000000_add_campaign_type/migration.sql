-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "keywordCount" INTEGER;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "urlCount" INTEGER;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "keywords" JSONB;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Campaign_siteId_type_idx" ON "Campaign"("siteId", "type");
