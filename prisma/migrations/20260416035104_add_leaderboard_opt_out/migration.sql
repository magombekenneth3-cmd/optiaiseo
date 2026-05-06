/*
  Warnings:

  - You are about to drop the column `repurposeFormat` on the `AeoEvent` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "AeoEvent" DROP COLUMN "repurposeFormat";

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "hideFromLeaderboard" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Site_niche_operatingMode_idx" ON "Site"("niche", "operatingMode");
