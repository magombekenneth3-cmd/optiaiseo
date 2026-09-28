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
  | "STALE"
  | "ROLLED_BACK";

/** Valid state transitions for MutationOperation */
export const VALID_TRANSITIONS: Record<OperationStatus, OperationStatus[]> = {
  PROPOSED: ["PENDING_APPROVAL", "APPROVED", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "EXPIRED", "CANCELLED"],
  APPROVED: ["EXECUTING", "EXPIRED", "CANCELLED"],
  EXECUTING: ["COMMITTED", "FAILED", "STALE"],
  COMMITTED: ["EFFECTS_PENDING", "COMPLETED", "ROLLED_BACK"],
  EFFECTS_PENDING: ["COMPLETED", "COMPLETED_WITH_ERRORS", "ROLLED_BACK"],
  COMPLETED: ["ROLLED_BACK"],
  COMPLETED_WITH_ERRORS: ["ROLLED_BACK"],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
  FAILED: [],
  STALE: [],
  ROLLED_BACK: [],
};

export const TERMINAL_STATUSES: OperationStatus[] = [
  "COMPLETED",
  "COMPLETED_WITH_ERRORS",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
  "FAILED",
  "STALE",
  "ROLLED_BACK",
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

// ── Verification Outcomes ──────────────────────────────────────────────────
//
// SEO fixes need multi-stage verification:
//   T+0   — Technical: HTML/headers/schema confirm the change is live
//   T+7   — Search: GSC confirms indexing, impressions, position changes
//   T+28  — Business: Organic traffic, conversions, ranking trend
//
// "Fix deployed" ≠ "SEO issue fixed."

export type VerificationOutcome =
  | "PENDING"                  // No verification attempted yet
  | "TECHNICALLY_VERIFIED"     // T+0: HTML/headers confirm fix is applied
  | "PARTIALLY_VERIFIED"       // Some verification criteria pass, some fail
  | "SEARCH_VERIFIED"          // T+7–14: GSC confirms indexing/impressions
  | "OUTCOME_MEASURED"         // T+28: Business metrics improved
  | "INEFFECTIVE"              // Fix applied but no SEO improvement observed
  | "REGRESSED"                // Metrics worsened after the fix
  | "UNKNOWN";                 // Insufficient data to determine outcome

export type VerificationWindow =
  | "T0_TECHNICAL"             // Immediately post-deploy
  | "T7_SEARCH"               // 7–14 days post-deploy
  | "T28_BUSINESS";           // 28+ days post-deploy

/** Valid verification state transitions */
export const VALID_VERIFICATION_TRANSITIONS: Record<VerificationOutcome, VerificationOutcome[]> = {
  PENDING:                ["TECHNICALLY_VERIFIED", "PARTIALLY_VERIFIED", "UNKNOWN"],
  TECHNICALLY_VERIFIED:   ["SEARCH_VERIFIED", "INEFFECTIVE", "REGRESSED", "UNKNOWN"],
  PARTIALLY_VERIFIED:     ["TECHNICALLY_VERIFIED", "SEARCH_VERIFIED", "INEFFECTIVE", "UNKNOWN"],
  SEARCH_VERIFIED:        ["OUTCOME_MEASURED", "INEFFECTIVE", "REGRESSED"],
  OUTCOME_MEASURED:       ["REGRESSED"],  // can regress even after initial success
  INEFFECTIVE:            [],              // terminal
  REGRESSED:              [],              // terminal
  UNKNOWN:                ["TECHNICALLY_VERIFIED", "PARTIALLY_VERIFIED", "INEFFECTIVE"],
};

