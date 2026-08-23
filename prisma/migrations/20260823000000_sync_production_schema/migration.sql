-- DropIndex (idempotent — ignore if already gone)
DROP INDEX IF EXISTS "Campaign_siteId_idx";
DROP INDEX IF EXISTS "EvidenceSnapshot_siteId_createdAt_idx";
DROP INDEX IF EXISTS "KeywordSerpAnalysis_status_idx";

-- AlterTable Blog
ALTER TABLE "Blog" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable Campaign
ALTER TABLE "Campaign" ALTER COLUMN "name" SET NOT NULL;

-- AlterTable IndexingLog
ALTER TABLE "IndexingLog"
  ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "retryCount"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "retryError"  TEXT;

-- AlterTable KeywordSerpAnalysis — backfill NULLs before setting NOT NULL
UPDATE "KeywordSerpAnalysis" SET "dofollowRatio" = 0  WHERE "dofollowRatio" IS NULL;
UPDATE "KeywordSerpAnalysis" SET "lostLastWeek"  = 0  WHERE "lostLastWeek"  IS NULL;
UPDATE "KeywordSerpAnalysis" SET "newLastWeek"   = 0  WHERE "newLastWeek"   IS NULL;
UPDATE "KeywordSerpAnalysis" SET "toxicCount"    = 0  WHERE "toxicCount"    IS NULL;

ALTER TABLE "KeywordSerpAnalysis"
  ALTER COLUMN "clientDR"      SET DATA TYPE INTEGER USING COALESCE("clientDR"::INTEGER, 0),
  ALTER COLUMN "dofollowRatio" SET NOT NULL,
  ALTER COLUMN "dofollowRatio" SET DEFAULT 0,
  ALTER COLUMN "lostLastWeek"  SET NOT NULL,
  ALTER COLUMN "lostLastWeek"  SET DEFAULT 0,
  ALTER COLUMN "newLastWeek"   SET NOT NULL,
  ALTER COLUMN "newLastWeek"   SET DEFAULT 0,
  ALTER COLUMN "toxicCount"    SET NOT NULL,
  ALTER COLUMN "toxicCount"    SET DEFAULT 0;

-- AlterTable SerpGapAnalysis
ALTER TABLE "SerpGapAnalysis" ADD COLUMN IF NOT EXISTS "autoQueued" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable Site
ALTER TABLE "Site"
  ADD COLUMN IF NOT EXISTS "socialRepurposeEnabled"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "socialRepurposeSchedule" TEXT    NOT NULL DEFAULT 'weekly';

-- AlterTable TrendingTopic
ALTER TABLE "TrendingTopic" ALTER COLUMN "expiresAt" SET DEFAULT now() + interval '30 days';

