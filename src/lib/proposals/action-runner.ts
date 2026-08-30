// =============================================================================
// ACTION RUNNER — Executes Approved Proposals Through the Mutation Lifecycle
//
// This is the controlled boundary where proposals become real changes.
// The runner NEVER bypasses the mutation lifecycle:
//
//   ActionProposal (APPROVED)
//     → Preconditions
//     → Authorization
//     → Idempotency
//     → createOperation()
//     → executeOperation()
//     → registerEffect()
//     → Capture result
//     → Schedule verification
//
// Agents never directly mutate production resources.
// The ActionRunner is the sole authorized mutator.
// =============================================================================

import { logger } from "@/lib/logger";
import {
  createOperation,
  executeOperation,
  registerEffect,
  type CreateOperationParams,
  type MutableModel,
  type MutationType,
  ExecutionClaimError,
  MutationBlockedError,
  ConcurrentModificationError,
} from "@/lib/mutations";
import {
  type ActionType,
  type ProposedChange,
  ProposalApprovalExpiredError,
  ProposalApprovalHashMismatchError,
  ProposalMaxAttemptsError,
  canRetry,
  type SafetyTier,
} from "./types";
import { validateProposalApproval } from "./safety-policy";
import { transitionOpportunity } from "./opportunity-lifecycle";

// ── Public API ──────────────────────────────────────────────────────────────

export interface RunActionInput {
  proposalId: string;
  workerId?: string;
}

export interface RunActionOutput {
  proposalId: string;
  operationId: string | null;
  status: "EXECUTED" | "FAILED" | "BLOCKED" | "REQUIRES_APPROVAL" | "MAX_ATTEMPTS";
  error?: string;
  newVersion?: number;
}

/**
 * Executes an approved ActionProposal through the full mutation lifecycle.
 *
 * Execution sequence:
 *   1. Load proposal (must be APPROVED)
 *   2. Validate approval (TTL, hash integrity)
 *   3. Check attempt count vs max attempts
 *   4. Increment attemptCount
 *   5. Transition proposal → EXECUTING
 *   6. Transition opportunity → EXECUTING
 *   7. Build MutationOperation params from proposedChanges
 *   8. createOperation() → risk assessment
 *   9. executeOperation() → atomic versioned update
 *  10. Link operationId → proposal
 *  11. registerEffect() → INDEXNOW, GOOGLE_INDEXING
 *  12. Transition proposal → EXECUTED
 *  13. Transition opportunity → VERIFYING
 */
