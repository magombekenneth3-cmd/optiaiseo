// =============================================================================
// PROPOSAL ROLLBACK — Triggers Compensation for Committed Proposals
//
// Eligible statuses (Amendment #3):
//   VERIFIED — post-verification regression detected
//   FAILED   — operation committed but verification failed
//   EXECUTED — operation committed, not yet verified
//
// NOT eligible:
//   EXECUTING — race condition with ActionRunner (Amendment #3)
//   Any other status — no committed operation to roll back
//
// Delegates to mutations/compensation.ts for actual DB + effect rollback.
// Transitions proposal → ROLLED_BACK and opportunity → ROLLED_BACK.
// =============================================================================

import { logger } from "@/lib/logger";
import { compensateOperation } from "@/lib/mutations/compensation";
import {
  ROLLBACK_ELIGIBLE_PROPOSAL_STATUSES,
  type ProposalStatus,
} from "./types";
import { transitionOpportunity } from "./opportunity-lifecycle";

// ── Public API ──────────────────────────────────────────────────────────────

export interface RollbackProposalInput {
  /** The proposal ID to roll back */
  proposalId: string;
  /** Actor initiating the rollback (user ID or "system:*") */
  actorId: string;
  /** Human-readable reason for the rollback */
  reason: string;
}

export interface RollbackProposalResult {
  proposalId: string;
  operationId: string | null;
  status: "ROLLED_BACK" | "ROLLBACK_PARTIAL" | "INELIGIBLE" | "NO_OPERATION" | "ERROR";
  reason: string;
  compensationDetails?: {
    dbRollbackSuccess: boolean | null;
    effectsCompensated: number;
    effectsFailed: number;
  };
}

/**
 * Rolls back a committed proposal by compensating its underlying MutationOperation.
 *
 * Flow:
 *   1. Load the proposal and validate eligibility
 *   2. Verify an operation exists (no operation = nothing to roll back)
 *   3. Delegate to compensateOperation() from the mutations layer
 *   4. Transition proposal → ROLLED_BACK
 *   5. Transition opportunity → ROLLED_BACK
 *   6. Record rollback metadata on the proposal
 */
export async function rollbackProposal(
  input: RollbackProposalInput
): Promise<RollbackProposalResult> {
  const { prisma } = await import("@/lib/prisma");

  // 1. Load proposal
  const proposal = await (prisma as any).actionProposal.findUnique({
    where: { id: input.proposalId },
    select: {
      id: true,
      status: true,
      operationId: true,
      decisionId: true,
      actionType: true,
      targetUrl: true,
      decision: {
        select: {
          opportunityStatus: true,
        },
      },
    },
  });

  if (!proposal) {
    return {
      proposalId: input.proposalId,
      operationId: null,
      status: "ERROR",
      reason: `Proposal ${input.proposalId} not found`,
    };
  }

  // 2. Validate eligibility (Amendment #3: EXECUTING is excluded)
  const currentStatus = proposal.status as ProposalStatus;
  if (!ROLLBACK_ELIGIBLE_PROPOSAL_STATUSES.includes(currentStatus)) {
    return {
      proposalId: input.proposalId,
      operationId: proposal.operationId,
      status: "INELIGIBLE",
      reason:
        currentStatus === "EXECUTING"
          ? "Cannot roll back while EXECUTING — mutation is in flight. Wait for completion, then retry."
          : `Proposal is in ${currentStatus} status. Rollback is only allowed from: ${ROLLBACK_ELIGIBLE_PROPOSAL_STATUSES.join(", ")}`,
    };
  }

  // 3. Verify an operation exists
  if (!proposal.operationId) {
    // No operation was ever created — mark as rolled back since there's nothing to compensate
    await (prisma as any).actionProposal.update({
      where: { id: input.proposalId },
      data: {
        status: "ROLLED_BACK",
        rolledBackBy: input.actorId,
        rolledBackAt: new Date(),
        rollbackReason: `${input.reason} (no operation to compensate)`,
        completedAt: new Date(),
      },
    });

    return {
      proposalId: input.proposalId,
      operationId: null,
      status: "ROLLED_BACK",
      reason: "Proposal marked as rolled back (no operation was created)",
    };
  }

  // 4. Delegate to the mutation compensation layer
  let compensationResult;
  try {
    compensationResult = await compensateOperation({
      operationId: proposal.operationId,
      actorId: input.actorId,
      reason: `Rollback of proposal ${input.proposalId}: ${input.reason}`,
    });
  } catch (err) {
    const errorMsg = (err as Error)?.message ?? "Unknown error";

    logger.error("[Rollback] Compensation failed", {
      proposalId: input.proposalId,
      operationId: proposal.operationId,
      error: errorMsg,
    });

    return {
      proposalId: input.proposalId,
      operationId: proposal.operationId,
      status: "ERROR",
      reason: `Compensation failed: ${errorMsg}`,
    };
  }

  const allSucceeded = compensationResult.finalStatus === "ROLLED_BACK";

  // 5. Transition proposal → ROLLED_BACK (full) or ROLLBACK_PARTIAL (incomplete)
  // This is the critical divergence fix: we never claim full rollback unless
  // compensation was 100% successful across DB + all effects.
  const proposalFinalStatus = allSucceeded ? "ROLLED_BACK" : "ROLLBACK_PARTIAL";

  await (prisma as any).actionProposal.update({
    where: { id: input.proposalId },
    data: {
      status: proposalFinalStatus,
      rolledBackBy: input.actorId,
      rolledBackAt: new Date(),
      rollbackReason: input.reason,
      // Only set completedAt on full success — ROLLBACK_PARTIAL is not terminal
      // and compensation can be re-attempted.
      ...(allSucceeded ? { completedAt: new Date() } : {}),
    },
  });

  // 6. Transition opportunity → ROLLED_BACK (if the opportunity is in an eligible state)
  const oppStatus = proposal.decision?.opportunityStatus;
  if (oppStatus === "VERIFIED" || oppStatus === "FAILED") {
    await transitionOpportunity({
      decisionId: proposal.decisionId,
      from: oppStatus,
      to: "ROLLED_BACK",
      actorId: input.actorId,
      reason: `Rollback: ${input.reason}`,
      proposalId: input.proposalId,
      operationId: proposal.operationId,
    });
  }

  logger.info("[Rollback] Proposal rollback completed", {
    proposalId: input.proposalId,
    operationId: proposal.operationId,
    proposalFinalStatus,
    compensationStatus: compensationResult.finalStatus,
    dbRollbackSuccess: compensationResult.dbRollback?.success ?? null,
    effectsCompensated: compensationResult.effectResults.length,
  });

  return {
    proposalId: input.proposalId,
    operationId: proposal.operationId,
    status: allSucceeded ? "ROLLED_BACK" : "ROLLBACK_PARTIAL",
    reason: allSucceeded
      ? "Proposal fully rolled back"
      : "Partial rollback — some effects could not be compensated. " +
        "Proposal is in ROLLBACK_PARTIAL status. Re-attempt compensation to complete rollback.",
    compensationDetails: {
      dbRollbackSuccess: compensationResult.dbRollback?.success ?? null,
      effectsCompensated: compensationResult.effectResults.filter(
        (r) => r.result.success
      ).length,
      effectsFailed: compensationResult.effectResults.filter(
        (r) => !r.result.success
      ).length,
    },
  };
}
