// =============================================================================
// RETRY CHAIN — Creates New Proposals From Failed Predecessors
//
// Enforces an opportunity-level retry ceiling:
//   GrowthDecision.proposalRetryCount tracks how many retry proposals exist.
//   GrowthDecision.maxProposalRetries caps the total.
//
// Retry proposals are NEW proposals — the failed proposal remains FAILED.
// The new proposal inherits the action type, target, and proposed changes
// from the failed predecessor but gets a fresh attemptCount.
//
// The retry chain is linked via ActionProposal.previousProposalId:
//   A (FAILED) ← B (previousProposalId = A.id, FAILED) ← C (previousProposalId = B.id)
// =============================================================================

import { logger } from "@/lib/logger";
import {
  type ActionType,
  type ProposedChange,
  type SafetyTier,
  RetryChainExhaustedError,
} from "./types";
import {
  evaluatePolicy,
  hashProposedChanges,
  generateProposalIdempotencyKey,
} from "./safety-policy";
import { transitionOpportunity } from "./opportunity-lifecycle";

// ── Public API ──────────────────────────────────────────────────────────────

export interface RetryProposalInput {
  /** The FAILED proposal to retry */
  failedProposalId: string;
  /** Actor initiating the retry (user ID or "system:*") */
  actorId: string;
}

export interface RetryProposalResult {
  /** The new retry proposal ID (null if retry was rejected) */
  newProposalId: string | null;
  /** Whether the retry was created */
  status: "CREATED" | "CEILING_REACHED" | "INVALID_STATUS" | "ERROR";
  /** Human-readable reason */
  reason: string;
  /** The retry number (1-indexed) across the opportunity */
  retryNumber: number;
}

/**
 * Creates a new ActionProposal as a retry of a failed predecessor.
 *
 * Flow:
 *   1. Load the failed proposal
 *   2. Validate it is in FAILED status
 *   3. Check the opportunity-level retry ceiling
 *   4. Create a new proposal linked via previousProposalId
 *   5. Atomically increment GrowthDecision.proposalRetryCount
 *   6. Transition opportunity FAILED → OPEN → PROPOSED
 *
 * The new proposal gets a fresh attemptCount but the opportunity's
 * proposalRetryCount is the hard ceiling.
 */
export async function retryProposal(
  input: RetryProposalInput
): Promise<RetryProposalResult> {
  const { prisma } = await import("@/lib/prisma");

  // 1. Load the failed proposal with its opportunity
  const failedProposal = await (prisma as any).actionProposal.findUnique({
    where: { id: input.failedProposalId },
    include: {
      decision: {
        select: {
          id: true,
          siteId: true,
          url: true,
          opportunityStatus: true,
          maxProposalRetries: true,
          proposalRetryCount: true,
        },
      },
    },
  });

  if (!failedProposal) {
    return {
      newProposalId: null,
      status: "ERROR",
      reason: `Proposal ${input.failedProposalId} not found`,
      retryNumber: 0,
    };
  }

  // 2. Validate status
  if (failedProposal.status !== "FAILED") {
    return {
      newProposalId: null,
      status: "INVALID_STATUS",
      reason: `Proposal is in ${failedProposal.status} status, expected FAILED`,
      retryNumber: failedProposal.decision.proposalRetryCount,
    };
  }

  const decision = failedProposal.decision;

  // 3. Check opportunity-level retry ceiling
  if (decision.proposalRetryCount >= decision.maxProposalRetries) {
    logger.warn("[RetryChain] Retry ceiling reached", {
      decisionId: decision.id,
      proposalRetryCount: decision.proposalRetryCount,
      maxProposalRetries: decision.maxProposalRetries,
    });

    throw new RetryChainExhaustedError(
      decision.id,
      decision.maxProposalRetries
    );
  }

  const actionType = failedProposal.actionType as ActionType;
  const proposedChanges = failedProposal.proposedChanges as ProposedChange[];

  // 4. Evaluate safety policy for the retry
  const policy = evaluatePolicy(actionType);
  const approvalHash = hashProposedChanges(actionType, decision.url, proposedChanges);
  const now = new Date();

  // Generate a new idempotency key that includes the retry number
  // This allows a new proposal for the same opportunity+action after failure
  const retryNumber = decision.proposalRetryCount + 1;
  const idempotencyKey = generateProposalIdempotencyKey(
    decision.siteId,
    decision.id,
    actionType,
    decision.url
  ) + `:retry-${retryNumber}`;

  // 5. Create the new retry proposal
  const newProposal = await (prisma as any).actionProposal.create({
    data: {
      siteId: decision.siteId,
      decisionId: decision.id,
      idempotencyKey,
      previousProposalId: input.failedProposalId,
      actionType,
      targetUrl: failedProposal.targetUrl,
      verificationUrl: failedProposal.verificationUrl, // Preserve the persisted verification URL
      targetModel: failedProposal.targetModel,
      targetId: failedProposal.targetId,
      status: policy.autoApprove ? "APPROVED" : "READY",
      proposedChanges,
      expectedOutcome: failedProposal.expectedOutcome,
      riskLevel: failedProposal.riskLevel,
      safetyTier: failedProposal.safetyTier,
      confidence: failedProposal.confidence,
      requiresApproval: !policy.autoApprove,
      verificationCriteria: failedProposal.verificationCriteria,
      attemptCount: 0,
      maxAttempts: policy.maxAttempts,
      generatedBy: input.actorId,
      // Auto-approve for Tier 1
      ...(policy.autoApprove
        ? {
            approvedBy: "system:auto-policy",
            approvedAt: now,
            approvalExpiresAt: new Date(
              now.getTime() + policy.approvalTtlMinutes * 60 * 1000
            ),
            approvalHash,
          }
        : {}),
    },
  });

  // 6. Atomically increment the retry count on the opportunity
  await (prisma as any).growthDecision.update({
    where: { id: decision.id },
    data: {
      proposalRetryCount: { increment: 1 },
    },
  });

  // 7. Transition opportunity: FAILED → OPEN
  const transitionedToOpen = await transitionOpportunity({
    decisionId: decision.id,
    from: "FAILED",
    to: "OPEN",
    actorId: input.actorId,
    reason: `Retry ${retryNumber} of ${decision.maxProposalRetries} — new proposal created`,
    proposalId: newProposal.id,
  });

  // Then OPEN → PROPOSED
  if (transitionedToOpen) {
    await transitionOpportunity({
      decisionId: decision.id,
      from: "OPEN",
      to: "PROPOSED",
      actorId: input.actorId,
      reason: `Retry proposal ${newProposal.id} generated`,
      proposalId: newProposal.id,
    });

    // If auto-approved, also transition to APPROVED
    if (policy.autoApprove) {
      await transitionOpportunity({
        decisionId: decision.id,
        from: "PROPOSED",
        to: "APPROVED",
        actorId: "system:auto-policy",
        reason: `Tier ${policy.tier} retry auto-approved`,
        proposalId: newProposal.id,
      });
    }
  }

  logger.info("[RetryChain] Retry proposal created", {
    failedProposalId: input.failedProposalId,
    newProposalId: newProposal.id,
    decisionId: decision.id,
    retryNumber,
    maxRetries: decision.maxProposalRetries,
    autoApproved: policy.autoApprove,
  });

  return {
    newProposalId: newProposal.id,
    status: "CREATED",
    reason: `Retry ${retryNumber}/${decision.maxProposalRetries} — ${
      policy.autoApprove
        ? `Tier ${policy.tier} auto-approved`
        : `Tier ${policy.tier} requires human approval`
    }`,
    retryNumber,
  };
}
