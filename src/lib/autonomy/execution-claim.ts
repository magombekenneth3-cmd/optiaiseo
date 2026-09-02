/**
 * Idempotent Execution Claim — Prevents duplicate autonomous executions.
 *
 * INVARIANT: One opportunity → one claim row → one active execution at a time.
 *
 * SCHEMA:
 * AutonomousExecutionClaim has @@unique([opportunityId]) — exactly one row per
 * opportunity. Claims are UPDATED in place, not deleted and recreated.
 *
 * FENCING MODEL:
 * Each claim has a monotonically increasing `generation` counter.
 * When a stale claim is released and re-acquired:
 *   Worker A: generation=1 (released by reconciler)
 *   Worker B: generation=2 (re-acquired)
 *   Worker A tries to cross Phase B boundary → generation mismatch → ABORT
 *
 * The authorization decision carries { claimId, workerId, generation }.
 * Before crossing the Phase B mutation boundary, the executor calls
 * `verifyClaimBeforeExecution(claimId, workerId, generation)`.
 *
 * CONCURRENCY MODEL:
 * Uses pg_advisory_xact_lock per-opportunity to serialize claim operations.
 * The @@unique([opportunityId]) constraint provides a database-level fallback.
 */

import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { hostname } from "os";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ExecutionClaimResult {
  claimed: boolean;
  claimId?: string;
  workerId?: string;
  generation?: number;
  reason?: string;
}

// Advisory lock namespace for execution claims
const CLAIM_LOCK_NAMESPACE = 737003;

/** Stale claim timeout: 10 minutes */
export const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

// ── Errors ──────────────────────────────────────────────────────────────────

/**
 * Thrown when a worker tries to complete/release a claim it doesn't own,
 * or when a stale worker's generation no longer matches the current claim.
 */
export class ClaimOwnershipError extends Error {
  public readonly claimId: string;
  public readonly workerId: string;

  constructor(claimId: string, workerId: string) {
    super(
      `[ExecutionClaim] Worker "${workerId}" does not own claim "${claimId}". ` +
      "The claim may have been recovered by the reconciler and re-acquired."
    );
    this.name = "ClaimOwnershipError";
    this.claimId = claimId;
    this.workerId = workerId;
  }
}

/**
 * Thrown when a stale worker tries to cross the Phase B mutation boundary
 * but its generation no longer matches the current claim.
 */
export class StaleExecutionError extends Error {
  public readonly claimId: string;
  public readonly expectedGeneration: number;

  constructor(claimId: string, expectedGeneration: number) {
    super(
      `[ExecutionClaim] Claim "${claimId}" generation ${expectedGeneration} is stale. ` +
      "A newer generation has been acquired. Mutation MUST NOT proceed."
    );
    this.name = "StaleExecutionError";
    this.claimId = claimId;
    this.expectedGeneration = expectedGeneration;
  }
}

// ── Worker Identity ─────────────────────────────────────────────────────────

let _cachedWorkerId: string | null = null;

export function getWorkerId(): string {
  if (!_cachedWorkerId) {
    _cachedWorkerId = `${hostname()}:${process.pid}:${Date.now()}`;
  }
  return _cachedWorkerId;
}

// ── Core Functions ──────────────────────────────────────────────────────────

/**
 * Attempts to claim exclusive execution rights for an opportunity.
 *
 * Uses upsert semantics on the single claim row per opportunity:
 * - If no row exists → INSERT (generation=1, ACTIVE)
 * - If row exists and ACTIVE → reject (already claimed)
 * - If row exists and RELEASED/COMPLETED → UPDATE to ACTIVE, increment generation
 *
 * Returns { claimed: true, claimId, workerId, generation } on success.
 * Returns { claimed: false, reason } if already claimed.
 */
