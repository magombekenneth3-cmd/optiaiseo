/**
 * Central Mutation Operation Manager
 *
 * Entry point for ALL mutations in the system.
 * No mutation can modify application state or dispatch an external side
 * effect without passing through this lifecycle.
 *
 * Lifecycle:
 *   PROPOSED → PENDING_APPROVAL → APPROVED → EXECUTING → COMMITTED
 *     → EFFECTS_PENDING → COMPLETED | COMPLETED_WITH_ERRORS
 *
 * See: implementation_plan.md v2.1 — Phase 2
 */

import { Prisma } from "@prisma/client";
import type { MutationOperation } from "@prisma/client";
import { logger } from "@/lib/logger";

// Types
import {
  type OperationStatus,
  type EffectStatus,
  type MutationType,
  type ActorType,
  type RiskLevel,
  type EffectType,
  type ConfirmationMode,
  type CompensationPolicy,
  VALID_TRANSITIONS,
  TERMINAL_EFFECT_STATUSES,
  ConcurrentModificationError,
  MutationBlockedError,
  ExecutionClaimError,
} from "./types";

// Modules
import { hashCanonicalMutation, validateApproval, generateApprovalData } from "./approval";
import { appendAuditEvent } from "./audit";
import {
  atomicVersionedUpdate,
  claimExecution,
  type MutableModel,
} from "./concurrency";
import { generateOperationKey, generateEffectKey } from "./idempotency";
import { assertAllKillSwitchesClear, assertEffectChannelEnabled } from "./kill-switch";
import { calculateOperationRisk, requiresApproval } from "./risk-engine";
import { captureBeforeSnapshot, recordAfterState } from "./snapshot";
import { notifyMutationFailed } from "@/lib/notifications";

// ── Create Operation ────────────────────────────────────────────────────────

export interface CreateOperationParams {
  siteId: string;
  actorId: string;
  actorType: ActorType;
  mutationType: MutationType;
  targetModel: MutableModel;
  targetId: string;
  expectedVersion: number;
  /** The exact executable mutation (patch object) */
  mutationPayload: Record<string, unknown>;
  /** Fields being modified */
  affectedFields: string[];
  /** Total pages on the site (for blast radius) */
  sitePageCount?: number;
  /** URLs affected by this mutation */
  affectedUrlCount?: number;
  /** Custom idempotency key params (merged with type/targetId) */
  idempotencyParams?: Record<string, string>;
}

export interface CreateOperationResult {
  operation: MutationOperation;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
}

/**
 * Creates a new MutationOperation in PROPOSED state.
 *
 * 1. Generates idempotency key
 * 2. Computes canonical mutation hash
 * 3. Runs kill switch checks
 * 4. Computes risk assessment
 * 5. Creates operation record
 * 6. If LOW risk → auto-advances to APPROVED
 * 7. If MEDIUM+ → stays at PENDING_APPROVAL
 */