-- CreateTable InternalLink
CREATE TABLE IF NOT EXISTS "InternalLink" (
    "id"           TEXT NOT NULL,
    "siteId"       TEXT NOT NULL,
    "sourceBlogId" TEXT NOT NULL,
    "targetBlogId" TEXT NOT NULL,
    "sourceUrl"    TEXT NOT NULL,
    "targetUrl"    TEXT NOT NULL,
    "anchorText"   TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InternalLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable CreditLedger
CREATE TABLE IF NOT EXISTS "CreditLedger" (
    "id"          TEXT    NOT NULL,
    "userId"      TEXT    NOT NULL,
    "amount"      INTEGER NOT NULL,
    "type"        TEXT    NOT NULL,
    "referenceId" TEXT    NOT NULL,
    "reason"      TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable GrowthDecision
CREATE TABLE IF NOT EXISTS "GrowthDecision" (
    "id"                    TEXT NOT NULL,
    "siteId"                TEXT NOT NULL,
    "url"                   TEXT NOT NULL,
    "primaryKeyword"        TEXT NOT NULL,
    "primaryCategory"       TEXT NOT NULL,
    "opportunityCategories" JSONB NOT NULL,
    "action"                TEXT NOT NULL,
    "score"                 JSONB NOT NULL,
    "whyNow"                JSONB NOT NULL,
    "impact"                JSONB NOT NULL,
    "executionPlan"         JSONB NOT NULL,
    "status"                TEXT NOT NULL DEFAULT 'ACTIVE',
    "engineVersion"         TEXT NOT NULL DEFAULT 'v1',
    "inputPeriodStart"      TIMESTAMP(3),
    "inputPeriodEnd"        TIMESTAMP(3),
    "generatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GrowthDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable Experiment
CREATE TABLE IF NOT EXISTS "Experiment" (
    "id"              TEXT NOT NULL,
    "decisionId"      TEXT NOT NULL,
    "siteId"          TEXT NOT NULL,
    "targetUrl"       TEXT NOT NULL,
    "actionExecuted"  TEXT NOT NULL,
    "executedAt"      TIMESTAMP(3) NOT NULL,
    "evaluationDate"  TIMESTAMP(3) NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'RECORDED',
    "baseline"        JSONB NOT NULL,
    "lift"            JSONB,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable DailyBriefing
CREATE TABLE IF NOT EXISTS "DailyBriefing" (
    "id"                          TEXT    NOT NULL,
    "siteId"                      TEXT    NOT NULL,
    "userId"                      TEXT    NOT NULL,
    "date"                        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "yesterdayTraffic"            INTEGER NOT NULL DEFAULT 0,
    "organicImpressions"          INTEGER NOT NULL DEFAULT 0,
    "topPerformingKeyword"        TEXT,
    "topPerformingKeywordVolume"  INTEGER,
    "topPerformingKeywordPosition" INTEGER,
    "anomaliesFound"              JSONB,
    "quickWins"                   JSONB,
    "createdAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyBriefing_pkey" PRIMARY KEY ("id")
);

-- CreateTable CompetitorAlert
CREATE TABLE IF NOT EXISTS "CompetitorAlert" (
    "id"          TEXT    NOT NULL,
    "siteId"      TEXT    NOT NULL,
    "competitor"  TEXT    NOT NULL,
    "message"     TEXT    NOT NULL,
    "gainedCount" INTEGER NOT NULL,
    "details"     JSONB   NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompetitorAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable RssSocialPost
CREATE TABLE IF NOT EXISTS "RssSocialPost" (
    "id"           TEXT NOT NULL,
    "siteId"       TEXT NOT NULL,
    "articleUrl"   TEXT NOT NULL,
    "articleTitle" TEXT NOT NULL,
    "posts"        JSONB NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RssSocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable RankerSnapshot
CREATE TABLE IF NOT EXISTS "RankerSnapshot" (
    "rankerVersion"    TEXT NOT NULL,
    "weightsVersion"   TEXT NOT NULL,
    "featureSetVersion" TEXT NOT NULL,
    "configuration"    JSONB NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy"        TEXT NOT NULL DEFAULT 'system',
    "status"           TEXT NOT NULL DEFAULT 'INACTIVE',
    "parentVersion"    TEXT,
    "checksum"         TEXT NOT NULL,
    CONSTRAINT "RankerSnapshot_pkey" PRIMARY KEY ("rankerVersion")
);

-- CreateTable GscDailyPerformance
CREATE TABLE IF NOT EXISTS "GscDailyPerformance" (
    "id"          TEXT             NOT NULL,
    "siteId"      TEXT             NOT NULL,
    "url"         TEXT             NOT NULL,
    "keyword"     TEXT             NOT NULL,
    "date"        TEXT             NOT NULL,
    "clicks"      INTEGER          NOT NULL DEFAULT 0,
    "impressions" INTEGER          NOT NULL DEFAULT 0,
    "ctr"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position"    DOUBLE PRECISION NOT NULL DEFAULT 0,
    "device"      TEXT             NOT NULL DEFAULT 'ALL',
    "fetchedAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GscDailyPerformance_pkey" PRIMARY KEY ("id")
);

-- Indexes (all idempotent)
CREATE INDEX IF NOT EXISTS "InternalLink_siteId_targetUrl_idx"                  ON "InternalLink"("siteId", "targetUrl");
CREATE INDEX IF NOT EXISTS "InternalLink_siteId_sourceUrl_idx"                  ON "InternalLink"("siteId", "sourceUrl");
CREATE UNIQUE INDEX IF NOT EXISTS "InternalLink_sourceBlogId_targetBlogId_key"  ON "InternalLink"("sourceBlogId", "targetBlogId");
CREATE INDEX IF NOT EXISTS "CreditLedger_userId_createdAt_idx"                  ON "CreditLedger"("userId", "createdAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "CreditLedger_userId_referenceId_key"         ON "CreditLedger"("userId", "referenceId");
CREATE INDEX IF NOT EXISTS "GrowthDecision_siteId_status_idx"                   ON "GrowthDecision"("siteId", "status");
CREATE INDEX IF NOT EXISTS "GrowthDecision_siteId_generatedAt_idx"              ON "GrowthDecision"("siteId", "generatedAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthDecision_siteId_url_primaryKeyword_action_key" ON "GrowthDecision"("siteId", "url", "primaryKeyword", "action");
CREATE UNIQUE INDEX IF NOT EXISTS "Experiment_decisionId_key"                   ON "Experiment"("decisionId");
CREATE INDEX IF NOT EXISTS "Experiment_siteId_status_idx"                       ON "Experiment"("siteId", "status");
CREATE INDEX IF NOT EXISTS "Experiment_evaluationDate_status_idx"               ON "Experiment"("evaluationDate", "status");
CREATE INDEX IF NOT EXISTS "DailyBriefing_siteId_date_idx"                      ON "DailyBriefing"("siteId", "date" DESC);
CREATE INDEX IF NOT EXISTS "DailyBriefing_userId_idx"                           ON "DailyBriefing"("userId");
CREATE INDEX IF NOT EXISTS "CompetitorAlert_siteId_createdAt_idx"               ON "CompetitorAlert"("siteId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "RssSocialPost_siteId_idx"                           ON "RssSocialPost"("siteId");
CREATE UNIQUE INDEX IF NOT EXISTS "RssSocialPost_siteId_articleUrl_key"         ON "RssSocialPost"("siteId", "articleUrl");
CREATE INDEX IF NOT EXISTS "RankerSnapshot_status_idx"                          ON "RankerSnapshot"("status");
CREATE INDEX IF NOT EXISTS "GscDailyPerformance_siteId_date_idx"                ON "GscDailyPerformance"("siteId", "date" DESC);
CREATE INDEX IF NOT EXISTS "GscDailyPerformance_siteId_url_date_idx"            ON "GscDailyPerformance"("siteId", "url", "date" DESC);
CREATE INDEX IF NOT EXISTS "GscDailyPerformance_siteId_keyword_date_idx"        ON "GscDailyPerformance"("siteId", "keyword", "date" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "GscDailyPerformance_siteId_url_keyword_date_device_key" ON "GscDailyPerformance"("siteId", "url", "keyword", "date", "device");
CREATE INDEX IF NOT EXISTS "AiShareOfVoice_siteId_modelName_recordedAt_idx"     ON "AiShareOfVoice"("siteId", "modelName", "recordedAt" DESC);
CREATE INDEX IF NOT EXISTS "Campaign_siteId_status_idx"                         ON "Campaign"("siteId", "status");
CREATE INDEX IF NOT EXISTS "Campaign_userId_idx"                                ON "Campaign"("userId");
CREATE INDEX IF NOT EXISTS "EvidenceSnapshot_siteId_createdAt_idx"              ON "EvidenceSnapshot"("siteId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "IndexingLog_status_nextRetryAt_idx"                 ON "IndexingLog"("status", "nextRetryAt");
CREATE INDEX IF NOT EXISTS "RankSnapshot_siteId_keyword_device_recordedAt_idx"  ON "RankSnapshot"("siteId", "keyword", "device", "recordedAt" DESC);

-- Foreign Keys (idempotent via DO blocks)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InternalLink_sourceBlogId_fkey') THEN
    ALTER TABLE "InternalLink" ADD CONSTRAINT "InternalLink_sourceBlogId_fkey"
      FOREIGN KEY ("sourceBlogId") REFERENCES "Blog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InternalLink_targetBlogId_fkey') THEN
    ALTER TABLE "InternalLink" ADD CONSTRAINT "InternalLink_targetBlogId_fkey"
      FOREIGN KEY ("targetBlogId") REFERENCES "Blog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CompetitorAlertLog_siteId_fkey') THEN
    ALTER TABLE "CompetitorAlertLog" ADD CONSTRAINT "CompetitorAlertLog_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditLedger_userId_fkey') THEN
    ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GrowthDecision_siteId_fkey') THEN
    ALTER TABLE "GrowthDecision" ADD CONSTRAINT "GrowthDecision_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Experiment_siteId_fkey') THEN
    ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Experiment_decisionId_fkey') THEN
    ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_decisionId_fkey"
      FOREIGN KEY ("decisionId") REFERENCES "GrowthDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyBriefing_siteId_fkey') THEN
    ALTER TABLE "DailyBriefing" ADD CONSTRAINT "DailyBriefing_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyBriefing_userId_fkey') THEN
    ALTER TABLE "DailyBriefing" ADD CONSTRAINT "DailyBriefing_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CompetitorAlert_siteId_fkey') THEN
    ALTER TABLE "CompetitorAlert" ADD CONSTRAINT "CompetitorAlert_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RssSocialPost_siteId_fkey') THEN
    ALTER TABLE "RssSocialPost" ADD CONSTRAINT "RssSocialPost_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GscDailyPerformance_siteId_fkey') THEN
    ALTER TABLE "GscDailyPerformance" ADD CONSTRAINT "GscDailyPerformance_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
