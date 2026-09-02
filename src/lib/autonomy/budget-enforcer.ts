/**
 * Atomic Budget Enforcer — Rolling 24h mutation budget with reservation semantics.
 *
 * Usage is derived from the BudgetReservation ledger, NOT from mutable counters.
 * This eliminates cron-reset races, timezone issues, and stale counters.
 *
 * Lifecycle: RESERVED → CONSUMED | RELEASED
 *
 * CONCURRENCY MODEL:
 * The reservation is serialized by locking the SITE ROW with SELECT ... FOR UPDATE.
 * This means all concurrent budget transactions for the same site are queued:
 *
 *   Worker A: locks Site row → COUNT → 9 → INSERT #10 → COMMIT → releases lock
 *   Worker B: (blocked until A commits) → locks Site row → COUNT → 10 → EXHAUSTED
 *
 * The Site row acts as a per-site mutex. We do NOT lock BudgetReservation rows
 * (which wouldn't prevent the insert race the user identified).
 *
 * Additionally, we use pg_advisory_xact_lock as a belt-and-suspenders defense.
 *
 * Retry budget rule: One logical mutation consumes one daily budget unit.
 * Retries of the same execution do NOT consume additional daily units.
 */

import { logger } from "@/lib/logger";

// ── Types ───────────────────────────────────────────────────────────────────

export interface BudgetCheck {
  allowed: boolean;
  remaining: number;
  used: number;
  limit: number;
  reason?: string;
  nextWindowAt?: Date;
}

export interface BudgetReservationResult {
  reservationId: string;
  remaining: number;
}

// ── Rolling Window Query ────────────────────────────────────────────────────

const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// Advisory lock namespace for budget operations (arbitrary stable int)
const BUDGET_LOCK_NAMESPACE = 737001;

/**
 * Checks the current budget without reserving.
 * For display/informational purposes only — NOT for authorization decisions.
 */
export async function checkBudget(siteId: string): Promise<BudgetCheck> {
  const { prisma } = await import("@/lib/prisma");

  const site = await (prisma as any).site.findUnique({
    where: { id: siteId },
    select: { dailyMutationLimit: true },
  });

  if (!site) {
    return { allowed: false, remaining: 0, used: 0, limit: 0, reason: "Site not found" };
  }

  const windowStart = new Date(Date.now() - ROLLING_WINDOW_MS);

  // Count RESERVED + CONSUMED in the rolling window (both consume budget)
  const used = await (prisma as any).budgetReservation.count({
    where: {
      siteId,
      status: { in: ["RESERVED", "CONSUMED"] },
      reservedAt: { gte: windowStart },
    },
  });

  const remaining = Math.max(0, site.dailyMutationLimit - used);

  return {
    allowed: remaining > 0,
    remaining,
    used,
    limit: site.dailyMutationLimit,
    reason: remaining <= 0
      ? `Daily mutation budget exhausted (${used}/${site.dailyMutationLimit})`
      : undefined,
  };
}

/**
 * Atomically reserves one budget unit.
 *
 * Serialization is achieved through TWO mechanisms:
 *
 * 1. `SELECT "dailyMutationLimit" FROM "Site" WHERE "id" = $1 FOR UPDATE`
 *    — Locks the Site row. All concurrent budget transactions for the same
 *    site block here until the holding transaction commits/rolls back.
 *
 * 2. `pg_advisory_xact_lock(BUDGET_LOCK_NAMESPACE, site_hash)`
 *    — Transaction-scoped advisory lock as belt-and-suspenders.
 *    Released automatically on commit/rollback.
 *
 * Inside the serialized section:
 *   COUNT active reservations → compare to limit → INSERT if allowed.
 *
 * This guarantees:
 *   concurrent reservation attempts → successful reservations ≤ dailyMutationLimit
 *
 * Returns null if budget is exhausted.
 */
export async function reserveBudget(
  siteId: string,
  traceId?: string
): Promise<BudgetReservationResult | null> {
  const { prisma } = await import("@/lib/prisma");

  const windowStart = new Date(Date.now() - ROLLING_WINDOW_MS);

  // Compute a stable integer key from siteId for the advisory lock
  const siteHash = siteIdToInt(siteId);

  // Atomic transaction: advisory lock + row lock + count + insert
  const result = await prisma.$transaction(async (tx: any) => {
    // Belt: PostgreSQL advisory lock scoped to this transaction.
    // Blocks all concurrent budget operations for this site.
    // Released automatically when the transaction commits/rolls back.
    await tx.$queryRawUnsafe(
      `SELECT pg_advisory_xact_lock($1, $2)`,
      BUDGET_LOCK_NAMESPACE,
      siteHash
    );

    // Suspenders: Lock the Site row to serialize even if advisory locks
    // are somehow bypassed (e.g., different connection pool).
    const [site] = await tx.$queryRawUnsafe(
      `SELECT "dailyMutationLimit" FROM "Site" WHERE "id" = $1 FOR UPDATE`,
      siteId
    ) as any[];

    if (!site) {
      throw new Error(`Site ${siteId} not found`);
    }

    const limit = site.dailyMutationLimit as number;

    // Count active reservations in the rolling window.
    // This count is now serialized — no other worker can be between
    // their count and their insert for this site.
    const used = await tx.budgetReservation.count({
      where: {
        siteId,
        status: { in: ["RESERVED", "CONSUMED"] },
        reservedAt: { gte: windowStart },
      },
    });

    if (used >= limit) {
      return null; // Budget exhausted
    }

    // Create the reservation
    const reservation = await tx.budgetReservation.create({
      data: {
        siteId,
        traceId,
        status: "RESERVED",
      },
    });

    return {
      reservationId: reservation.id,
      remaining: limit - used - 1,
    };
  });

  if (result) {
    logger.info("[BudgetEnforcer] Budget reserved", {
      siteId,
      reservationId: result.reservationId,
      remaining: result.remaining,
    });
  } else {
    logger.warn("[BudgetEnforcer] Budget exhausted", { siteId });
  }

  return result;
}

/**
 * Marks a reservation as consumed (execution started successfully).
 */
export async function consumeReservation(
  reservationId: string,
  operationId: string
): Promise<void> {
  const { prisma } = await import("@/lib/prisma");

  await (prisma as any).budgetReservation.update({
    where: { id: reservationId },
    data: {
      status: "CONSUMED",
      operationId,
      consumedAt: new Date(),
    },
  });

  logger.info("[BudgetEnforcer] Reservation consumed", { reservationId, operationId });
}

/**
 * Releases a reservation (execution failed or was blocked).
 * Released reservations do NOT count against the daily budget.
 */
export async function releaseReservation(
  reservationId: string,
  reason: string
): Promise<void> {
  const { prisma } = await import("@/lib/prisma");

  await (prisma as any).budgetReservation.update({
    where: { id: reservationId },
    data: {
      status: "RELEASED",
      releasedAt: new Date(),
      reason,
    },
  });

  logger.info("[BudgetEnforcer] Reservation released", { reservationId, reason });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Converts a CUID string to a stable 32-bit integer for pg_advisory_xact_lock.
 * Uses a simple hash — collisions are acceptable since the Site FOR UPDATE
 * lock provides the actual serialization guarantee.
 */
function siteIdToInt(siteId: string): number {
  let hash = 0;
  for (let i = 0; i < siteId.length; i++) {
    const char = siteId.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0; // Convert to 32-bit int
  }
  return hash;
}
