/**
 * Atomic Concurrency Lease — Prevents exceeding maxConcurrentExecutions.
 *
 * CONCURRENCY MODEL:
 * Serialization uses the same dual-lock pattern as budget-enforcer.ts:
 *
 * 1. pg_advisory_xact_lock — Transaction-scoped advisory lock per site.
 * 2. SELECT Site FOR UPDATE — Row-level lock on the Site row.
 *
 * Inside the serialized section:
 *   COUNT EXECUTING operations → compare to limit → allow or reject.
 *
 * The concurrency slot is implicitly claimed when the operation transitions
 * to EXECUTING via Phase B's claimExecution(). The slot is released when
 * the operation leaves EXECUTING (commit, fail, or timeout).
 *
 * This guarantees:
 *   concurrent slot checks → active EXECUTING operations ≤ maxConcurrentExecutions
 */

import { logger } from "@/lib/logger";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ConcurrencyCheck {
  allowed: boolean;
  activeCount: number;
  limit: number;
  reason?: string;
}

// Advisory lock namespace for concurrency operations (distinct from budget)
const CONCURRENCY_LOCK_NAMESPACE = 737002;

// ── Core Functions ──────────────────────────────────────────────────────────

/**
 * Atomically checks whether a new autonomous execution can start for this site.
 *
 * Uses pg_advisory_xact_lock + Site FOR UPDATE to serialize the check.
 * The active execution count is derived from MutationOperation records
 * currently in EXECUTING status.
 *
 * Returns { allowed: true } if a slot is available.
 * Returns { allowed: false } if the concurrency limit is reached.
 *
 * IMPORTANT: This check is serialized so that two workers cannot both
 * observe activeCount=1 when limit=2 and both proceed. One will block
 * until the other's transaction completes.
 *
 * The slot is NOT reserved here — it is implicitly claimed when the
 * operation transitions to EXECUTING via Phase B's claimExecution().
 * Between this check and the actual execution claim, the slot could be
 * taken. The Phase B claim has its own atomicity guarantee.
 */
export async function checkConcurrencySlot(siteId: string): Promise<ConcurrencyCheck> {
  const { prisma } = await import("@/lib/prisma");

  const siteHash = siteIdToInt(siteId);

  const result = await prisma.$transaction(async (tx: any) => {
    // Belt: advisory lock
    await tx.$queryRawUnsafe(
      `SELECT pg_advisory_xact_lock($1, $2)`,
      CONCURRENCY_LOCK_NAMESPACE,
      siteHash
    );

    // Suspenders: lock Site row
    const [site] = await tx.$queryRawUnsafe(
      `SELECT "maxConcurrentExecutions" FROM "Site" WHERE "id" = $1 FOR UPDATE`,
      siteId
    ) as any[];

    if (!site) {
      return {
        allowed: false,
        activeCount: 0,
        limit: 0,
        reason: `Site ${siteId} not found`,
      };
    }

    const limit = site.maxConcurrentExecutions as number;

    // Count operations currently executing for this site.
    // This count is serialized — no race between count and slot usage.
    const activeCount = await tx.mutationOperation.count({
      where: {
        siteId,
        status: "EXECUTING",
      },
    });

    if (activeCount >= limit) {
      return {
        allowed: false,
        activeCount,
        limit,
        reason: `Concurrency limit reached (${activeCount}/${limit} executing)`,
      };
    }

    return {
      allowed: true,
      activeCount,
      limit,
    };
  });

  if (!result.allowed) {
    logger.info("[ConcurrencyLease] Slot unavailable", {
      siteId,
      activeCount: result.activeCount,
      limit: result.limit,
    });
  }

  return result;
}

/**
 * Informational check (non-locking) for display purposes.
 * Do NOT use this for authorization decisions.
 */
export async function getConcurrencyStatus(siteId: string): Promise<ConcurrencyCheck> {
  const { prisma } = await import("@/lib/prisma");

  const [site, activeCount] = await Promise.all([
    (prisma as any).site.findUnique({
      where: { id: siteId },
      select: { maxConcurrentExecutions: true },
    }),
    prisma.mutationOperation.count({
      where: { siteId, status: "EXECUTING" },
    }),
  ]);

  if (!site) {
    return { allowed: false, activeCount: 0, limit: 0, reason: "Site not found" };
  }

  const limit = site.maxConcurrentExecutions;

  return {
    allowed: activeCount < limit,
    activeCount,
    limit,
    reason: activeCount >= limit
      ? `Concurrency limit reached (${activeCount}/${limit})`
      : undefined,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function siteIdToInt(siteId: string): number {
  let hash = 0;
  for (let i = 0; i < siteId.length; i++) {
    const char = siteId.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash;
}
