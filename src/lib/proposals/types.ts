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



export type SafetyTier = 1 | 2 | 3;

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
  OPEN: ["PROPOSED"],
  PROPOSED: ["APPROVED", "REJECTED", "EXPIRED"],
  // APPROVED → REJECTED: user rejects before execution starts (Amendment #4)
  APPROVED: ["EXECUTING", "REJECTED", "EXPIRED"],
  EXECUTING: ["VERIFYING", "FAILED"],
  VERIFYING: ["VERIFIED", "FAILED"],
  // VERIFIED allows rollback when a regression is discovered post-execution
  VERIFIED: ["ROLLED_BACK"],
  FAILED: ["OPEN", "ROLLED_BACK"],       // retry (→ OPEN) or rollback (→ ROLLED_BACK)
  REJECTED: ["OPEN"],                    // re-open after rejection
  ROLLED_BACK: [],                       // terminal — no further transitions
  // EXPIRED → OPEN: handled by proposalExpireCron re-opening the opportunity
  EXPIRED: ["OPEN"],
};

// Terminal = no outgoing transitions in OPPORTUNITY_TRANSITIONS.
// Only ROLLED_BACK is truly terminal — every other status has at least one
// valid outgoing transition.
//
// Note: VERIFIED and EXPIRED are NOT in this list despite being "end-states"
// in the happy path — both allow further transitions (VERIFIED → ROLLED_BACK,
// EXPIRED → OPEN) and must not be treated as dead-ends by the state machine.
export const TERMINAL_OPPORTUNITY_STATUSES: OpportunityStatus[] = [
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
  | "ROLLED_BACK"
  | "ROLLBACK_PARTIAL"  // DB restored but ≥1 external effect compensation failed
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
  EXECUTED: ["VERIFYING", "ROLLED_BACK", "ROLLBACK_PARTIAL"],
  VERIFYING: ["VERIFIED", "FAILED"],
  // A verified proposal can be rolled back if a regression is detected later.
  // ROLLBACK_PARTIAL is also possible when external compensation is incomplete.
  VERIFIED: ["ROLLED_BACK", "ROLLBACK_PARTIAL"],
  // Allow retry of compensation from ROLLBACK_PARTIAL.
  ROLLBACK_PARTIAL: ["ROLLED_BACK"],
  ROLLED_BACK: [],
  FAILED: [],
  EXPIRED: [],
};

export const TERMINAL_PROPOSAL_STATUSES: ProposalStatus[] = [
  "ROLLED_BACK",
  "REJECTED",
  "FAILED",
  "EXPIRED",
  // ROLLBACK_PARTIAL is NOT terminal — compensation can be retried.
];

// ── Rollback Eligibility ────────────────────────────────────────────────────────────

/**
 * Statuses from which a proposal can be rolled back.
 * EXECUTING is explicitly excluded — rolling back while a mutation is in flight
 * creates a race between the ActionRunner and the compensation handler.
 * ROLLBACK_PARTIAL is included so partial compensation can be re-attempted.
 */
export const ROLLBACK_ELIGIBLE_PROPOSAL_STATUSES: ProposalStatus[] = [
  "VERIFIED",
  "FAILED",
  "EXECUTED",
  "ROLLBACK_PARTIAL",
];

/**
 * Statuses from which an opportunity can be rolled back.
 */
