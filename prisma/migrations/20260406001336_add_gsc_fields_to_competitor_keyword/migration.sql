-- AlterTable
ALTER TABLE "CompetitorKeyword" ADD COLUMN     "clicks" INTEGER,
ADD COLUMN     "ctr" DOUBLE PRECISION,
ADD COLUMN     "dataSource" TEXT,
ADD COLUMN     "impressions" INTEGER,
ALTER COLUMN "position" SET DATA TYPE DOUBLE PRECISION;
