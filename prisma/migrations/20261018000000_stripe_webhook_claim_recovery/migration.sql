-- PR 2: Stripe webhook crash recovery (claim metadata).
-- Generated offline with `prisma migrate diff` (schema → schema); review before applying.
-- Additive only: no drops, renames, or rewrites. Existing rows get attempts = 0,
-- claimedAt = NULL, updatedAt = now(). Existing RECEIVED rows with claimedAt NULL
-- are picked up by the stale-claim rule via createdAt.
--
-- Note: CREATE INDEX (non-concurrent) briefly locks writes on "WebhookEvent".
-- This table is small/append-only; if it is large in production, create the index
-- CONCURRENTLY out-of-band first and mark this migration as applied.

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "WebhookEvent_status_claimedAt_idx" ON "WebhookEvent"("status", "claimedAt");
