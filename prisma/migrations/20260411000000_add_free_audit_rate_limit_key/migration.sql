-- Migration: add rateLimitKey to FreeAudit
-- Separates the rate-limit key ("ip::domain") from the clean display domain
-- so audit.domain never shows "1.2.3.4::example.com" in UI or emails.

ALTER TABLE "FreeAudit" ADD COLUMN "rateLimitKey" TEXT;

-- Backfill existing rows: extract the ip::domain entry stored in the
-- domain column for rows that contain "::" (pre-fix rows).
-- For already-clean rows (no "::") rateLimitKey stays NULL which is fine.
UPDATE "FreeAudit"
SET
  "rateLimitKey" = "domain",
  "domain"       = SPLIT_PART("domain", '::', 2)
WHERE "domain" LIKE '%::%';

-- Index for fast IP-scoped count queries used by rate limiting
CREATE INDEX "FreeAudit_rateLimitKey_idx" ON "FreeAudit"("rateLimitKey");