export const ROLLBACK_ELIGIBLE_OPPORTUNITY_STATUSES: OpportunityStatus[] = [
  "VERIFIED",
  "FAILED",
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
  | "PAGE_NOT_INDEXABLE"
  | "CONTENT_CONTAINS_KEYWORD"
  | "REDIRECT_STATUS_MATCHES"   
  | "REDIRECT_LOCATION_MATCHES"  
  | "REDIRECT_TARGET_HEALTHY"    
  | "PAGE_REMOVED";              


export interface VerificationCriterion {
  check: VerificationCheckType;
  expectedValue?: string;
  targetUrl?: string;
  severity: "CRITICAL" | "WARNING";
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
    { check: "HAS_META_DESCRIPTION", severity: "CRITICAL" },
    { check: "META_DESCRIPTION_MATCHES", severity: "CRITICAL" },
    { check: "META_DESCRIPTION_LENGTH_VALID", severity: "WARNING" },
    { check: "HTTP_STATUS_200", severity: "CRITICAL" },
    { check: "CANONICAL_UNCHANGED", severity: "CRITICAL" },
    { check: "ROBOTS_META_UNCHANGED", severity: "CRITICAL" },
  ],
  UPDATE_TITLE_TAG: [
    { check: "HAS_TITLE", severity: "CRITICAL" },
    { check: "TITLE_MATCHES", severity: "CRITICAL" },
    { check: "HTTP_STATUS_200", severity: "CRITICAL" },
    { check: "CANONICAL_UNCHANGED", severity: "CRITICAL" },
  ],
  FIX_HEADING_HIERARCHY: [
    { check: "HAS_H1", severity: "CRITICAL" },
    { check: "SINGLE_H1", severity: "CRITICAL" },
    { check: "HEADING_HIERARCHY_VALID", severity: "CRITICAL" },
    { check: "HTTP_STATUS_200", severity: "CRITICAL" },
  ],
  ADD_SCHEMA_MARKUP: [
    { check: "SCHEMA_MARKUP_PRESENT", severity: "CRITICAL" },
    { check: "SCHEMA_MARKUP_VALID", severity: "WARNING" },
    { check: "HTTP_STATUS_200", severity: "CRITICAL" },
  ],
  ADD_CANONICAL_TAG: [
    { check: "HAS_CANONICAL", severity: "CRITICAL" },
    { check: "CANONICAL_MATCHES", severity: "CRITICAL" },
    { check: "HTTP_STATUS_200", severity: "CRITICAL" },
  ],
  FIX_BROKEN_LINK: [
    { check: "HTTP_STATUS_200", severity: "CRITICAL" },
  ],
  ADD_INTERNAL_LINKS: [
    { check: "INTERNAL_LINK_EXISTS", severity: "CRITICAL" },
    { check: "HTTP_STATUS_200", severity: "CRITICAL" },
  ],
  CHANGE_CANONICAL: [
    { check: "HAS_CANONICAL", severity: "CRITICAL" },
    { check: "CANONICAL_MATCHES", severity: "CRITICAL" },
    { check: "HTTP_STATUS_200", severity: "CRITICAL" },
    { check: "PAGE_INDEXABLE", severity: "CRITICAL" },
  ],
  MODIFY_ROBOTS_META: [
    { check: "HTTP_STATUS_200", severity: "CRITICAL" },
  ],
  REDIRECT_URL: [
    { check: "REDIRECT_STATUS_MATCHES", severity: "CRITICAL", expectedValue: "301" },
    { check: "REDIRECT_LOCATION_MATCHES", severity: "CRITICAL" },
    { check: "REDIRECT_TARGET_HEALTHY", severity: "CRITICAL" },
    { check: "PAGE_INDEXABLE", severity: "WARNING" },
  ],
  CHANGE_PAGE_TITLE: [
    { check: "HAS_TITLE", severity: "CRITICAL" },
    { check: "TITLE_MATCHES", severity: "CRITICAL" },
    { check: "HTTP_STATUS_200", severity: "CRITICAL" },
    { check: "CANONICAL_UNCHANGED", severity: "CRITICAL" },
  ],
  PUBLISH_CONTENT: [
    { check: "HTTP_STATUS_200", severity: "CRITICAL" },
    { check: "PAGE_INDEXABLE", severity: "CRITICAL" },
    { check: "HAS_META_DESCRIPTION", severity: "WARNING" },
    { check: "HAS_TITLE", severity: "CRITICAL" },
    { check: "HAS_CANONICAL", severity: "WARNING" },
  ],
  REFRESH_CONTENT: [
    { check: "HTTP_STATUS_200", severity: "CRITICAL" },
    { check: "CONTENT_CONTAINS_KEYWORD", severity: "WARNING" },
    { check: "CANONICAL_UNCHANGED", severity: "CRITICAL" },
  ],
  GENERATE_CONTENT_BRIEF: [],
  DELETE_PAGE: [
    { check: "PAGE_REMOVED", severity: "CRITICAL" },        // 404 or 410
    { check: "PAGE_NOT_INDEXABLE", severity: "WARNING" },
  ],
  CONSOLIDATE_CONTENT: [
    { check: "HTTP_STATUS_200", severity: "CRITICAL" },
  ],
  MASS_REDIRECT: [],
  SITE_WIDE_CHANGE: [
    { check: "HTTP_STATUS_200", severity: "CRITICAL" },
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
  // Tier 1: Low-risk — up to 3 automated retries with exponential backoff
  1: {
    maxAttempts: 3,
    baseDelayMs: 30_000,
    maxDelayMs: 600_000,
    backoffFactor: 2,
  },
  // Tier 2: Human-approved — 2 attempts max (human re-approves each time)
  2: {
    maxAttempts: 2,
    baseDelayMs: 60_000,
    maxDelayMs: 900_000,
    backoffFactor: 2,
  },
  // Tier 3: High-risk — 1 attempt only, must create a new proposal to retry
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

export class RetryChainExhaustedError extends Error {
  public readonly decisionId: string;
  public readonly maxRetries: number;

  constructor(decisionId: string, maxRetries: number) {
    super(
      `Opportunity ${decisionId} has exhausted its retry budget (${maxRetries} retries)`
    );
    this.name = "RetryChainExhaustedError";
    this.decisionId = decisionId;
    this.maxRetries = maxRetries;
  }
}
