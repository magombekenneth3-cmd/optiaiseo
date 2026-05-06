-- AlterTable
ALTER TABLE "IndexingLog" ADD COLUMN     "engine" TEXT NOT NULL DEFAULT 'GOOGLE';

-- CreateTable
CREATE TABLE "IndexNowConfig" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexNowConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndexNowConfig_siteId_key" ON "IndexNowConfig"("siteId");

-- AddForeignKey
ALTER TABLE "IndexNowConfig" ADD CONSTRAINT "IndexNowConfig_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
