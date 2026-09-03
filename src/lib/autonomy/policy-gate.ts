/**
 * Autonomy Policy Gate — Single authorization boundary for all autonomous mutations.
 *
 * INVARIANT: No autonomous mutation may reach the Phase B mutation execution
 * boundary without a fresh, deterministic authorization decision that validates:
 *   1. Operating mode
 *   2. Effective tier limit
 *   3. Atomic budget reservation
 *   4. Atomic concurrency lease
 *   5. Circuit breaker state
 *   6. Idempotent execution claim
 *
 * Each check is sequential and fail-closed. If any check fails, all prior
 * reservations are released atomically.
 *
 * The LLM has ZERO authority over any of these decisions.
 */

import { logger } from "@/lib/logger";
import type { SafetyTier, ActionType } from "@/lib/proposals/types";
import type { RiskLevel } from "@/lib/mutations/types";
import { effectiveTierLimit, isReportOnly } from "./operating-modes";
import { reserveBudget, releaseReservation } from "./budget-enforcer";
import { checkConcurrencySlot } from "./concurrency-lease";
import { checkCircuitBreaker, type CircuitChannel } from "./circuit-breaker";
import { claimExecution, releaseClaim, getWorkerId, ClaimOwnershipError } from "./execution-claim";

// ── Types ───────────────────────────────────────────────────────────────────

export interface AuthorizationRequest {
  siteId: string;
  opportunityId: string;
  proposalId: string;
  actionType: ActionType;
  safetyTier: SafetyTier;
  riskLevel: RiskLevel;
  riskScore: number;
  /** The execution channel (for circuit breaker scope) */
  channel: CircuitChannel;
  actorType: "SYSTEM" | "USER";
  actorId: string;
  traceId?: string;
}

export type AuthorizationDecision =
  | {
      authorized: true;
      reservationId: string;
      claimId: string;
      workerId: string;
      generation: number;
      circuitBreakerState: string;
      isProbe: boolean;
      reason: string;
    }
  | {
      authorized: false;
      action: "NEEDS_APPROVAL" | "BLOCKED";
      reason: string;
      /** Which gate failed */
      failedGate: string;
    };

// ── Cleanup Helper ──────────────────────────────────────────────────────────

interface PartialReservations {
  reservationId?: string;
  claimId?: string;
  workerId?: string;
  generation?: number;
}

async function releasePartialReservations(
  partial: PartialReservations,
  reason: string
): Promise<void> {
  try {
    if (partial.claimId && partial.workerId && partial.generation !== undefined) {
      await releaseClaim(partial.claimId, partial.workerId, partial.generation, reason).catch((err) => {
        // ClaimOwnershipError is expected if the claim was already recovered
        if (!(err instanceof ClaimOwnershipError)) throw err;
        logger.warn("[PolicyGate] Claim already released/recovered", {
          claimId: partial.claimId,
        });
      });
    }
    if (partial.reservationId) {
      await releaseReservation(partial.reservationId, reason);
    }
  } catch (cleanupErr) {
    logger.error("[PolicyGate] Failed to release partial reservations", {
      partial,
      reason,
      error: (cleanupErr as Error)?.message,
    });
  }
}

// ── Main Authorization Function ─────────────────────────────────────────────

/**
 * Evaluates all authorization gates sequentially.
 *
 * Gate 0: Global kill switch
 * Gate 1: Operating mode
 * Gate 1.5: Hourly rate limit (env-driven backstop)
 * Gate 2: Effective tier limit
 * Gate 3: Atomic budget reservation
 * Gate 4: Atomic concurrency check
 * Gate 5: Circuit breaker
 * Gate 6: Idempotent execution claim
 *
 * Returns AUTHORIZED with reservation IDs if all gates pass.
 * Returns NEEDS_APPROVAL or BLOCKED if any gate fails.
 *
 * All partial reservations are released on failure.
 */
