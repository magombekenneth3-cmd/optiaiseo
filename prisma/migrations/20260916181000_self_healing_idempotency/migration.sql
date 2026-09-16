ALTER TABLE "SelfHealingLog" ADD COLUMN "fingerprint" TEXT;
ALTER TABLE "SelfHealingLog" ADD COLUMN "dedupeBucket" TEXT;
CREATE UNIQUE INDEX "SelfHealingLog_siteId_fingerprint_dedupeBucket_key"
ON "SelfHealingLog"("siteId", "fingerprint", "dedupeBucket");
