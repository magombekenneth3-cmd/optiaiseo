/**
 * Execution Trace — Append-controlled audit record from discovery to outcome.
 *
 * INVARIANT: Every autonomous mutation has a durable trace linking the
 * originating opportunity, proposal, deterministic risk/tier decision,
 * authorization decision, execution attempt, failure classification,
 * and verification outcome.
 *
 * The trace is a single row with controlled state transitions:
 *   create → recordAuthorization → recordExecution → recordVerification
 * Each phase only writes to its own fields. Earlier fields are not overwritten.
 * This is NOT literally immutable event sourcing — it is a single mutable row
 * with append-controlled transitions for auditability.
 */

import { logger } from "@/lib/logger";
import type { SafetyTier } from "@/lib/proposals/types";
import type { RiskLevel } from "@/lib/mutations/types";

// ── Types ───────────────────────────────────────────────────────────────────

export type VerificationStatus =
  | "PENDING"
  | "INSUFFICIENT_DATA"
  | "IMPROVED"
  | "UNCHANGED"
  | "DEGRADED"
  | "INCONCLUSIVE";

export type PolicyDecisionType = "AUTO_EXECUTE" | "NEEDS_APPROVAL" | "BLOCKED";

export interface TraceInit {
  siteId: string;
  parentTraceId?: string;
  triggerType: "CRON" | "EVENT" | "MANUAL";
  triggerId?: string;
  findingId?: string;
  findingType?: string;
  opportunityId: string;
  opportunityScore: number;
  actionType: string;
  safetyTier: SafetyTier;
  operatingMode: string;
  effectiveTierLimit: number;
  actorType: "SYSTEM" | "USER" | "APPROVAL";
  actorId?: string;
  discoveredAt: Date;
}

export interface AuthorizationRecord {
  policyDecision: PolicyDecisionType;
  policyReason: string;
  budgetReservationId?: string;
  circuitBreakerState?: string;
  riskLevel?: RiskLevel;
  riskScore?: number;
}

export interface ExecutionRecord {
  operationId: string;
  proposalId?: string;
  attemptNumber: number;
  executionResult: "SUCCESS" | "FAILED" | "ROLLED_BACK";
  failureClass?: string;
  retryCount: number;
}

export interface VerificationRecord {
  verificationStatus: VerificationStatus;
  metricsBaseline?: Record<string, number>;
  metricsAfter?: Record<string, number>;
}

// ── Trace Operations ────────────────────────────────────────────────────────

/**
 * Creates a new execution trace. Returns the traceId.
 */
export async function createTrace(params: TraceInit): Promise<string> {
  const { prisma } = await import("@/lib/prisma");

  const trace = await (prisma as any).executionTrace.create({
    data: {
      siteId: params.siteId,
      parentTraceId: params.parentTraceId,
      triggerType: params.triggerType,
      triggerId: params.triggerId,
      findingId: params.findingId,
      findingType: params.findingType,
      opportunityId: params.opportunityId,
      opportunityScore: params.opportunityScore,
      actionType: params.actionType,
      safetyTier: params.safetyTier,
      operatingMode: params.operatingMode,
      effectiveTierLimit: params.effectiveTierLimit,
      // Initialize with BLOCKED — will be updated by recordAuthorization
      policyDecision: "BLOCKED",
      policyReason: "Trace created — authorization pending",
      actorType: params.actorType,
      actorId: params.actorId,
      discoveredAt: params.discoveredAt,
    },
  });

  logger.info("[ExecutionTrace] Created", {
    traceId: trace.id,
    opportunityId: params.opportunityId,
    actionType: params.actionType,
  });

  return trace.id;
}

/**
 * Records the authorization decision on the trace.
 * This is the last mutable write to the authorization fields.
 */
export async function recordAuthorization(
  traceId: string,
  auth: AuthorizationRecord
): Promise<void> {
  const { prisma } = await import("@/lib/prisma");

  await (prisma as any).executionTrace.update({
    where: { id: traceId },
    data: {
      policyDecision: auth.policyDecision,
      policyReason: auth.policyReason,
      budgetReservationId: auth.budgetReservationId,
      circuitBreakerState: auth.circuitBreakerState,
      riskLevel: auth.riskLevel,
      riskScore: auth.riskScore,
      authorizedAt: auth.policyDecision === "AUTO_EXECUTE" ? new Date() : null,
    },
  });

  logger.info("[ExecutionTrace] Authorization recorded", {
    traceId,
    decision: auth.policyDecision,
  });
}

/**
 * Records the execution result on the trace.
 */
export async function recordExecution(
  traceId: string,
  exec: ExecutionRecord
): Promise<void> {
  const { prisma } = await import("@/lib/prisma");

  await (prisma as any).executionTrace.update({
    where: { id: traceId },
    data: {
      operationId: exec.operationId,
      proposalId: exec.proposalId,
      attemptNumber: exec.attemptNumber,
      executionResult: exec.executionResult,
      failureClass: exec.failureClass,
      retryCount: exec.retryCount,
      executedAt: new Date(),
      completedAt: new Date(),
    },
  });

  logger.info("[ExecutionTrace] Execution recorded", {
    traceId,
    operationId: exec.operationId,
    result: exec.executionResult,
  });
}

/**
 * Records the verification outcome on the trace (append-only).
 * Called by the autonomous verifier after the verification window.
 */
export async function recordVerification(
  traceId: string,
  verification: VerificationRecord
): Promise<void> {
  const { prisma } = await import("@/lib/prisma");

  await (prisma as any).executionTrace.update({
    where: { id: traceId },
    data: {
      verificationStatus: verification.verificationStatus,
      verificationAt: new Date(),
      metricsBaseline: verification.metricsBaseline ?? undefined,
      metricsAfter: verification.metricsAfter ?? undefined,
    },
  });

  logger.info("[ExecutionTrace] Verification recorded", {
    traceId,
    status: verification.verificationStatus,
  });
}