export async function createOperation(
  params: CreateOperationParams
): Promise<CreateOperationResult> {
  const { prisma } = await import("@/lib/prisma");

  // Kill switch check — fail fast before any DB writes
  await assertAllKillSwitchesClear(params.siteId);

  // Idempotency key
  const idempotencyKey = generateOperationKey(params.mutationType, {
    targetModel: params.targetModel,
    targetId: params.targetId,
    ...(params.idempotencyParams ?? {}),
  });

  // Check for existing operation with same key
  const existing = await prisma.mutationOperation.findUnique({
    where: { idempotencyKey },
  });

  if (existing) {
    logger.info("[MutationOp] Idempotent hit — returning existing operation", {
      operationId: existing.id,
      idempotencyKey,
    });

    return {
      operation: existing,
      riskLevel: existing.riskLevel as RiskLevel,
      requiresApproval: requiresApproval(existing.riskLevel as RiskLevel),
    };
  }

  // Canonical mutation hash
  const mutationHash = hashCanonicalMutation(
    params.targetModel,
    params.targetId,
    params.expectedVersion,
    params.mutationType,
    params.mutationPayload
  );

  // Diff size
  const diffSizeBytes = Buffer.byteLength(
    JSON.stringify(params.mutationPayload),
    "utf8"
  );

  // Risk assessment
  const risk = calculateOperationRisk({
    mutationType: params.mutationType,
    affectedFields: params.affectedFields,
    diffSizeBytes,
    targetModel: params.targetModel,
    sitePageCount: params.sitePageCount ?? 1,
    affectedUrlCount: params.affectedUrlCount ?? 1,
  });

  const needsApproval = requiresApproval(risk.riskLevel);

  // Create operation
  const operation = await prisma.mutationOperation.create({
    data: {
      siteId: params.siteId,
      idempotencyKey,
      actorId: params.actorId,
      actorType: params.actorType,
      mutationType: params.mutationType,
      targetModel: params.targetModel,
      targetId: params.targetId,
      expectedVersion: params.expectedVersion,
      mutationPayload: params.mutationPayload as Prisma.JsonObject,
      mutationHash,
      riskLevel: risk.riskLevel,
      riskScore: risk.riskScore,
      affectedFields: params.affectedFields,
      diffSizeBytes,
      status: needsApproval ? "PENDING_APPROVAL" : "APPROVED",
      // Auto-approve for LOW risk
      ...(needsApproval
        ? {}
        : {
            approvedBy: "system:auto-approve",
            approvedAt: new Date(),
            approvalExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
            approvalHash: mutationHash,
          }),
    },
  });

  // Audit events
  await appendAuditEvent(operation.id, "CREATED", params.actorId, {
    mutationType: params.mutationType,
    targetModel: params.targetModel,
    targetId: params.targetId,
    idempotencyKey,
  });

  await appendAuditEvent(operation.id, "RISK_ASSESSED", params.actorId, {
    riskLevel: risk.riskLevel,
    riskScore: risk.riskScore,
    reasons: risk.reasons,
  });

  if (needsApproval) {
    await appendAuditEvent(operation.id, "APPROVAL_REQUESTED", params.actorId, {
      riskLevel: risk.riskLevel,
    });
  } else {
    await appendAuditEvent(operation.id, "APPROVED", "system:auto-approve", {
      reason: "LOW risk — auto-approved",
    });
  }

  logger.info("[MutationOp] Created", {
    operationId: operation.id,
    status: operation.status,
    riskLevel: risk.riskLevel,
    riskScore: risk.riskScore,
    needsApproval,
  });

  return {
    operation,
    riskLevel: risk.riskLevel,
    requiresApproval: needsApproval,
  };
}

// ── Approve Operation ───────────────────────────────────────────────────────

/**
 * Approves a PENDING_APPROVAL operation.
 * Sets the approval hash, TTL, and transitions to APPROVED.
 */
export async function approveOperation(
  operationId: string,
  approvedBy: string,
  ttlMinutes: number = 60
): Promise<MutationOperation> {
  const { prisma } = await import("@/lib/prisma");

  const operation = await prisma.mutationOperation.findUniqueOrThrow({
    where: { id: operationId },
  });

  assertValidTransition(operation.status as OperationStatus, "APPROVED");

  const approvalData = generateApprovalData(operation, approvedBy, ttlMinutes);

  const updated = await prisma.mutationOperation.update({
    where: { id: operationId },
    data: approvalData,
  });

  await appendAuditEvent(operationId, "APPROVED", approvedBy, {
    ttlMinutes,
    approvalHash: approvalData.approvalHash,
  });

  logger.info("[MutationOp] Approved", { operationId, approvedBy, ttlMinutes });

  return updated;
}

// ── Reject Operation ────────────────────────────────────────────────────────

/**
 * Rejects a PENDING_APPROVAL operation.
 */