export async function authorize(
  req: AuthorizationRequest
): Promise<AuthorizationDecision> {
  const { prisma } = await import("@/lib/prisma");
  const { getAutonomousConfig } = await import("@/lib/config/env-validator");
  const partial: PartialReservations = {};

  try {
    // ── Gate 0: Global Kill Switch ──────────────────────────────────────
    const autonomousConfig = getAutonomousConfig();

    if (autonomousConfig.globalKillSwitch) {
      logger.warn("[PolicyGate] Global kill switch is active — blocking all autonomous authorizations", {
        siteId: req.siteId,
        proposalId: req.proposalId,
      });
      return {
        authorized: false,
        action: "BLOCKED",
        reason: "Global autonomous kill switch is active — all autonomous mutations are halted",
        failedGate: "kill_switch",
      };
    }

    // ── Gate 1: Operating Mode ────────────────────────────────────────────
    const site = await prisma.site.findUnique({
      where: { id: req.siteId },
      select: {
        operatingMode: true,
        dailyMutationLimit: true,
        maxConcurrentExecutions: true,
      },
    });

    if (!site) {
      return {
        authorized: false,
        action: "BLOCKED",
        reason: `Site ${req.siteId} not found`,
        failedGate: "operating_mode",
      };
    }

    if (isReportOnly(site.operatingMode)) {
      return {
        authorized: false,
        action: "BLOCKED",
        reason: `Site is in REPORT_ONLY mode — no autonomous mutations allowed`,
        failedGate: "operating_mode",
      };
    }

    // ── Gate 1.5: Hourly Rate Limit ──────────────────────────────────────
    // Environment-driven backstop: limits total proposals created per hour
    // for this site, independent of the per-site dailyMutationLimit.
    const maxPerHour = autonomousConfig.maxProposalsPerHour;
    if (maxPerHour > 0) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentCount = await prisma.actionProposal.count({
        where: {
          siteId: req.siteId,
          createdAt: { gte: oneHourAgo },
        },
      });

      if (recentCount >= maxPerHour) {
        logger.info("[PolicyGate] Hourly rate limit reached", {
          siteId: req.siteId,
          recentCount,
          maxPerHour,
        });
        return {
          authorized: false,
          action: "BLOCKED",
          reason: `Hourly proposal rate limit reached (${recentCount}/${maxPerHour})`,
          failedGate: "rate_limit",
        };
      }
    }

    // ── Gate 2: Effective Tier Limit ──────────────────────────────────────
    const tierLimit = effectiveTierLimit(site);

    if (req.safetyTier > tierLimit) {
      return {
        authorized: false,
        action: "NEEDS_APPROVAL",
        reason: `Safety tier ${req.safetyTier} exceeds autonomous limit (${tierLimit}) for ${site.operatingMode} mode`,
        failedGate: "tier_limit",
      };
    }

    // ── Gate 3: Atomic Budget Reservation ─────────────────────────────────
    const budgetResult = await reserveBudget(req.siteId, req.traceId);

    if (!budgetResult) {
      return {
        authorized: false,
        action: "BLOCKED",
        reason: `Daily mutation budget exhausted for site ${req.siteId}`,
        failedGate: "budget",
      };
    }

    partial.reservationId = budgetResult.reservationId;

    // ── Gate 4: Atomic Concurrency Check ──────────────────────────────────
    const concurrencyResult = await checkConcurrencySlot(req.siteId);

    if (!concurrencyResult.allowed) {
      await releasePartialReservations(partial, concurrencyResult.reason ?? "Concurrency limit");
      return {
        authorized: false,
        action: "BLOCKED",
        reason: concurrencyResult.reason ?? "Concurrency limit reached",
        failedGate: "concurrency",
      };
    }

    // ── Gate 5: Circuit Breaker ───────────────────────────────────────────
    const circuitResult = await checkCircuitBreaker(req.siteId, req.channel);

    if (!circuitResult.allowed) {
      await releasePartialReservations(partial, circuitResult.reason ?? "Circuit open");
      return {
        authorized: false,
        action: "BLOCKED",
        reason: circuitResult.reason ?? `Circuit breaker OPEN for ${req.channel}`,
        failedGate: "circuit_breaker",
      };
    }

    // ── Gate 6: Idempotent Execution Claim ────────────────────────────────
    const claimResult = await claimExecution(
      req.siteId,
      req.opportunityId,
      req.proposalId
    );

    if (!claimResult.claimed) {
      await releasePartialReservations(partial, claimResult.reason ?? "Already claimed");
      return {
        authorized: false,
        action: "BLOCKED",
        reason: claimResult.reason ?? "Opportunity already claimed",
        failedGate: "execution_claim",
      };
    }

    partial.claimId = claimResult.claimId;
    partial.workerId = claimResult.workerId;
    partial.generation = claimResult.generation;

    // ── All Gates Passed ─────────────────────────────────────────────────
    logger.info("[PolicyGate] AUTHORIZED", {
      siteId: req.siteId,
      opportunityId: req.opportunityId,
      actionType: req.actionType,
      safetyTier: req.safetyTier,
      channel: req.channel,
      reservationId: budgetResult.reservationId,
      claimId: claimResult.claimId,
      circuitState: circuitResult.state,
      isProbe: circuitResult.isProbe,
      budgetRemaining: budgetResult.remaining,
    });

    return {
      authorized: true,
      reservationId: budgetResult.reservationId,
      claimId: claimResult.claimId!,
      workerId: claimResult.workerId!,
      generation: claimResult.generation!,
      circuitBreakerState: circuitResult.state,
      isProbe: circuitResult.isProbe,
      reason: `Authorized: Tier ${req.safetyTier} ≤ limit ${tierLimit}, budget ${budgetResult.remaining} remaining, circuit ${circuitResult.state}`,
    };
  } catch (err) {
    // Any unexpected error → release all reservations and fail closed
    logger.error("[PolicyGate] Unexpected error — failing closed", {
      siteId: req.siteId,
      opportunityId: req.opportunityId,
      error: (err as Error)?.message,
    });

    await releasePartialReservations(partial, `Unexpected error: ${(err as Error)?.message}`);

    return {
      authorized: false,
      action: "BLOCKED",
      reason: `Policy gate error: ${(err as Error)?.message}`,
      failedGate: "unexpected_error",
    };
  }
}
