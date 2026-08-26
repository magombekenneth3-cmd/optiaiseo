/**
 * Mutation Operation Lifecycle — Shared Types & Enums
 *
 * Central type definitions for the mutation safety infrastructure.
 * See: implementation_plan.md v2.1
 */

// ── Operation Status ────────────────────────────────────────────────────────

export type OperationStatus =
  | "PROPOSED"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "EXECUTING"
  | "COMMITTED"
  | "EFFECTS_PENDING"
  | "COMPLETED"
  | "COMPLETED_WITH_ERRORS"
  // Terminal failure states
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED"
  | "FAILED"
  | "STALE";

/** Valid state transitions for MutationOperation */
export const VALID_TRANSITIONS: Record<OperationStatus, OperationStatus[]> = {
  PROPOSED: ["PENDING_APPROVAL", "APPROVED", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "EXPIRED", "CANCELLED"],
  APPROVED: ["EXECUTING", "EXPIRED", "CANCELLED"],
  EXECUTING: ["COMMITTED", "FAILED", "STALE"],
  COMMITTED: ["EFFECTS_PENDING", "COMPLETED"],
  EFFECTS_PENDING: ["COMPLETED", "COMPLETED_WITH_ERRORS"],
  COMPLETED: [],
  COMPLETED_WITH_ERRORS: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
  FAILED: [],
  STALE: [],
};

export const TERMINAL_STATUSES: OperationStatus[] = [
  "COMPLETED",
  "COMPLETED_WITH_ERRORS",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
  "FAILED",
  "STALE",
];

// ── Effect Status ───────────────────────────────────────────────────────────

export type EffectStatus =
  | "QUEUED"
  | "DISPATCHED"
  | "CONFIRMED"
  | "FAILED"
  | "IRREVERSIBLE_DISPATCHED"
  | "CANCELLED";

export const TERMINAL_EFFECT_STATUSES: EffectStatus[] = [
  "CONFIRMED",
  "FAILED",
  "IRREVERSIBLE_DISPATCHED",
  "CANCELLED",
];

// ── Confirmation & Compensation ─────────────────────────────────────────────

export type ConfirmationMode = "POLL" | "READ_AFTER_WRITE" | "NONE";

export type CompensationPolicy =
  | "ROLLBACK_SUPPORTED"
  | "ROLLBACK_PARTIAL"
  | "COMPENSATION_ONLY"
  | "IRREVERSIBLE";

// ── Risk ────────────────────────────────────────────────────────────────────

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

// ── Kill Switch ─────────────────────────────────────────────────────────────

export type KillSwitchChannel = "CMS" | "GITHUB" | "INDEXNOW";

// ── Actor ───────────────────────────────────────────────────────────────────

export type ActorType = "USER" | "SYSTEM" | "CRON";

// ── Mutation Types ──────────────────────────────────────────────────────────

export type MutationType =
  | "BLOG_CONTENT_UPDATE"
  | "BLOG_STATUS_UPDATE"
  | "BLOG_SCHEMA_UPDATE"
  | "BLOG_REFRESH"
  | "INTERNAL_LINK_CREATE"
  | "CMS_PUBLISH"
  | "GITHUB_PR"
  | "CONTENT_CONSOLIDATION";

// ── Effect Types ────────────────────────────────────────────────────────────

export type EffectType =
  | "CMS_PUBLISH"
  | "INDEXNOW"
  | "GITHUB_PR"
  | "GOOGLE_INDEXING";

// ── Errors ──────────────────────────────────────────────────────────────────

export class MutationBlockedError extends Error {
  constructor(reason: string) {
    super(`Mutation blocked: ${reason}`);
    this.name = "MutationBlockedError";
  }
}

export class ConcurrentModificationError extends Error {
  public readonly targetModel: string;
  public readonly targetId: string;
  public readonly expectedVersion: number;

  constructor(targetModel: string, targetId: string, expectedVersion: number) {
    super(
      `Concurrent modification: ${targetModel}#${targetId} expected version ${expectedVersion} but target has been modified`
    );
    this.name = "ConcurrentModificationError";
    this.targetModel = targetModel;
    this.targetId = targetId;
    this.expectedVersion = expectedVersion;
  }
}

export class ApprovalExpiredError extends Error {
  constructor(operationId: string) {
    super(`Approval expired for operation ${operationId}`);
    this.name = "ApprovalExpiredError";
  }
}

export class ApprovalHashMismatchError extends Error {
  constructor(operationId: string) {
    super(
      `Approval hash mismatch for operation ${operationId} — mutation payload changed after approval`
    );
    this.name = "ApprovalHashMismatchError";
  }
}

export class ExecutionClaimError extends Error {
  constructor(operationId: string) {
    super(
      `Failed to claim execution for operation ${operationId} — another worker is executing`
    );
    this.name = "ExecutionClaimError";
  }
}