export async function runAction(
  input: RunActionInput
): Promise<RunActionOutput> {
  const workerId =
    input.workerId ?? `worker:${process.pid}:${Date.now()}`;
  const { prisma } = await import("@/lib/prisma");

  // 1. Load proposal
  const proposal = await (prisma as any).actionProposal.findUniqueOrThrow({
    where: { id: input.proposalId },
  });

  // Must be APPROVED
  if (proposal.status !== "APPROVED") {
    if (proposal.status === "READY") {
      return {
        proposalId: input.proposalId,
        operationId: null,
        status: "REQUIRES_APPROVAL",
        error: `Proposal is in READY status — requires human approval`,
      };
    }
    return {
      proposalId: input.proposalId,
      operationId: null,
      status: "FAILED",
      error: `Proposal is in ${proposal.status} status, expected APPROVED`,
    };
  }

  // 2. Validate approval
  const approvalResult = validateProposalApproval({
    approvedBy: proposal.approvedBy,
    approvalExpiresAt: proposal.approvalExpiresAt,
    approvalHash: proposal.approvalHash,
    actionType: proposal.actionType,
    targetUrl: proposal.targetUrl,
    proposedChanges: proposal.proposedChanges as ProposedChange[],
  });

  if (!approvalResult.valid) {
    // Transition to EXPIRED if TTL exceeded
    if (approvalResult.reason?.includes("expired")) {
      await (prisma as any).actionProposal.update({
        where: { id: input.proposalId },
        data: { status: "EXPIRED", completedAt: new Date() },
      });
    }

    return {
      proposalId: input.proposalId,
      operationId: null,
      status: "FAILED",
      error: approvalResult.reason,
    };
  }

  // 3. Check attempt count
  const safetyTier = proposal.safetyTier as SafetyTier;
  if (!canRetry(proposal.attemptCount, safetyTier)) {
    await (prisma as any).actionProposal.update({
      where: { id: input.proposalId },
      data: { status: "FAILED", completedAt: new Date() },
    });

    return {
      proposalId: input.proposalId,
      operationId: null,
      status: "MAX_ATTEMPTS",
      error: `Max attempts (${proposal.maxAttempts}) reached`,
    };
  }

  // 4. Increment attemptCount + transition to EXECUTING
  await (prisma as any).actionProposal.update({
    where: { id: input.proposalId },
    data: {
      status: "EXECUTING",
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date(),
    },
  });

  // 5. Transition opportunity → EXECUTING
  await transitionOpportunity({
    decisionId: proposal.decisionId,
    from: "APPROVED",
    to: "EXECUTING",
    actorId: workerId,
    proposalId: input.proposalId,
  });

  try {
    // 6. Resolve target for mutation
    const targetEntity = await resolveTargetEntity(
      prisma,
      proposal.targetModel,
      proposal.targetId
    );

    if (!targetEntity) {
      throw new Error(
        `Target ${proposal.targetModel}#${proposal.targetId} not found`
      );
    }

    // 7. Build mutation payload from proposed changes
    const proposedChanges = proposal.proposedChanges as ProposedChange[];
    const mutationPayload = proposalToMutationPayload(proposedChanges);
    const affectedFields = proposedChanges.map((c) => c.field);

    // Determine mutation type from action type
    const mutationType = actionTypeToMutationType(
      proposal.actionType as ActionType
    );

    // Count site pages for blast radius
    const sitePageCount = await prisma.blog.count({
      where: { siteId: proposal.siteId },
    });

    // 8. Create MutationOperation
    const operationParams: CreateOperationParams = {
      siteId: proposal.siteId,
      actorId: proposal.approvedBy ?? workerId,
      actorType: proposal.approvedBy?.startsWith("system:") ? "SYSTEM" : "USER",
      mutationType,
      targetModel: proposal.targetModel as MutableModel,
      targetId: proposal.targetId,
      expectedVersion: targetEntity.version ?? 1,
      mutationPayload,
      affectedFields,
      sitePageCount,
      affectedUrlCount: 1,
      idempotencyParams: {
        proposalId: input.proposalId,
      },
    };

    const { operation } = await createOperation(operationParams);

    // 9. Execute the operation
    const execResult = await executeOperation(operation.id, workerId);

    if (!execResult.success) {
      await handleExecutionFailure(
        prisma,
        input.proposalId,
        proposal.decisionId,
        operation.id,
        execResult.error ?? "Unknown execution error"
      );

      return {
        proposalId: input.proposalId,
        operationId: operation.id,
        status: "FAILED",
        error: execResult.error,
      };
    }

    // 10. Link operation to proposal
    await (prisma as any).actionProposal.update({
      where: { id: input.proposalId },
      data: {
        operationId: operation.id,
        status: "EXECUTED",
      },
    });

    // 11. Register side effects (best-effort)
    try {
      await registerEffect({
        operationId: operation.id,
        effectType: "INDEXNOW",
        payload: { siteId: proposal.siteId, targetUrl: proposal.targetUrl },
        confirmationMode: "NONE",
        compensationPolicy: "IRREVERSIBLE",
        idempotencyParams: { targetUrl: proposal.targetUrl },
      });
    } catch {
      // Effects are best-effort
    }

    // 12. Transition opportunity → VERIFYING
    await transitionOpportunity({
      decisionId: proposal.decisionId,
      from: "EXECUTING",
      to: "VERIFYING",
      actorId: workerId,
      proposalId: input.proposalId,
      operationId: operation.id,
    });

    logger.info("[ActionRunner] Proposal executed successfully", {
      proposalId: input.proposalId,
      operationId: operation.id,
      actionType: proposal.actionType,
      newVersion: execResult.newVersion,
    });

    return {
      proposalId: input.proposalId,
      operationId: operation.id,
      status: "EXECUTED",
      newVersion: execResult.newVersion,
    };
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : String(err);

    // Handle specific mutation errors
    if (err instanceof MutationBlockedError) {
      await handleExecutionFailure(
        prisma,
        input.proposalId,
        proposal.decisionId,
        null,
        `Kill switch active: ${errorMessage}`
      );
      return {
        proposalId: input.proposalId,
        operationId: null,
        status: "BLOCKED",
        error: errorMessage,
      };
    }

    if (err instanceof ExecutionClaimError) {
      // Don't fail — another worker is handling it
      return {
        proposalId: input.proposalId,
        operationId: null,
        status: "FAILED",
        error: "Another worker is already executing this operation",
      };
    }

    await handleExecutionFailure(
      prisma,
      input.proposalId,
      proposal.decisionId,
      null,
      errorMessage
    );

    return {
      proposalId: input.proposalId,
      operationId: null,
      status: "FAILED",
      error: errorMessage,
    };
  }
}

// ── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Converts ProposedChange[] into a flat mutation payload for the operation.
 */
function proposalToMutationPayload(
  changes: ProposedChange[]
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const change of changes) {
    payload[change.field] = change.proposedValue;
  }
  return payload;
}

/**
 * Maps ActionType to the existing MutationType enum used by MutationOperation.
 */
function actionTypeToMutationType(actionType: ActionType): MutationType {
  const map: Record<ActionType, MutationType> = {
    UPDATE_META_DESCRIPTION: "BLOG_CONTENT_UPDATE",
    UPDATE_TITLE_TAG: "BLOG_CONTENT_UPDATE",
    FIX_HEADING_HIERARCHY: "BLOG_CONTENT_UPDATE",
    ADD_SCHEMA_MARKUP: "BLOG_CONTENT_UPDATE",
    ADD_CANONICAL_TAG: "BLOG_CONTENT_UPDATE",
    FIX_BROKEN_LINK: "BLOG_CONTENT_UPDATE",
    ADD_INTERNAL_LINKS: "INTERNAL_LINK_CREATE",
    CHANGE_CANONICAL: "BLOG_CONTENT_UPDATE",
    MODIFY_ROBOTS_META: "BLOG_CONTENT_UPDATE",
    REDIRECT_URL: "BLOG_STATUS_UPDATE",
    CHANGE_PAGE_TITLE: "BLOG_CONTENT_UPDATE",
    PUBLISH_CONTENT: "CMS_PUBLISH",
    REFRESH_CONTENT: "BLOG_CONTENT_UPDATE",
    GENERATE_CONTENT_BRIEF: "BLOG_CONTENT_UPDATE",
    DELETE_PAGE: "BLOG_STATUS_UPDATE",
    CONSOLIDATE_CONTENT: "BLOG_CONTENT_UPDATE",
    MASS_REDIRECT: "BLOG_STATUS_UPDATE",
    SITE_WIDE_CHANGE: "BLOG_CONTENT_UPDATE",
  };
  return map[actionType] ?? "BLOG_CONTENT_UPDATE";
}

/**
 * Resolves the target entity from the database.
 */
async function resolveTargetEntity(
  prisma: any,
  targetModel: string,
  targetId: string
): Promise<any> {
  switch (targetModel) {
    case "Blog":
      return prisma.blog.findUnique({ where: { id: targetId } });
    default:
      return null;
  }
}

/**
 * Handles execution failure — transitions proposal and opportunity to FAILED.
 */
async function handleExecutionFailure(
  prisma: any,
  proposalId: string,
  decisionId: string,
  operationId: string | null,
  error: string
): Promise<void> {
  await (prisma as any).actionProposal.update({
    where: { id: proposalId },
    data: {
      status: "FAILED",
      lastAttemptError: error.slice(0, 1000),
      completedAt: new Date(),
      ...(operationId ? { operationId } : {}),
    },
  });

  await transitionOpportunity({
    decisionId,
    from: "EXECUTING",
    to: "FAILED",
    actorId: "system:action-runner",
    reason: error.slice(0, 500),
    proposalId,
    operationId: operationId ?? undefined,
  });

  logger.error("[ActionRunner] Execution failed", {
    proposalId,
    decisionId,
    operationId,
    error,
  });
}