export async function rejectOperation(
  operationId: string,
  rejectedBy: string,
  reason: string
): Promise<MutationOperation> {
  const { prisma } = await import("@/lib/prisma");

  const operation = await prisma.mutationOperation.findUniqueOrThrow({
    where: { id: operationId },
  });

  assertValidTransition(operation.status as OperationStatus, "REJECTED");

  const updated = await prisma.mutationOperation.update({
    where: { id: operationId },
    data: { status: "REJECTED", completedAt: new Date() },
  });

  await appendAuditEvent(operationId, "REJECTED", rejectedBy, { reason });

  logger.info("[MutationOp] Rejected", { operationId, rejectedBy, reason });

  return updated;
}

// ── Execute Operation ───────────────────────────────────────────────────────

export interface ExecuteOperationResult {
  success: boolean;
  newVersion?: number;
  operationId: string;
  status: OperationStatus;
  error?: string;
}

/**
 * Executes an APPROVED operation through the full lifecycle:
 *
 * 0. Atomic execution claim (APPROVED → EXECUTING)
 * 1. Kill switch re-check
 * 2. Approval validation (TTL + hash)
 * 3. Before-snapshot capture
 * 4. Atomic versioned update
 * 5. After-snapshot recording
 * 6. Transition to COMMITTED
 *
 * All steps 1-6 run inside a single Prisma transaction.
 *
 * @param operationId - The operation to execute
 * @param workerId - Unique identifier for this worker/process
 */
export async function executeOperation(
  operationId: string,
  workerId: string = `worker:${process.pid}:${Date.now()}`
): Promise<ExecuteOperationResult> {
  const { prisma } = await import("@/lib/prisma");

  // Step 0: Atomic execution claim (outside transaction — this IS the claim)
  const claimed = await claimExecution(prisma, operationId, workerId);
  if (!claimed) {
    throw new ExecutionClaimError(operationId);
  }

  await appendAuditEvent(operationId, "EXECUTING", workerId, { workerId });

  try {
    // Run the actual mutation inside a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Re-fetch operation with fresh state
      const operation = await (tx as any).mutationOperation.findUniqueOrThrow({
        where: { id: operationId },
      });

      // Step 1: Kill switch re-check
      await assertAllKillSwitchesClear(operation.siteId);

      // Step 2: Approval validation
      validateApproval(operation);

      // Step 3: Fetch current target state for snapshot
      const beforeState = await fetchTargetState(
        tx,
        operation.targetModel as MutableModel,
        operation.targetId
      );

      if (!beforeState) {
        throw new Error(
          `Target ${operation.targetModel}#${operation.targetId} not found`
        );
      }

      // Capture before snapshot
      const snapshotId = await captureBeforeSnapshot(
        tx,
        operation.id,
        operation.targetModel,
        operation.targetId,
        beforeState as Prisma.JsonObject,
        operation.expectedVersion
      );

      // Step 4: Atomic versioned update
      const { newVersion } = await atomicVersionedUpdate(
        tx,
        operation.targetModel as MutableModel,
        operation.targetId,
        operation.expectedVersion,
        operation.mutationPayload as Record<string, unknown>
      );

      // Step 5: Capture after state
      const afterState = await fetchTargetState(
        tx,
        operation.targetModel as MutableModel,
        operation.targetId
      );
      await recordAfterState(tx, snapshotId, afterState as Prisma.JsonObject);

      // Step 6: Transition to COMMITTED
      await (tx as any).mutationOperation.update({
        where: { id: operationId },
        data: { status: "COMMITTED" },
      });

      await appendAuditEvent(operationId, "COMMITTED", workerId, {
        newVersion,
        snapshotId,
      }, tx);

      return { newVersion };
    });

    logger.info("[MutationOp] Execution committed", {
      operationId,
      newVersion: result.newVersion,
    });

    return {
      success: true,
      newVersion: result.newVersion,
      operationId,
      status: "COMMITTED",
    };
  } catch (error) {
    // Handle specific error types
    if (error instanceof ConcurrentModificationError) {
      await transitionToTerminal(prisma, operationId, "STALE", workerId, {
        error: error.message,
        targetModel: error.targetModel,
        targetId: error.targetId,
        expectedVersion: error.expectedVersion,
      });

      return {
        success: false,
        operationId,
        status: "STALE",
        error: error.message,
      };
    }

    if (error instanceof MutationBlockedError) {
      await appendAuditEvent(operationId, "KILL_SWITCH_BLOCKED", workerId, {
        error: error.message,
      });
      // Revert to APPROVED so it can be retried when kill switch clears
      await prisma.mutationOperation.update({
        where: { id: operationId },
        data: {
          status: "APPROVED",
          executionClaimedBy: null,
          executionClaimedAt: null,
          executionLeaseExpiresAt: null,
        },
      });

      return {
        success: false,
        operationId,
        status: "APPROVED",
        error: error.message,
      };
    }

    // Unrecoverable error
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    await transitionToTerminal(prisma, operationId, "FAILED", workerId, {
      error: errorMessage,
    });

    return {
      success: false,
      operationId,
      status: "FAILED",
      error: errorMessage,
    };
  }
}

