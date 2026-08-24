-- CreateTable: PseoTemplate
CREATE TABLE IF NOT EXISTS "PseoTemplate" (
    "id"        TEXT NOT NULL,
    "siteId"    TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "pattern"   TEXT NOT NULL,
    "dataset"   JSONB NOT NULL,
    "status"    TEXT NOT NULL DEFAULT 'DRAFT',
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PseoTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PseoPage
CREATE TABLE IF NOT EXISTS "PseoPage" (
    "id"              TEXT NOT NULL,
    "templateId"      TEXT NOT NULL,
    "siteId"          TEXT NOT NULL,
    "slug"            TEXT NOT NULL,
    "title"           TEXT NOT NULL,
    "metaDescription" TEXT,
    "contentHtml"     TEXT NOT NULL,
    "schemaJsonLd"    JSONB NOT NULL DEFAULT '[]',
    "heroVisualSvg"   TEXT NOT NULL,
    "variableData"    JSONB NOT NULL DEFAULT '{}',
    "status"          TEXT NOT NULL DEFAULT 'GENERATED',
    "publishedUrl"    TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PseoPage_pkey" PRIMARY KEY ("id")
);

-- FK: PseoTemplate -> Site
ALTER TABLE "PseoTemplate"
    ADD CONSTRAINT "PseoTemplate_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: PseoPage -> PseoTemplate
ALTER TABLE "PseoPage"
    ADD CONSTRAINT "PseoPage_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "PseoTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: PseoPage -> Site
ALTER TABLE "PseoPage"
    ADD CONSTRAINT "PseoPage_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX IF NOT EXISTS "PseoTemplate_siteId_createdAt_idx" ON "PseoTemplate"("siteId", "createdAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "PseoPage_siteId_slug_key" ON "PseoPage"("siteId", "slug");
CREATE INDEX IF NOT EXISTS "PseoPage_templateId_createdAt_idx" ON "PseoPage"("templateId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "PseoPage_siteId_status_idx" ON "PseoPage"("siteId", "status");
