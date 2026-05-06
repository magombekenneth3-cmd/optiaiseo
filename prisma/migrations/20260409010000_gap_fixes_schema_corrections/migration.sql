-- ==========================================================================
-- Migration: gap_fixes_schema_corrections
-- Applies schema gap fixes 3.6, 4.1, 4.3, 4.4 from plan3.txt
-- ==========================================================================

-- Gap 4.1: CompetitorKeyword.position Float? → Int?
-- Positions are always integers (1, 2, 3...). ROUND() preserves any existing
-- float data without data loss.
ALTER TABLE "CompetitorKeyword"
  ALTER COLUMN "position" TYPE INTEGER
  USING ROUND("position")::INTEGER;

-- Gap 4.3: TeamInvitation — add indexes on email and ownerId
-- Without these, listing pending invitations for an owner or checking
-- if an email already has an invite both require full table scans.
CREATE INDEX IF NOT EXISTS "TeamInvitation_ownerId_idx" ON "TeamInvitation" ("ownerId");
CREATE INDEX IF NOT EXISTS "TeamInvitation_email_idx"   ON "TeamInvitation" ("email");

-- Gap 4.4: AeoSnapshot — unique constraint on (siteId, DATE(createdAt))
-- Prevents double-insertion when the AEO cron job retries (Inngest retry).
-- Note: PostgreSQL does not support functional unique indexes in Prisma directly,
-- so we create a partial expression index on the date portion.
CREATE UNIQUE INDEX IF NOT EXISTS "AeoSnapshot_siteId_day_key"
  ON "AeoSnapshot" ("siteId", DATE("createdAt"));

-- Gap 3.6: AiShareOfVoice.modelName — remove the default value
-- The default "gemini-2.5-flash" was mislabelling ChatGPT/Claude/Perplexity SOV records.
-- All callers must now explicitly set modelName to the actual model identifier.
-- Note: removing a column default does not affect existing data.
ALTER TABLE "AiShareOfVoice" ALTER COLUMN "modelName" DROP DEFAULT;
