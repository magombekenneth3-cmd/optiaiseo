-- Phase D.6 Gate 7 Fix: Replace four-column unique constraint with partial unique index.
--
-- Problem: @@unique([siteId, signalType, actionType, status]) allowed at most
-- ONE row per status value per key, destroying signal history (e.g. only one
-- SUPERSEDED signal could exist per site/signalType/actionType combo).
--
-- Solution: Drop the four-column unique constraint and create a PostgreSQL
-- partial unique index that enforces at most one ACTIVE signal per key while
-- allowing unlimited historical (PROPOSED, SUPERSEDED, REVOKED) records.

-- Step 1: Drop the old four-column unique constraint
DROP INDEX IF EXISTS "LearnedSignal_siteId_signalType_actionType_status_key";

-- Step 2: Create partial unique index — at most one ACTIVE per key
CREATE UNIQUE INDEX "learned_signal_one_active"
ON "LearnedSignal" ("siteId", "signalType", "actionType")
WHERE "status" = 'ACTIVE';

-- Step 3: Add composite index for registry lookups
CREATE INDEX IF NOT EXISTS "LearnedSignal_siteId_signalType_actionType_idx"
ON "LearnedSignal" ("siteId", "signalType", "actionType");
