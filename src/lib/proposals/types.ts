import type { RiskLevel } from "@/lib/mutations/types";


export type ActionType =
  | "UPDATE_META_DESCRIPTION"
  | "UPDATE_TITLE_TAG"
  | "FIX_HEADING_HIERARCHY"
  | "ADD_SCHEMA_MARKUP"
  | "ADD_CANONICAL_TAG"
  | "FIX_BROKEN_LINK"
  | "ADD_INTERNAL_LINKS"
  | "CHANGE_CANONICAL"
  | "MODIFY_ROBOTS_META"
  | "REDIRECT_URL"
  | "CHANGE_PAGE_TITLE"
  | "PUBLISH_CONTENT"
  | "REFRESH_CONTENT"
  | "GENERATE_CONTENT_BRIEF"
  | "DELETE_PAGE"
  | "CONSOLIDATE_CONTENT"
  | "MASS_REDIRECT"
  | "SITE_WIDE_CHANGE";

// ── Safety Tiers ────────────────────────────────────────────────────────────
//
// Tier 0 — Read only (analyze, report, recommend). No mutation.
// Tier 1 — Low-risk automatic. Auto-execute under policy.
// Tier 2 — Approval required. Human must approve before execution.
// Tier 3 — High-risk. Explicit approval + stronger verification.

export type SafetyTier = 0 | 1 | 2 | 3;

export const SAFETY_TIER_MAP: Record<ActionType, SafetyTier> = {
  UPDATE_META_DESCRIPTION: 1,
  UPDATE_TITLE_TAG: 1,
  FIX_HEADING_HIERARCHY: 1,
  ADD_SCHEMA_MARKUP: 1,
  ADD_CANONICAL_TAG: 1,
  FIX_BROKEN_LINK: 1,
  ADD_INTERNAL_LINKS: 1,
  // Tier 2 — Approval required
  CHANGE_CANONICAL: 2,
  MODIFY_ROBOTS_META: 2,
  REDIRECT_URL: 2,
  CHANGE_PAGE_TITLE: 2,
  PUBLISH_CONTENT: 2,
  REFRESH_CONTENT: 2,
  GENERATE_CONTENT_BRIEF: 2,
  // Tier 3 — High-risk
  DELETE_PAGE: 3,
  CONSOLIDATE_CONTENT: 3,
  MASS_REDIRECT: 3,
  SITE_WIDE_CHANGE: 3,
};

export function getSafetyTier(actionType: ActionType): SafetyTier {
  return SAFETY_TIER_MAP[actionType];
}

export function requiresHumanApproval(tier: SafetyTier): boolean {
  return tier >= 2;
}

// ── Opportunity Lifecycle (GrowthDecision) ──────────────────────────────────

export type OpportunityStatus =
  | "OPEN"
  | "PROPOSED"
  | "APPROVED"
  | "EXECUTING"
  | "VERIFYING"
  | "VERIFIED"
  | "FAILED"
  | "REJECTED"
  | "ROLLED_BACK"
  | "EXPIRED";

export const OPPORTUNITY_TRANSITIONS: Record<
  OpportunityStatus,
  OpportunityStatus[]
> = {
  OPEN: ["PROPOSED", "EXPIRED"],
  PROPOSED: ["APPROVED", "REJECTED", "EXPIRED"],
  APPROVED: ["EXECUTING", "EXPIRED"],
  EXECUTING: ["VERIFYING", "FAILED"],
  VERIFYING: ["VERIFIED", "FAILED"],
  VERIFIED: [],                           // Terminal ✓
  FAILED: ["OPEN", "ROLLED_BACK"],         // Can re-open or rollback
  REJECTED: ["OPEN"],                      // Can re-open with new proposal
  ROLLED_BACK: [],                         // Terminal ✓
  EXPIRED: ["OPEN"],                       // Can re-open
};

export const TERMINAL_OPPORTUNITY_STATUSES: OpportunityStatus[] = [
  "VERIFIED",
  "ROLLED_BACK",
];

// ── Proposal Lifecycle ──────────────────────────────────────────────────────

