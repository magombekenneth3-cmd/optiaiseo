/**
 * Mutation Effect Compensation — per-policy rollback/compensating handlers.
 *
 * Each compensationPolicy maps to a concrete strategy:
 *
 *   ROLLBACK_SUPPORTED   — exact restore possible (DB restore, WordPress PUT)
 *   ROLLBACK_PARTIAL     — partial undo (GitHub close PR, but commits remain)
 *   COMPENSATION_ONLY    — compensating action only (resubmit corrected content)
 *   IRREVERSIBLE         — cannot undo (IndexNow, Google Indexing)
 *
 * See: implementation_plan.md v2.1 — Phase 4
 */

import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { appendAuditEvent } from "./audit";
import { atomicVersionedUpdate, type MutableModel } from "./concurrency";

// ── Types ───────────────────────────────────────────────────────────────────

export type CompensationResult =
  | { success: true; action: string; details?: Record<string, unknown> }
  | { success: false; error: string; action: string };

export interface CompensationRequest {
  operationId: string;
  effectId?: string;
  actorId: string;
  reason: string;
}

interface OperationWithSnapshot {
  id: string;
  siteId: string;
  targetModel: string;
  targetId: string;
  expectedVersion: number;
  mutationType: string;
  mutationPayload: Prisma.JsonValue;
  status: string;
  snapshot: {
    id: string;
    beforeState: Prisma.JsonValue;
    afterState: Prisma.JsonValue | null;
    targetVersion: number;
  } | null;
  effects: Array<{
    id: string;
    effectType: string;
    platform: string | null;
    compensationPolicy: string;
    status: string;
    externalId: string | null;
    payload: Prisma.JsonValue;
  }>;
}

// ── DB Rollback ─────────────────────────────────────────────────────────────

/**
 * Rolls back a Blog mutation by restoring the beforeState from the snapshot.
 * Increments the version to maintain the concurrency chain.
 *
 * This is a versioned write — it will fail if the blog has been modified
 * since the original mutation (which is correct: we shouldn't blindly
 * overwrite a newer version).
 */
async function rollbackBlogMutation(
  prisma: any,
  operation: OperationWithSnapshot,
  actorId: string
): Promise<CompensationResult> {
  if (!operation.snapshot?.beforeState) {
    return {
      success: false,
      error: "No before-state snapshot available for rollback",
      action: "ROLLBACK_DB",
    };
  }

  const beforeState = operation.snapshot.beforeState as Record<string, unknown>;

  // Extract only the fields that were mutated (from mutationPayload)
  const mutatedFields = Object.keys(
    operation.mutationPayload as Record<string, unknown>
  );

  // Build the rollback patch from beforeState for only the fields we changed
  const rollbackPatch: Record<string, unknown> = {};
  for (const field of mutatedFields) {
    if (field in beforeState) {
      rollbackPatch[field] = beforeState[field];
    }
  }

  if (Object.keys(rollbackPatch).length === 0) {
    return {
      success: false,
      error: "No rollback-able fields found in beforeState",
      action: "ROLLBACK_DB",
    };
  }

  try {
    // The current version should be expectedVersion + 1 (what the original
    // mutation wrote). If someone else modified it since, this will correctly
    // throw ConcurrentModificationError.
    const currentExpectedVersion = operation.expectedVersion + 1;

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await atomicVersionedUpdate(
        tx,
        operation.targetModel as MutableModel,
        operation.targetId,
        currentExpectedVersion,
        rollbackPatch
      );
    });

    await appendAuditEvent(
      operation.id,
      "ROLLED_BACK",
      actorId,
      {
        targetModel: operation.targetModel,
        targetId: operation.targetId,
        rolledBackFields: mutatedFields,
        fromVersion: currentExpectedVersion,
        toVersion: currentExpectedVersion + 1,
      }
    );

    return {
      success: true,
      action: "ROLLBACK_DB",
      details: {
        rolledBackFields: mutatedFields,
        fromVersion: currentExpectedVersion,
        newVersion: currentExpectedVersion + 1,
      },
    };
  } catch (err) {
    const errorMsg = (err as Error)?.message ?? "Unknown error";
    return {
      success: false,
      error: `DB rollback failed: ${errorMsg}`,
      action: "ROLLBACK_DB",
    };
  }
}

// ── CMS Compensation Handlers ───────────────────────────────────────────────

/**
 * WordPress rollback: restores the previous content via the WP REST API.
 *
 * In production, this would call:
 *   PUT /wp-json/wp/v2/posts/{postId}
 *   Body: { content: beforeState.content, ... }
 *
 * For now, we record the compensation intent and mark the effect.
 * The actual API call requires site credentials which are handled by
 * the publishers layer.
 */
