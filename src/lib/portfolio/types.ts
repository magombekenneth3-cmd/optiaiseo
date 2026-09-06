/**
 * Phase D.7 — Portfolio Optimization Types
 *
 * D.7 is an admission/prioritization layer that selects the optimal subset
 * of OPEN opportunities for a site within a given allocation cycle.
 *
 * ARCHITECTURAL INVARIANT:
 *   D.7 chooses priority and allocation intent.
 *   It NEVER reserves budget, claims execution, transitions an opportunity
 *   into an executable lifecycle state, or mutates a site.
 *
 *   D.7 prioritizes → D.3/D.4 proposes → Phase C authorizes → Phase B mutates.
 *
 * INPUTS:
 *   D.2 scored OPEN opportunities (with exact score record provenance)
 *   D.5 active experiments (for conflict exclusion)
 *   Site constraints (planning envelope — not budget reservation)
 *
 * OUTPUTS:
 *   Durable PortfolioAllocation records (SELECTED / DEFERRED / EXCLUDED)
 *   Each record is fully reproducible from:
 *     candidate snapshot + constraint snapshot + optimizer version
 *
 * D.6 DOUBLE-COUNTING PREVENTION:
 *   D.2 finalScore already contains D.6 learned signal adjustments.
 *   D.7 does NOT re-apply D.6 signals to utility computation.
 *   D.6 data is available for diagnostics/provenance only.
 */

import { LEARNING_VERSION } from "@/lib/learning/types";

// ── Version ─────────────────────────────────────────────────────────────────

export const PORTFOLIO_ALGORITHM_VERSION = "d7-v1";

// ── Utility Weights ─────────────────────────────────────────────────────────

/**
 * Versioned utility weights for the deterministic greedy allocator.
 *
 * utility =
 *     finalScore      * FINAL_SCORE_WEIGHT
 *   + impactScore     * IMPACT_WEIGHT
 *   + confidenceScore * CONFIDENCE_WEIGHT
 *   + (100 - effortScore) * EFFORT_INVERSE_WEIGHT
 */
export interface UtilityWeights {
  finalScore: number;
  impact: number;
  confidence: number;
  effortInverse: number;
}

export const DEFAULT_UTILITY_WEIGHTS: Readonly<UtilityWeights> = {
  finalScore: 0.60,
  impact: 0.20,
  confidence: 0.10,
  effortInverse: 0.10,
} as const;

// ── Allocation Candidate ────────────────────────────────────────────────────

/**
 * A scored OPEN opportunity considered for portfolio selection.
 *
 * Strong provenance: binds to the exact D.2 score record and evidence hash
 * so that an allocation decision can be traced back to its inputs.
 */
export interface AllocationCandidate {
  opportunityId: string;
  siteId: string;

  // D.2 provenance — binds to the exact scoring evaluation
  scoreRecordId: string;
  scoringVersion: string;
  finalScore: number;

  // D.2 score components (already contain D.6 adjustments)
  impactScore: number;
  confidenceScore: number;
  effortScore: number;
  riskScore: number;

  // Learning provenance — which D.6 version influenced the D.2 score
  learningVersion: string | null;

  // Opportunity identity
  actionType: string;       // GrowthAction
  category: string;         // OpportunityCategory

  // Resource identity for conflict fencing
  resourceType: string;     // "PAGE" | "BLOG" | "SITE"
  resourceId: string;       // Canonical resource identifier
  url: string;

  // Evidence fencing
  evidenceHash: string;
  expiresAt: Date | null;

  // Timestamp for deterministic tie-breaking
  createdAt: Date;

  // D.5 eligibility
  experimentEligibility: boolean;
}

// ── Portfolio Constraints ───────────────────────────────────────────────────

/**
 * Count-based planning constraints.
 *
 * These are planning envelopes, NOT budget reservations.
 * Phase C independently enforces remaining mutation budget at execution time.
 */
export interface PortfolioConstraints {
  /** Max opportunities selected per cycle */
  maxSelections: number;
  /** Individual riskScore ceiling — candidates above this are EXCLUDED */
  maxIndividualRisk: number;
  /** Max selected candidates with riskScore >= HIGH_RISK_THRESHOLD */
  maxHighRiskSelections: number;
  /** Planning estimate for D.5 experiment slots available */
  maxConcurrentExperiments: number;
  /** Max fraction of selections in any single category (0.0–1.0) */
  maxCategoryExposurePct: number;
  /** Minimum D.2 finalScore for selection eligibility */
  minFinalScore: number;
}

