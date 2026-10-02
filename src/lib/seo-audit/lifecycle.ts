import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

export const DIAGNOSTIC_STATUS = {
  PASS: "PASS",
  FAIL: "FAIL",
  WARNING: "WARNING",
  UNKNOWN: "UNKNOWN",
  NOT_APPLICABLE: "NOT_APPLICABLE",
} as const;
export type DiagnosticStatus = (typeof DIAGNOSTIC_STATUS)[keyof typeof DIAGNOSTIC_STATUS];

export const LIFECYCLE_STATE = {
  OPEN: "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  RESOLVED: "RESOLVED",
  REGRESSED: "REGRESSED",
  UNKNOWN: "UNKNOWN",
} as const;
export type LifecycleState = (typeof LIFECYCLE_STATE)[keyof typeof LIFECYCLE_STATE];

export const DEPLOYMENT_STATE = {
  PROPOSED: "PROPOSED",
  PR_OPENED: "PR_OPENED",
  MERGED: "MERGED",
  MERGED_AWAITING_DEPLOYMENT: "MERGED_AWAITING_DEPLOYMENT",
  DEPLOYMENT_CONFIRMED: "DEPLOYMENT_CONFIRMED",
  DEPLOYMENT_FAILED: "DEPLOYMENT_FAILED",
} as const;
export type DeploymentState = (typeof DEPLOYMENT_STATE)[keyof typeof DEPLOYMENT_STATE];

export const VERIFICATION_OUTCOME = {
  PENDING: "PENDING",
  TECHNICALLY_VERIFIED: "TECHNICALLY_VERIFIED",
  PARTIALLY_VERIFIED: "PARTIALLY_VERIFIED",
  SEARCH_VERIFIED: "SEARCH_VERIFIED",
  OUTCOME_MEASURED: "OUTCOME_MEASURED",
  INEFFECTIVE: "INEFFECTIVE",
  REGRESSED: "REGRESSED",
  UNKNOWN: "UNKNOWN",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  NO_MEASURABLE_CHANGE: "NO_MEASURABLE_CHANGE",
} as const;
export type VerificationOutcome = (typeof VERIFICATION_OUTCOME)[keyof typeof VERIFICATION_OUTCOME];

const VALID_LIFECYCLE_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  OPEN: ["IN_PROGRESS", "RESOLVED", "UNKNOWN"],
  IN_PROGRESS: ["RESOLVED", "REGRESSED", "OPEN", "UNKNOWN"],
  RESOLVED: ["REGRESSED", "OPEN"],
  REGRESSED: ["IN_PROGRESS", "OPEN", "RESOLVED"],
  UNKNOWN: ["OPEN", "IN_PROGRESS", "RESOLVED"],
};

const VALID_VERIFICATION_TRANSITIONS: Record<VerificationOutcome, VerificationOutcome[]> = {
  PENDING: [
    "TECHNICALLY_VERIFIED", "PARTIALLY_VERIFIED",
    "INEFFECTIVE", "REGRESSED", "UNKNOWN", "INSUFFICIENT_DATA",
  ],
  TECHNICALLY_VERIFIED: [
    "SEARCH_VERIFIED", "OUTCOME_MEASURED",
    "INEFFECTIVE", "REGRESSED", "UNKNOWN", "INSUFFICIENT_DATA", "NO_MEASURABLE_CHANGE",
  ],
  PARTIALLY_VERIFIED: [
    "TECHNICALLY_VERIFIED", "SEARCH_VERIFIED",
    "INEFFECTIVE", "REGRESSED", "UNKNOWN", "INSUFFICIENT_DATA", "NO_MEASURABLE_CHANGE",
  ],
  SEARCH_VERIFIED: ["OUTCOME_MEASURED", "REGRESSED", "UNKNOWN"],
  OUTCOME_MEASURED: ["REGRESSED"],
  INEFFECTIVE: ["PENDING", "TECHNICALLY_VERIFIED", "UNKNOWN"],
  REGRESSED: ["PENDING", "TECHNICALLY_VERIFIED", "UNKNOWN"],
  UNKNOWN: [
    "PENDING", "TECHNICALLY_VERIFIED", "PARTIALLY_VERIFIED",
    "SEARCH_VERIFIED", "INEFFECTIVE", "REGRESSED", "INSUFFICIENT_DATA",
  ],
  INSUFFICIENT_DATA: [
    "PENDING", "TECHNICALLY_VERIFIED", "SEARCH_VERIFIED",
    "INEFFECTIVE", "REGRESSED", "UNKNOWN",
  ],
  NO_MEASURABLE_CHANGE: ["OUTCOME_MEASURED", "REGRESSED", "UNKNOWN"],
};

export function isValidLifecycleTransition(from: LifecycleState, to: LifecycleState): boolean {
  if (from === to) return false;
  return VALID_LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isValidVerificationTransition(from: VerificationOutcome, to: VerificationOutcome): boolean {
  if (from === to) return false;
  return VALID_VERIFICATION_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface TransitionResult {
  success: boolean;
  previousState: string;
  newState: string;
  error?: string;
}

export async function transitionLifecycleState(
  findingDbId: string,
  newState: LifecycleState,
): Promise<TransitionResult> {
  const finding = await prisma.diagnosticFindingRecord.findUnique({
    where: { id: findingDbId },
    select: { id: true, lifecycleState: true, updatedAt: true },
  });

  if (!finding) {
    return { success: false, previousState: "UNKNOWN", newState, error: "finding_not_found" };
  }

  const currentState = finding.lifecycleState as LifecycleState;

  if (!isValidLifecycleTransition(currentState, newState)) {
    logger.warn("[Lifecycle] Invalid transition rejected", {
      findingDbId,
      from: currentState,
      to: newState,
    });
    return { success: false, previousState: currentState, newState, error: `invalid_transition:${currentState}->${newState}` };
  }

  const extraData: Record<string, unknown> = {};
  if (newState === "RESOLVED") {
    extraData.resolvedAt = new Date();
  }
  if (newState === "REGRESSED" || newState === "OPEN") {
    extraData.resolvedAt = null;
  }

  try {
    await prisma.diagnosticFindingRecord.update({
      where: {
        id: findingDbId,
        updatedAt: finding.updatedAt,
      },
      data: {
        lifecycleState: newState,
        ...extraData,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      logger.warn("[Lifecycle] Concurrent modification — transition lost", {
        findingDbId,
        from: currentState,
        to: newState,
      });
      return { success: false, previousState: currentState, newState, error: "concurrent_modification" };
    }
    throw err;
  }

  logger.info("[Lifecycle] State transition", {
    findingDbId,
    from: currentState,
    to: newState,
  });

  return { success: true, previousState: currentState, newState };
}

export function computeVerificationIdempotencyKey(
  findingDbId: string,
  verificationWindow: string,
  deploymentRevision: string | null,
): string {
  const input = [findingDbId, verificationWindow, deploymentRevision ?? "none"].join("|");
  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}

export function computeDeploymentIdempotencyKey(
  siteId: string,
  findingDbId: string,
  deploymentRevision: string,
): string {
  const input = [siteId, findingDbId, deploymentRevision].join("|");
  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}