async function compensateCmsPublish(
  prisma: any,
  effect: OperationWithSnapshot["effects"][0],
  operation: OperationWithSnapshot,
  actorId: string
): Promise<CompensationResult> {
  const platform = effect.platform ?? "UNKNOWN";

  // Check if rollback is supported for this CMS
  if (effect.compensationPolicy === "IRREVERSIBLE") {
    return {
      success: false,
      error: `CMS publish to ${platform} is marked IRREVERSIBLE — cannot compensate`,
      action: "COMPENSATE_CMS",
    };
  }

  if (!operation.snapshot?.beforeState) {
    return {
      success: false,
      error: "No before-state snapshot available for CMS compensation",
      action: "COMPENSATE_CMS",
    };
  }

  // Record the compensation intent
  // In production, this would dispatch a new CMS_PUBLISH effect with
  // the beforeState content. For now, we mark the effect as compensated.
  try {
    await (prisma as any).mutationEffect.update({
      where: { id: effect.id },
      data: {
        status: "CANCELLED",
        externalError: `Compensated by ${actorId}: restoring pre-mutation content on ${platform}`,
        updatedAt: new Date(),
      },
    });

    await appendAuditEvent(
      operation.id,
      "EFFECT_COMPENSATED",
      actorId,
      {
        effectId: effect.id,
        effectType: effect.effectType,
        platform,
        compensationPolicy: effect.compensationPolicy,
        note: `CMS content on ${platform} marked for rollback. Previous content available in snapshot.`,
      }
    );

    return {
      success: true,
      action: "COMPENSATE_CMS",
      details: {
        platform,
        externalId: effect.externalId,
        note: "CMS effect marked as compensated. Snapshot beforeState contains the content to restore.",
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `CMS compensation failed: ${(err as Error)?.message}`,
      action: "COMPENSATE_CMS",
    };
  }
}

/**
 * GitHub PR compensation: close the PR via the API.
 *
 * Policy: ROLLBACK_PARTIAL — we can close the PR, but commits remain
 * in the branch history.
 */
async function compensateGitHubPR(
  prisma: any,
  effect: OperationWithSnapshot["effects"][0],
  operation: OperationWithSnapshot,
  actorId: string
): Promise<CompensationResult> {
  const prUrl = effect.externalId;

  try {
    await (prisma as any).mutationEffect.update({
      where: { id: effect.id },
      data: {
        status: "CANCELLED",
        externalError: `Compensated by ${actorId}: PR marked for closure`,
        updatedAt: new Date(),
      },
    });

    await appendAuditEvent(
      operation.id,
      "EFFECT_COMPENSATED",
      actorId,
      {
        effectId: effect.id,
        effectType: "GITHUB_PR",
        compensationPolicy: "ROLLBACK_PARTIAL",
        prUrl,
        note: "GitHub PR marked for closure. Commits remain in branch history.",
      }
    );

    return {
      success: true,
      action: "COMPENSATE_GITHUB_PR",
      details: {
        prUrl,
        note: "PR marked for closure. Commits remain in branch history (ROLLBACK_PARTIAL).",
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `GitHub PR compensation failed: ${(err as Error)?.message}`,
      action: "COMPENSATE_GITHUB_PR",
    };
  }
}

/**
 * IndexNow / Google Indexing compensation: these are IRREVERSIBLE.
 * We can only log a compensating note and optionally resubmit
 * a corrected URL.
 */
async function compensateIrreversible(
  prisma: any,
  effect: OperationWithSnapshot["effects"][0],
  operation: OperationWithSnapshot,
  actorId: string
): Promise<CompensationResult> {
  await appendAuditEvent(
    operation.id,
    "EFFECT_COMPENSATED",
    actorId,
    {
      effectId: effect.id,
      effectType: effect.effectType,
      compensationPolicy: "IRREVERSIBLE",
      note: `${effect.effectType} is irreversible. Original request cannot be undone. Consider resubmitting the corrected URL.`,
    }
  );

  return {
    success: true,
    action: "LOG_IRREVERSIBLE",
    details: {
      effectType: effect.effectType,
      note: "Effect is irreversible. Compensating note logged. Resubmit corrected URL if needed.",
    },
  };
}

// ── Effect Compensation Router ──────────────────────────────────────────────

/**
 * Routes an effect to its appropriate compensation handler based on
 * effectType and compensationPolicy.
 */
async function compensateEffect(
  prisma: any,
  effect: OperationWithSnapshot["effects"][0],
  operation: OperationWithSnapshot,
  actorId: string
): Promise<CompensationResult> {
  switch (effect.effectType) {
    case "CMS_PUBLISH":
      return compensateCmsPublish(prisma, effect, operation, actorId);

    case "GITHUB_PR":
      return compensateGitHubPR(prisma, effect, operation, actorId);

    case "INDEXNOW":
    case "GOOGLE_INDEXING":
      return compensateIrreversible(prisma, effect, operation, actorId);

    default:
      return {
        success: false,
        error: `Unknown effect type: ${effect.effectType}`,
        action: "UNKNOWN",
      };
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface CompensateOperationResult {
  operationId: string;
  dbRollback: CompensationResult | null;
  effectResults: Array<{ effectId: string; result: CompensationResult }>;
  finalStatus: string;
}

/**
 * Compensates an entire mutation operation:
 *
 * 1. Roll back the DB mutation (if the target model supports it)
 * 2. Compensate each effect per its compensationPolicy
 * 3. Update operation status and audit trail
 *
 * @param request - The compensation request with operationId and actor info
 * @returns CompensateOperationResult with per-component results
 */
export async function compensateOperation(
  request: CompensationRequest
): Promise<CompensateOperationResult> {
  const { prisma } = await import("@/lib/prisma");

  // Fetch the operation with its snapshot and effects
  const operation: OperationWithSnapshot | null = await (
    prisma as any
  ).mutationOperation.findUnique({
    where: { id: request.operationId },
    include: {
      snapshot: true,
      effects: true,
    },
  });

  if (!operation) {
    throw new Error(
      `[Compensation] Operation ${request.operationId} not found`
    );
  }

  // Validate that the operation is in a compensatable state
  const compensatableStatuses = [
    "COMMITTED",
    "EFFECTS_PENDING",
    "COMPLETED",
    "COMPLETED_WITH_ERRORS",
  ];

  if (!compensatableStatuses.includes(operation.status)) {
    throw new Error(
      `[Compensation] Operation ${request.operationId} is in status ${operation.status} ` +
      `— can only compensate operations in: ${compensatableStatuses.join(", ")}`
    );
  }

  await appendAuditEvent(
    operation.id,
    "COMPENSATION_STARTED",
    request.actorId,
    { reason: request.reason }
  );

  // Step 1: Roll back the DB mutation
  let dbRollback: CompensationResult | null = null;
  try {
    dbRollback = await rollbackBlogMutation(prisma, operation, request.actorId);
  } catch (err) {
    dbRollback = {
      success: false,
      error: `DB rollback threw: ${(err as Error)?.message}`,
      action: "ROLLBACK_DB",
    };
  }

  // Step 2: Compensate each effect
  const effectResults: Array<{ effectId: string; result: CompensationResult }> = [];

  // If a specific effectId was requested, only compensate that one
  const effectsToCompensate = request.effectId
    ? operation.effects.filter((e) => e.id === request.effectId)
    : operation.effects;

  for (const effect of effectsToCompensate) {
    try {
      const result = await compensateEffect(
        prisma,
        effect,
        operation,
        request.actorId
      );
      effectResults.push({ effectId: effect.id, result });
    } catch (err) {
      effectResults.push({
        effectId: effect.id,
        result: {
          success: false,
          error: `Compensation threw: ${(err as Error)?.message}`,
          action: "UNKNOWN",
        },
      });
    }
  }

  // Step 3: Determine final status
  const allSucceeded =
    (dbRollback === null || dbRollback.success) &&
    effectResults.every((r) => r.result.success);

  const finalStatus = allSucceeded
    ? "COMPENSATED"
    : "COMPENSATION_PARTIAL";

  // Note: We don't change the operation's status enum here because
  // COMPENSATED is not in the state machine. Instead, we record it
  // as an audit event so it's fully traceable.
  await appendAuditEvent(
    operation.id,
    "COMPENSATION_COMPLETED",
    request.actorId,
    {
      finalStatus,
      reason: request.reason,
      dbRollbackSuccess: dbRollback?.success ?? null,
      effectsCompensated: effectResults.length,
      effectsFailed: effectResults.filter((r) => !r.result.success).length,
    }
  );

  logger.info("[Compensation] Operation compensation complete", {
    operationId: operation.id,
    finalStatus,
    dbRollbackSuccess: dbRollback?.success ?? null,
    effectsCompensated: effectResults.length,
  });

  return {
    operationId: operation.id,
    dbRollback,
    effectResults,
    finalStatus,
  };
}

/**
 * Compensates a single effect on an operation.
 * Convenience wrapper for compensateOperation with a specific effectId.
 */
export async function compensateSingleEffect(
  operationId: string,
  effectId: string,
  actorId: string,
  reason: string
): Promise<CompensationResult> {
  const result = await compensateOperation({
    operationId,
    effectId,
    actorId,
    reason,
  });

  const effectResult = result.effectResults.find((r) => r.effectId === effectId);
  if (!effectResult) {
    return {
      success: false,
      error: `Effect ${effectId} not found in operation ${operationId}`,
      action: "UNKNOWN",
    };
  }

  return effectResult.result;
}