export type ProposalStatus =
  | "DRAFT"
  | "READY"
  | "APPROVED"
  | "REJECTED"
  | "EXECUTING"
  | "EXECUTED"
  | "VERIFYING"
  | "VERIFIED"
  | "FAILED"
  | "EXPIRED";

export const PROPOSAL_TRANSITIONS: Record<
  ProposalStatus,
  ProposalStatus[]
> = {
  DRAFT: ["READY", "REJECTED"],
  READY: ["APPROVED", "REJECTED", "EXPIRED"],
  APPROVED: ["EXECUTING", "EXPIRED"],
  REJECTED: [],
  EXECUTING: ["EXECUTED", "FAILED"],
  EXECUTED: ["VERIFYING"],
  VERIFYING: ["VERIFIED", "FAILED"],
  VERIFIED: [],
  FAILED: [],
  EXPIRED: [],
};

export const TERMINAL_PROPOSAL_STATUSES: ProposalStatus[] = [
  "VERIFIED",
  "REJECTED",
  "FAILED",
  "EXPIRED",
];

// ── Proposed Change ─────────────────────────────────────────────────────────

export interface ProposedChange {
  field: string;
  currentValue: string | null;
  proposedValue: string;
  reasoning: string;
}

export type VerificationCheckType =
  | "HAS_META_DESCRIPTION"
  | "META_DESCRIPTION_MATCHES"
  | "META_DESCRIPTION_LENGTH_VALID"
  | "HAS_TITLE"
  | "TITLE_MATCHES"
  | "HAS_CANONICAL"
  | "CANONICAL_MATCHES"
  | "HAS_H1"
  | "SINGLE_H1"
  | "HEADING_HIERARCHY_VALID"
  | "SCHEMA_MARKUP_PRESENT"
  | "SCHEMA_MARKUP_VALID"
  | "INTERNAL_LINK_EXISTS"
  | "HTTP_STATUS_200"
  | "ROBOTS_META_UNCHANGED"
  | "CANONICAL_UNCHANGED"
  | "PAGE_INDEXABLE"
  | "CONTENT_CONTAINS_KEYWORD";

export interface VerificationCriterion {
  check: VerificationCheckType;
  expectedValue?: string;
  targetUrl?: string;
  critical?: boolean;
}

export type VerificationOutcome = "VERIFIED" | "FAILED" | "PARTIAL";

export interface VerificationDetail {
  check: VerificationCheckType;
  passed: boolean;
  actualValue?: string;
  expectedValue?: string;
  message?: string;
}


export const VERIFICATION_CRITERIA_MAP: Record<
  ActionType,
  VerificationCriterion[]