export async function claimExecution(
  siteId: string,
  opportunityId: string,
  proposalId: string
): Promise<ExecutionClaimResult> {
  const { prisma } = await import("@/lib/prisma");
  const workerId = getWorkerId();
  const oppHash = stringToInt(opportunityId);

  try {
    const claim = await prisma.$transaction(async (tx: any) => {
      // Advisory lock on the opportunity
      await tx.$queryRawUnsafe(
        `SELECT pg_advisory_xact_lock($1, $2)`,
        CLAIM_LOCK_NAMESPACE,
        oppHash
      );

      // Check existing claim
      const existing = await tx.autonomousExecutionClaim.findUnique({
        where: { opportunityId },
      });

      if (existing && existing.status === "ACTIVE") {
        return null; // Already actively claimed
      }

      if (existing) {
        // Re-acquire: increment generation, reset to ACTIVE
        return tx.autonomousExecutionClaim.update({
          where: { opportunityId },
          data: {
            siteId,
            proposalId,
            claimedBy: workerId,
            claimedAt: new Date(),
            generation: existing.generation + 1,
            status: "ACTIVE",
            completedAt: null,
            releasedAt: null,
            releaseReason: null,
          },
        });
      }

      // First claim for this opportunity
      return tx.autonomousExecutionClaim.create({
        data: {
          siteId,
          opportunityId,
          proposalId,
          claimedBy: workerId,
          status: "ACTIVE",
          generation: 1,
        },
      });
    });

    if (!claim) {
      logger.info("[ExecutionClaim] Already claimed — skipping", {
        opportunityId,
        worker: workerId,
      });
      return {
        claimed: false,
        reason: `Opportunity ${opportunityId} already has an active execution claim`,
      };
    }

    logger.info("[ExecutionClaim] Claimed", {
      claimId: claim.id,
      opportunityId,
      generation: claim.generation,
      worker: workerId,
    });

    return {
      claimed: true,
      claimId: claim.id,
      workerId,
      generation: claim.generation,
    };
  } catch (err) {
    // Unique constraint violation (@@unique on opportunityId) — race caught by DB
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      logger.info("[ExecutionClaim] Concurrent claim blocked by DB constraint", {
        opportunityId,
        worker: workerId,
      });
      return {
        claimed: false,
        reason: `Opportunity ${opportunityId} claimed by another worker (DB constraint)`,
      };
    }

    logger.error("[ExecutionClaim] Unexpected error", {
      opportunityId,
      error: (err as Error)?.message,
    });
    return {
      claimed: false,
      reason: `Unexpected error: ${(err as Error)?.message}`,
    };
  }
}

/**
 * FENCING CHECK — Must be called immediately before the Phase B mutation boundary.
 *
 * Verifies that:
 *   1. The claim row still exists
 *   2. The claim is still ACTIVE
 *   3. The generation matches (hasn't been released + re-acquired)
 *   4. The caller is still the owner
 *
 * If any check fails → throws StaleExecutionError.
 * The caller MUST abort all mutation work.
 *
 * This closes the race where:
 *   Worker A authorized (gen=1) → slow LLM work → reconciler releases →
 *   Worker B reclaims (gen=2) → Worker A tries to execute → BLOCKED.
 */
export async function verifyClaimBeforeExecution(
  claimId: string,
  workerId: string,
  generation: number
): Promise<void> {
  const { prisma } = await import("@/lib/prisma");

  const claim = await (prisma as any).autonomousExecutionClaim.findFirst({
    where: {
      id: claimId,
      claimedBy: workerId,
      generation,
      status: "ACTIVE",
    },
  });

  if (!claim) {
    logger.error("[ExecutionClaim] Fencing check FAILED — stale execution blocked", {
      claimId,
      workerId,
      expectedGeneration: generation,
    });
    throw new StaleExecutionError(claimId, generation);
  }

  logger.info("[ExecutionClaim] Fencing check passed", {
    claimId,
    workerId,
    generation,
  });
}

/**
 * Marks a claim as completed. Verifies ownership + generation.
 */
export async function completeClaim(
  claimId: string,
  workerId: string,
  generation: number
): Promise<void> {
  const { prisma } = await import("@/lib/prisma");

  const result = await (prisma as any).autonomousExecutionClaim.updateMany({
    where: {
      id: claimId,
      claimedBy: workerId,
      generation,
      status: "ACTIVE",
    },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  if (result.count === 0) {
    throw new ClaimOwnershipError(claimId, workerId);
  }

  logger.info("[ExecutionClaim] Completed", { claimId, workerId, generation });
}

/**
 * Releases a claim. Verifies ownership + generation.
 */
export async function releaseClaim(
  claimId: string,
  workerId: string,
  generation: number,
  reason: string
): Promise<void> {
  const { prisma } = await import("@/lib/prisma");

  const result = await (prisma as any).autonomousExecutionClaim.updateMany({
    where: {
      id: claimId,
      claimedBy: workerId,
      generation,
      status: "ACTIVE",
    },
    data: {
      status: "RELEASED",
      releasedAt: new Date(),
      releaseReason: reason,
    },
  });

  if (result.count === 0) {
    throw new ClaimOwnershipError(claimId, workerId);
  }

  logger.info("[ExecutionClaim] Released", { claimId, workerId, generation, reason });
}

/**
 * Releases stale ACTIVE claims whose claimedAt exceeds the timeout.
 * Called by the reconciler. Does NOT increment generation — that happens
 * on re-acquisition.
 */
export async function releaseStaleActiveClaims(): Promise<number> {
  const { prisma } = await import("@/lib/prisma");

  const cutoff = new Date(Date.now() - CLAIM_TIMEOUT_MS);

  const result = await (prisma as any).autonomousExecutionClaim.updateMany({
    where: {
      status: "ACTIVE",
      claimedAt: { lte: cutoff },
    },
    data: {
      status: "RELEASED",
      releasedAt: new Date(),
      releaseReason: "Claim timed out — worker presumed crashed (reconciler recovery)",
    },
  });

  if (result.count > 0) {
    logger.warn("[ExecutionClaim] Released stale claims (crash recovery)", {
      count: result.count,
      cutoff: cutoff.toISOString(),
    });
  }

  return result.count;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function stringToInt(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash;
}
