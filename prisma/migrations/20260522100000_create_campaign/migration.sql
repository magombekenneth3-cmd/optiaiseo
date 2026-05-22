CREATE TABLE IF NOT EXISTS "Campaign" (
    "id"              TEXT NOT NULL,
    "siteId"          TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "keyword"         TEXT NOT NULL,
    "clientUrl"       TEXT NOT NULL,
    "initialPosition" INTEGER NOT NULL,
    "targetPosition"  INTEGER NOT NULL DEFAULT 1,
    "status"          TEXT NOT NULL DEFAULT 'ACTIVE',
    "type"            TEXT,
    "name"            TEXT,
    "keywordCount"    INTEGER,
    "urlCount"        INTEGER,
    "keywords"        JSONB,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"     TIMESTAMP(3),
    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Campaign_siteId_idx" ON "Campaign"("siteId");
CREATE INDEX IF NOT EXISTS "Campaign_siteId_type_idx" ON "Campaign"("siteId", "type");