/** riskScore at or above this value is classified as "high risk" */
export const HIGH_RISK_THRESHOLD = 60;

export const DEFAULT_PORTFOLIO_CONSTRAINTS: Readonly<PortfolioConstraints> = {
  maxSelections: 10,
  maxIndividualRisk: 75,
  maxHighRiskSelections: 2,
  maxConcurrentExperiments: 3,
  maxCategoryExposurePct: 0.40,
  minFinalScore: 40,
} as const;

// ── Allocation Decision ─────────────────────────────────────────────────────

export type AllocationDecisionType = "SELECTED" | "DEFERRED" | "EXCLUDED";

export type ExperimentPreference =
  | "EXPERIMENT_PREFERRED"
  | "STANDARD_PREFERRED"
  | "NOT_EXPERIMENT_ELIGIBLE";

/**
 * The decision made for a single candidate.
 *
 * reasonCodes explain WHY this decision was made (e.g. "RESOURCE_CONFLICT",
 * "RISK_CEILING", "SELECTION_ENVELOPE", "MIN_SCORE").
 */
export interface AllocationDecision {
  opportunityId: string;
  scoreRecordId: string;
  evidenceHash: string;
  rank: number | null;            // 1-indexed rank within SELECTED, null for others
  utilityScore: number;
  decision: AllocationDecisionType;
  reasonCodes: string[];
  experimentPreference: ExperimentPreference;
  candidateSnapshot: AllocationCandidate;
}

// ── Allocation Result ───────────────────────────────────────────────────────

export interface PortfolioDiagnostics {
  totalCandidates: number;
  selectedCount: number;
  deferredCount: number;
  excludedCount: number;
  experimentPreferredCount: number;
  durationMs: number;
}

/**
 * Full result of one portfolio allocation cycle.
 *
 * Reproducible from:
 *   candidates + constraintSnapshot + optimizerVersion
 */
export interface PortfolioAllocationResult {
  cycleId: string;
  siteId: string;
  optimizerVersion: string;
  allocatedAt: Date;

  selected: AllocationDecision[];
  deferred: AllocationDecision[];
  excluded: AllocationDecision[];

  constraintSnapshot: PortfolioConstraints;
  utilityWeights: UtilityWeights;
  diagnostics: PortfolioDiagnostics;
}

// ── Reason Codes ────────────────────────────────────────────────────────────

/** Deterministic, machine-readable reason codes for allocation decisions */
export const REASON_CODES = {
  // SELECTED
  SCORE_ELIGIBLE: "SCORE_ELIGIBLE",

  // EXCLUDED
  EXPIRED: "EXPIRED",
  MIN_SCORE: "MIN_SCORE",
  RISK_CEILING: "RISK_CEILING",

  // DEFERRED
  RESOURCE_CONFLICT: "RESOURCE_CONFLICT",
  URL_CONFLICT: "URL_CONFLICT",
  D5_EXPERIMENT_CONFLICT: "D5_EXPERIMENT_CONFLICT",
  HIGH_RISK_COUNT: "HIGH_RISK_COUNT",
  CATEGORY_EXPOSURE: "CATEGORY_EXPOSURE",
  SELECTION_ENVELOPE: "SELECTION_ENVELOPE",
} as const;

// ── Conflict Key ────────────────────────────────────────────────────────────

/**
 * Deterministic conflict key for resource identity.
 * Used for both intra-portfolio deduplication and D.5 experiment exclusion.
 */
export function allocationConflictKey(resourceType: string, resourceId: string): string {
  return `${resourceType}:${resourceId}`;
}

// ── Cycle ID ────────────────────────────────────────────────────────────────

/**
 * Deterministic cycle ID: "d7-{siteId}-{YYYYMMDD}"
 *
 * Ensures one allocation per site per day.
 * Same cycle cannot create duplicate allocations (enforced by DB @@unique).
 */
export function generateCycleId(siteId: string, date: Date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `d7-${siteId}-${yyyy}${mm}${dd}`;
}

// ── Allocation Fencing ──────────────────────────────────────────────────────

/**
 * Checks required before D.3 consumes a SELECTED allocation:
 *
 * 1. Opportunity still OPEN
 * 2. Not expired
 * 3. Same scoreRecordId
 * 4. Same evidenceHash
 * 5. Same siteId
 * 6. Allocation not expired
 * 7. No active D.5 experiment conflict created after allocation
 *
 * If any check fails → allocation is STALE and must not be consumed.
 */
export interface AllocationFenceCheck {
  valid: boolean;
  reason: string | null;
}