> = {
  UPDATE_META_DESCRIPTION: [
    { check: "HAS_META_DESCRIPTION", critical: true },
    { check: "META_DESCRIPTION_MATCHES", critical: true },
    { check: "META_DESCRIPTION_LENGTH_VALID", critical: false },
    { check: "HTTP_STATUS_200", critical: true },
    { check: "CANONICAL_UNCHANGED", critical: true },
    { check: "ROBOTS_META_UNCHANGED", critical: true },
  ],
  UPDATE_TITLE_TAG: [
    { check: "HAS_TITLE", critical: true },
    { check: "TITLE_MATCHES", critical: true },
    { check: "HTTP_STATUS_200", critical: true },
    { check: "CANONICAL_UNCHANGED", critical: true },
  ],
  FIX_HEADING_HIERARCHY: [
    { check: "HAS_H1", critical: true },
    { check: "SINGLE_H1", critical: true },
    { check: "HEADING_HIERARCHY_VALID", critical: true },
    { check: "HTTP_STATUS_200", critical: true },
  ],
  ADD_SCHEMA_MARKUP: [
    { check: "SCHEMA_MARKUP_PRESENT", critical: true },
    { check: "SCHEMA_MARKUP_VALID", critical: false },
    { check: "HTTP_STATUS_200", critical: true },
  ],
  ADD_CANONICAL_TAG: [
    { check: "HAS_CANONICAL", critical: true },
    { check: "CANONICAL_MATCHES", critical: true },
    { check: "HTTP_STATUS_200", critical: true },
  ],
  FIX_BROKEN_LINK: [
    { check: "HTTP_STATUS_200", critical: true },
  ],
  ADD_INTERNAL_LINKS: [
    { check: "INTERNAL_LINK_EXISTS", critical: true },
    { check: "HTTP_STATUS_200", critical: true },
  ],
  CHANGE_CANONICAL: [
    { check: "HAS_CANONICAL", critical: true },
    { check: "CANONICAL_MATCHES", critical: true },
    { check: "HTTP_STATUS_200", critical: true },
    { check: "PAGE_INDEXABLE", critical: true },
  ],
  MODIFY_ROBOTS_META: [
    { check: "HTTP_STATUS_200", critical: true },
  ],
  REDIRECT_URL: [
    { check: "HTTP_STATUS_200", critical: true },
  ],
  CHANGE_PAGE_TITLE: [
    { check: "HAS_TITLE", critical: true },
    { check: "TITLE_MATCHES", critical: true },
    { check: "HTTP_STATUS_200", critical: true },
    { check: "CANONICAL_UNCHANGED", critical: true },
  ],
  PUBLISH_CONTENT: [
    { check: "HTTP_STATUS_200", critical: true },
    { check: "PAGE_INDEXABLE", critical: true },
    { check: "HAS_META_DESCRIPTION", critical: false },
    { check: "HAS_TITLE", critical: true },
    { check: "HAS_CANONICAL", critical: false },
  ],
  REFRESH_CONTENT: [
    { check: "HTTP_STATUS_200", critical: true },
    { check: "CONTENT_CONTAINS_KEYWORD", critical: false },
    { check: "CANONICAL_UNCHANGED", critical: true },
  ],
  GENERATE_CONTENT_BRIEF: [],
  DELETE_PAGE: [],
  CONSOLIDATE_CONTENT: [
    { check: "HTTP_STATUS_200", critical: true },
  ],
  MASS_REDIRECT: [],
  SITE_WIDE_CHANGE: [
    { check: "HTTP_STATUS_200", critical: true },
  ],
};


export type CompensationPolicyType =
  | "ROLLBACK_SUPPORTED"
  | "ROLLBACK_PARTIAL"
  | "COMPENSATION_ONLY"
  | "IRREVERSIBLE";

