CREATE TABLE "SkippedCompetitor" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkippedCompetitor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SkippedCompetitor_siteId_serviceId_domain_key" ON "SkippedCompetitor"("siteId", "serviceId", "domain");
CREATE INDEX "SkippedCompetitor_siteId_idx" ON "SkippedCompetitor"("siteId");
ALTER TABLE "SkippedCompetitor" ADD CONSTRAINT "SkippedCompetitor_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SkippedCompetitor" ADD CONSTRAINT "SkippedCompetitor_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "DetectedService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
