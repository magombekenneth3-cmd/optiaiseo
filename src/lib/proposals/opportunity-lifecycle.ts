// =============================================================================
// OPPORTUNITY LIFECYCLE STATE MACHINE
//
// Manages the GrowthDecision.opportunityStatus transitions.
// Each transition is validated, audited, and persisted atomically.
//
// State flow:
//   OPEN → PROPOSED → APPROVED → EXECUTING → VERIFYING → VERIFIED
//   Failure paths: → FAILED → OPEN (retry) | ROLLED_BACK
//   Rejection:     PROPOSED → REJECTED → OPEN (re-open)
//   Expiry:        * → EXPIRED → OPEN (re-open)
// =============================================================================

import { logger } from "@/lib/logger";
import {
  type OpportunityStatus,
  OPPORTUNITY_TRANSITIONS,
  TERMINAL_OPPORTUNITY_STATUSES,
  OpportunityTransitionError,
} from "./types";

// ── Transition Validation ───────────────────────────────────────────────────

/**
 * Asserts that a state transition is valid per the opportunity state machine.
 * @throws {OpportunityTransitionError} if the transition is not allowed.
 */
export function assertValidOpportunityTransition(
  from: OpportunityStatus,
  to: OpportunityStatus
): void {
  const allowed = OPPORTUNITY_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new OpportunityTransitionError(from, to);
  }
}

/**
 * Returns whether a status is terminal (no further transitions allowed).
 */
export function isTerminalOpportunityStatus(
  status: OpportunityStatus
): boolean {
  return TERMINAL_OPPORTUNITY_STATUSES.includes(status);
}

// ── Transition Metadata ─────────────────────────────────────────────────────

export interface OpportunityTransitionInput {
  decisionId: string;
  from: OpportunityStatus;
  to: OpportunityStatus;
  actorId: string;
  reason?: string;
  proposalId?: string;
  operationId?: string;
}

// ── Transition Execution ────────────────────────────────────────────────────

/**
 * Transitions a GrowthDecision to a new opportunityStatus.
 *
 * 1. Validates the transition is legal
 * 2. Atomically updates the status (with optimistic guard on `from`)
 * 3. Logs the transition
 *
 * @returns true if transition was applied, false if status was already changed
 */
export async function transitionOpportunity(
  input: OpportunityTransitionInput
): Promise<boolean> {
  const { decisionId, from, to, actorId, reason, proposalId, operationId } =
    input;

  // Validate
  assertValidOpportunityTransition(from, to);

  const { prisma } = await import("@/lib/prisma");

  // Atomic guard: only update if the current status matches `from`
  const result = await (prisma as any).growthDecision.updateMany({
    where: {
      id: decisionId,
      opportunityStatus: from,
    },
    data: {
      opportunityStatus: to,
      updatedAt: new Date(),
    },
  });

  if (result.count === 0) {
    logger.warn("[OpportunityLifecycle] Transition guard failed — status already changed", {
      decisionId,
      expectedFrom: from,
      requestedTo: to,
      actorId,
    });
    return false;
  }

  logger.info("[OpportunityLifecycle] Transition applied", {
    decisionId,
    from,
    to,
    actorId,
    reason,
    proposalId,
    operationId,
  });

  return true;
}

/**
 * Reads the current opportunity status for a GrowthDecision.
 */
export async function getOpportunityStatus(
  decisionId: string
): Promise<OpportunityStatus | null> {
  const { prisma } = await import("@/lib/prisma");

  const decision = await (prisma as any).growthDecision.findUnique({
    where: { id: decisionId },
    select: { opportunityStatus: true },
  });

  return (decision?.opportunityStatus as OpportunityStatus) ?? null;
}

/**
 * Finds all opportunities in a given status for a site.
 */
export async function findOpportunitiesByStatus(
  siteId: string,
  status: OpportunityStatus
): Promise<Array<{ id: string; url: string; primaryKeyword: string; action: string }>> {
  const { prisma } = await import("@/lib/prisma");

  return (prisma as any).growthDecision.findMany({
    where: {
      siteId,
      opportunityStatus: status,
    },
    select: {
      id: true,
      url: true,
      primaryKeyword: true,
      action: true,
    },
    orderBy: { generatedAt: "desc" },
  });
}