// ── Effect Registration ─────────────────────────────────────────────────────

export interface RegisterEffectParams {
  operationId: string;
  effectType: EffectType;
  platform?: string;
  payload: Record<string, unknown>;
  confirmationMode?: ConfirmationMode;
  compensationPolicy?: CompensationPolicy;
  maxAttempts?: number;
  /** Custom idempotency params for this effect */
  idempotencyParams?: Record<string, string>;
}

/**
 * Registers a side effect on a COMMITTED operation.
 * Effects start in QUEUED state and are dispatched by a separate processor.
 */
export async function registerEffect(
  params: RegisterEffectParams
): Promise<string> {
  const { prisma } = await import("@/lib/prisma");

  const idempotencyKey = generateEffectKey(params.effectType, {
    operationId: params.operationId,
    ...(params.idempotencyParams ?? {}),
  });

  // Check for existing effect with same key
  const existing = await prisma.mutationEffect.findUnique({
    where: { idempotencyKey },
  });

  if (existing) {
    logger.info("[MutationOp] Effect idempotent hit", {
      effectId: existing.id,
      idempotencyKey,
    });
    return existing.id;
  }

  const effect = await prisma.mutationEffect.create({
    data: {
      operationId: params.operationId,
      idempotencyKey,
      effectType: params.effectType,
      platform: params.platform,
      payload: params.payload as Prisma.JsonObject,
      confirmationMode: params.confirmationMode ?? "POLL",
      compensationPolicy: params.compensationPolicy ?? "IRREVERSIBLE",
      maxAttempts: params.maxAttempts ?? 5,
    },
  });

  // Transition operation to EFFECTS_PENDING if not already
  await prisma.mutationOperation.updateMany({
    where: { id: params.operationId, status: "COMMITTED" },
    data: { status: "EFFECTS_PENDING" },
  });

  await appendAuditEvent(params.operationId, "EFFECT_DISPATCHED", "system:effect-manager", {
    effectId: effect.id,
    effectType: params.effectType,
    platform: params.platform,
  });

  logger.info("[MutationOp] Effect registered", {
    effectId: effect.id,
    operationId: params.operationId,
    effectType: params.effectType,
  });

  return effect.id;
}

// ── Effect Completion ───────────────────────────────────────────────────────

/**
 * Checks if all effects for an operation are in terminal states.
 * If so, transitions the operation to COMPLETED or COMPLETED_WITH_ERRORS.
 */
