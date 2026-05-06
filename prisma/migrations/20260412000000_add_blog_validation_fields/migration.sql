-- Add blog validation and fact-check columns.
-- These fields are written by the blog generation pipeline (save-blog step)
-- but were missing from the Blog table, causing PrismaClientValidationError.

ALTER TABLE "Blog"
  ADD COLUMN IF NOT EXISTS "validationScore"       INTEGER,
  ADD COLUMN IF NOT EXISTS "validationErrors"      TEXT[]   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "validationWarnings"    TEXT[]   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "factCheckIssues"       TEXT[]   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "factCheckSuggestions"  TEXT[]   NOT NULL DEFAULT '{}';