export interface RollbackInfo {
  canRollback: boolean;
  compensationPolicy: CompensationPolicyType;
  rolledBackAt?: Date;
  rolledBackBy?: string;
  rollbackOperationId?: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

export const RETRY_POLICIES: Record<SafetyTier, RetryPolicy> = {
  0: {
    maxAttempts: 0,
    baseDelayMs: 0,
    maxDelayMs: 0,
    backoffFactor: 0,
  },
  1: {
    maxAttempts: 3,
    baseDelayMs: 30_000,
    maxDelayMs: 600_000,
    backoffFactor: 2,
  },
  2: {
    maxAttempts: 2,
    baseDelayMs: 60_000,
    maxDelayMs: 900_000,
    backoffFactor: 2,
  },
  3: {
    maxAttempts: 1,
    baseDelayMs: 0,
    maxDelayMs: 0,
    backoffFactor: 0,
  },
};

export function computeNextRetryDelay(
  policy: RetryPolicy,
  attemptNumber: number
): number {
  const delay =
    policy.baseDelayMs *
    Math.pow(policy.backoffFactor, attemptNumber - 1);
  return Math.min(delay, policy.maxDelayMs);
}

export function canRetry(attemptCount: number, safetyTier: SafetyTier): boolean {
  const policy = RETRY_POLICIES[safetyTier];
  return attemptCount < policy.maxAttempts;
}

// ── Verification Delay Per Action Type ──────────────────────────────────────

export const VERIFICATION_DELAYS: Record<ActionType, number> = {
  UPDATE_META_DESCRIPTION: 5 * 60 * 1000,
  UPDATE_TITLE_TAG: 5 * 60 * 1000,
  FIX_HEADING_HIERARCHY: 5 * 60 * 1000,
  ADD_SCHEMA_MARKUP: 5 * 60 * 1000,
  ADD_CANONICAL_TAG: 5 * 60 * 1000,
  FIX_BROKEN_LINK: 5 * 60 * 1000,
  ADD_INTERNAL_LINKS: 10 * 60 * 1000,
  CHANGE_CANONICAL: 30 * 60 * 1000,
  MODIFY_ROBOTS_META: 30 * 60 * 1000,
  REDIRECT_URL: 60 * 60 * 1000,
  CHANGE_PAGE_TITLE: 10 * 60 * 1000,
  PUBLISH_CONTENT: 30 * 60 * 1000,
  REFRESH_CONTENT: 30 * 60 * 1000,
  GENERATE_CONTENT_BRIEF: 0,
  DELETE_PAGE: 60 * 60 * 1000,
  CONSOLIDATE_CONTENT: 60 * 60 * 1000,
  MASS_REDIRECT: 2 * 60 * 60 * 1000,
  SITE_WIDE_CHANGE: 2 * 60 * 60 * 1000,
};


export interface FindingActionMapping {
  actionType: ActionType;
  safetyTier: SafetyTier;
}

export const FINDING_TO_ACTION_MAP: Record<string, FindingActionMapping> = {
  MISSING_META_DESCRIPTION: {
    actionType: "UPDATE_META_DESCRIPTION",
    safetyTier: 1,
  },
  MISSING_TITLE: {
    actionType: "UPDATE_TITLE_TAG",
    safetyTier: 1,
  },
  MISSING_H1: {
    actionType: "FIX_HEADING_HIERARCHY",
    safetyTier: 1,
  },
  BROKEN_LINK: {
    actionType: "FIX_BROKEN_LINK",
    safetyTier: 1,
  },
  ORPHAN_PAGE: {
    actionType: "ADD_INTERNAL_LINKS",
    safetyTier: 1,
  },
  LOW_CTR: {
    actionType: "UPDATE_TITLE_TAG",
    safetyTier: 1,
  },
  THIN_CONTENT: {
    actionType: "REFRESH_CONTENT",
    safetyTier: 2,
  },
  INTENT_MISMATCH: {
    actionType: "REFRESH_CONTENT",
    safetyTier: 2,
  },
  NOINDEX_PAGE: {
    actionType: "MODIFY_ROBOTS_META",
    safetyTier: 2,
  },
  INDEXATION_CONFLICT: {
    actionType: "CHANGE_CANONICAL",
    safetyTier: 2,
  },
  CANNIBALIZATION_RISK: {
    actionType: "CONSOLIDATE_CONTENT",
    safetyTier: 3,
  },
  TOPIC_OPPORTUNITY: {
    actionType: "GENERATE_CONTENT_BRIEF",
    safetyTier: 2,
  },
};

// ── Errors ──────────────────────────────────────────────────────────────────

export class OpportunityTransitionError extends Error {
  public readonly from: OpportunityStatus;
  public readonly to: OpportunityStatus;

  constructor(from: OpportunityStatus, to: OpportunityStatus) {
    super(
      `Invalid opportunity transition: ${from} → ${to}. Allowed: ${(OPPORTUNITY_TRANSITIONS[from] ?? []).join(", ") || "none (terminal)"}`
    );
    this.name = "OpportunityTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class ProposalTransitionError extends Error {
  public readonly from: ProposalStatus;
  public readonly to: ProposalStatus;

  constructor(from: ProposalStatus, to: ProposalStatus) {
    super(
      `Invalid proposal transition: ${from} → ${to}. Allowed: ${(PROPOSAL_TRANSITIONS[from] ?? []).join(", ") || "none (terminal)"}`
    );
    this.name = "ProposalTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class ProposalApprovalExpiredError extends Error {
  constructor(proposalId: string) {
    super(`Approval expired for proposal ${proposalId}`);
    this.name = "ProposalApprovalExpiredError";
  }
}

export class ProposalApprovalHashMismatchError extends Error {
  constructor(proposalId: string) {
    super(
      `Approval hash mismatch for proposal ${proposalId} — proposed changes modified after approval`
    );
    this.name = "ProposalApprovalHashMismatchError";
  }
}

export class ProposalMaxAttemptsError extends Error {
  constructor(proposalId: string, maxAttempts: number) {
    super(
      `Proposal ${proposalId} has reached maximum attempts (${maxAttempts})`
    );
    this.name = "ProposalMaxAttemptsError";
  }
}