export async function checkOperationCompletion(
  operationId: string
): Promise<OperationStatus | null> {
  const { prisma } = await import("@/lib/prisma");

  const effects = await prisma.mutationEffect.findMany({
    where: { operationId },
    select: { status: true },
  });

  // No effects → operation is COMPLETED (pure DB mutation, no side effects)
  if (effects.length === 0) {
    await prisma.mutationOperation.update({
      where: { id: operationId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await appendAuditEvent(operationId, "COMPLETED", "system:completion-check", {
      reason: "No effects registered",
    });
    return "COMPLETED";
  }

  // Check if all effects are terminal
  const allTerminal = effects.every((e: { status: string }) =>
    TERMINAL_EFFECT_STATUSES.includes(e.status as EffectStatus)
  );

  if (!allTerminal) {
    return null; // Still waiting
  }

  // Check if any effect failed
  const hasFailures = effects.some((e: { status: string }) => e.status === "FAILED");
  const finalStatus: OperationStatus = hasFailures
    ? "COMPLETED_WITH_ERRORS"
    : "COMPLETED";

  await prisma.mutationOperation.update({
    where: { id: operationId },
    data: { status: finalStatus, completedAt: new Date() },
  });

  const auditEventType = hasFailures ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
  await appendAuditEvent(operationId, auditEventType, "system:completion-check", {
    totalEffects: effects.length,
    failedEffects: effects.filter((e: { status: string }) => e.status === "FAILED").length,
  });

  logger.info("[MutationOp] Operation completed", {
    operationId,
    finalStatus,
    totalEffects: effects.length,
  });

  return finalStatus;
}

// ── Utilities ─────────────────────────────────────────────────────────────

/**
 * Validates a state transition is legal per the state machine.
 */
function assertValidTransition(
  from: OperationStatus,
  to: OperationStatus
): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(
      `Invalid state transition: ${from} → ${to}. Allowed: ${(allowed ?? []).join(", ")}`
    );
  }
}

/**
 * Transitions an operation to a terminal state with audit logging.
 */
async function transitionToTerminal(
  prisma: any,
  operationId: string,
  status: OperationStatus,
  actorId: string,
  details?: Record<string, unknown>
): Promise<void> {
  await prisma.mutationOperation.update({
    where: { id: operationId },
    data: { status, completedAt: new Date() },
  });

  await appendAuditEvent(
    operationId,
    status as any,
    actorId,
    details
  );

  logger.info("[MutationOp] Terminal state", { operationId, status });

  // P1: Fire in-app notification for failure terminal states.
  // Fail-open — notification failure never blocks the transition.
  const NOTIFIABLE_FAILURES: OperationStatus[] = ["FAILED", "STALE", "COMPLETED_WITH_ERRORS"];
  if (NOTIFIABLE_FAILURES.includes(status)) {
    try {
      const op = await prisma.mutationOperation.findUnique({
        where: { id: operationId },
        select: {
          mutationType: true,
          targetModel: true,
          siteId: true,
          site: { select: { userId: true } },
        },
      });
      if (op?.site?.userId) {
        await notifyMutationFailed({
          userId: op.site.userId,
          siteId: op.siteId,
          operationId,
          mutationType: op.mutationType,
          targetModel: op.targetModel,
          error: (details?.error as string) ?? `Operation ended in ${status}`,
        });
      }
    } catch (notifErr) {
      logger.warn("[MutationOp] Failed to send failure notification", {
        operationId,
        error: (notifErr as Error)?.message,
      });
    }
  }
}

/**
 * Fetches the current state of a target entity for snapshotting.
 * Uses the MUTABLE_TARGETS allowlist to determine the correct Prisma model.
 */
async function fetchTargetState(
  tx: Prisma.TransactionClient,
  targetModel: MutableModel,
  targetId: string
): Promise<Record<string, unknown> | null> {
  // Use Prisma typed access — model is from MUTABLE_TARGETS constant
  switch (targetModel) {
    case "Blog":
      return tx.blog.findUnique({ where: { id: targetId } }) as any;
    default:
      throw new Error(
        `[fetchTargetState] Unknown target model: ${targetModel}`
      );
  }
}
