-- Migration: planner_items_seed_keywords_blog_source_url
-- Adds PlannerItem and SeedKeyword tables, sourceUrl to Blog

-- AlterTable
ALTER TABLE "Blog" ADD COLUMN "sourceUrl" TEXT;
CREATE INDEX "Blog_siteId_pipelineType_createdAt_idx" ON "Blog"("siteId", "pipelineType", "createdAt");

-- CreateTable: PlannerItem (replaces plannerState JSON blob on Site)
CREATE TABLE "PlannerItem" (
    "id"            TEXT NOT NULL,
    "siteId"        TEXT NOT NULL,
    "keyword"       TEXT NOT NULL,
    "title"         TEXT,
    "parentTopic"   TEXT,
    "intent"        TEXT,
    "difficulty"    TEXT,
    "weekBucket"    TEXT,
    "status"        TEXT NOT NULL DEFAULT 'Todo',
    "briefId"       TEXT,
    "reason"        TEXT,
    "pillar"        BOOLEAN NOT NULL DEFAULT false,
    "priorityScore" INTEGER,
    "reddit"        JSONB,
    "backlinks"     JSONB,
    "pageScore"     JSONB,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannerItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX  "PlannerItem_siteId_status_idx"     ON "PlannerItem"("siteId", "status");
CREATE INDEX  "PlannerItem_siteId_weekBucket_idx"  ON "PlannerItem"("siteId", "weekBucket");
CREATE UNIQUE INDEX "PlannerItem_siteId_keyword_key" ON "PlannerItem"("siteId", "keyword");

ALTER TABLE "PlannerItem"
    ADD CONSTRAINT "PlannerItem_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: SeedKeyword (replaces device="seed" hack on RankSnapshot)
CREATE TABLE "SeedKeyword" (
    "id"      TEXT NOT NULL,
    "siteId"  TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "intent"  TEXT,
    "notes"   TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeedKeyword_pkey" PRIMARY KEY ("id")
);

CREATE INDEX  "SeedKeyword_siteId_idx"        ON "SeedKeyword"("siteId");
CREATE UNIQUE INDEX "SeedKeyword_siteId_keyword_key" ON "SeedKeyword"("siteId", "keyword");

ALTER TABLE "SeedKeyword"
    ADD CONSTRAINT "SeedKeyword_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
