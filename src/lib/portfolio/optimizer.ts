/**
 * Phase D.7.2 — Deterministic Constrained Greedy Portfolio Optimizer
 *
 * Selects the optimal subset of OPEN opportunities for a site within
 * a given allocation cycle.
 *
 * ALGORITHM:
 *   1. Compute utility score for each candidate
 *   2. Sort by deterministic total order (utility DESC, tie-breaks)
 *   3. Iterate sorted candidates, accepting or rejecting per constraints
 *   4. Decorate accepted candidates with experiment preference
 *
 * INVARIANTS:
 *   - Same inputs → same outputs (deterministic)
 *   - Input order does not affect output (sort is total)
 *   - D.7 does NOT reserve budget, create claims, or mutate lifecycle
 *   - D.6 signals are NOT re-applied (already in D.2 finalScore)
 *   - Category exposure uses projected formula to avoid order dependence
 */

import {
  type AllocationCandidate,
  type AllocationDecision,
  type PortfolioConstraints,
  type PortfolioAllocationResult,
  type PortfolioDiagnostics,
  type UtilityWeights,
  type ExperimentPreference,
  DEFAULT_UTILITY_WEIGHTS,
  DEFAULT_PORTFOLIO_CONSTRAINTS,
  HIGH_RISK_THRESHOLD,
  PORTFOLIO_ALGORITHM_VERSION,
  REASON_CODES,
  allocationConflictKey,
  generateCycleId,
} from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

/** Active D.5 experiments that block specific resources */
export interface ActiveExperimentConflict {
  resourceType: string;
  resourceId: string;
  url: string;
  experimentId: string;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Runs the deterministic constrained greedy allocator.
 *
 * @param candidates — Scored OPEN opportunities (any order)
 * @param constraints — Planning envelope (not budget reservation)
 * @param activeExperiments — D.5 experiments that block resources
 * @param existingExperimentSlots — Currently active D.5 experiment count for this site
 * @param weights — Utility weights (default: d7-v1 weights)
 * @param now — Current time for expiry checks (default: new Date())
 * @returns Full allocation result with SELECTED / DEFERRED / EXCLUDED decisions
 */
export function optimizePortfolio(
  candidates: AllocationCandidate[],
  constraints: PortfolioConstraints = DEFAULT_PORTFOLIO_CONSTRAINTS,
  activeExperiments: ActiveExperimentConflict[] = [],
  existingExperimentSlots: number = 0,
  weights: UtilityWeights = DEFAULT_UTILITY_WEIGHTS,
  now: Date = new Date(),
  siteId?: string
): PortfolioAllocationResult {
  const startMs = Date.now();

  // ── 1. Pre-filter: EXCLUDED candidates ────────────────────────────────
  const eligible: ScoredCandidate[] = [];
  const excluded: AllocationDecision[] = [];

  for (const c of candidates) {
    const reasons = getExclusionReasons(c, constraints, now);
    if (reasons.length > 0) {
      excluded.push(makeDecision(c, "EXCLUDED", null, computeUtility(c, weights), reasons, "NOT_EXPERIMENT_ELIGIBLE"));
    } else {
      eligible.push({
        candidate: c,
        utility: computeUtility(c, weights),
      });
    }
  }

  // ── 2. Sort by deterministic total order ──────────────────────────────
  eligible.sort((a, b) => compareCandidates(a, b));

  // ── 3. Build conflict sets ────────────────────────────────────────────
  const d5ConflictKeys = new Set<string>();
  const d5ConflictUrls = new Set<string>();
  for (const exp of activeExperiments) {
    d5ConflictKeys.add(allocationConflictKey(exp.resourceType, exp.resourceId));
    d5ConflictUrls.add(exp.url);
  }

  // ── 4. Greedy selection with constraint enforcement ───────────────────
  const selected: AllocationDecision[] = [];
  const deferred: AllocationDecision[] = [];

  const selectedResourceKeys = new Set<string>();
  const selectedUrls = new Set<string>();
  const categoryCounts = new Map<string, number>();
  let highRiskCount = 0;
  let experimentSlotsUsed = 0;
  const availableExperimentSlots = Math.max(0, constraints.maxConcurrentExperiments - existingExperimentSlots);

  for (const { candidate: c, utility } of eligible) {
    const deferReasons: string[] = [];

    // Constraint: Resource conflict (same resourceType:resourceId already selected)
    const conflictKey = allocationConflictKey(c.resourceType, c.resourceId);
    if (selectedResourceKeys.has(conflictKey)) {
      deferReasons.push(REASON_CODES.RESOURCE_CONFLICT);
    }

    // Constraint: URL conflict (same canonical URL already selected)
    if (selectedUrls.has(c.url)) {
      deferReasons.push(REASON_CODES.URL_CONFLICT);
    }

    // Constraint: Active D.5 experiment conflict
    if (d5ConflictKeys.has(conflictKey) || d5ConflictUrls.has(c.url)) {
      deferReasons.push(REASON_CODES.D5_EXPERIMENT_CONFLICT);
    }

    // Constraint: High-risk count ceiling
    if (c.riskScore >= HIGH_RISK_THRESHOLD && highRiskCount >= constraints.maxHighRiskSelections) {
      deferReasons.push(REASON_CODES.HIGH_RISK_COUNT);
    }

    // Constraint: Category exposure cap (projected formula)
    // projectedCategoryPct = (currentCategoryCount + 1) / (selectedCount + 1)
    // Note: The first item in any category (currentCategoryCount === 0) is always
    // allowed — a single selection is 100% of portfolio by definition, so the cap
    // only fires when adding a SECOND item to an existing category.
    const currentCategoryCount = categoryCounts.get(c.category) ?? 0;
    if (currentCategoryCount > 0) {
      const projectedPct = (currentCategoryCount + 1) / (selected.length + 1);
      if (projectedPct > constraints.maxCategoryExposurePct) {
        deferReasons.push(REASON_CODES.CATEGORY_EXPOSURE);
      }
    }

    // Constraint: Selection envelope
    if (selected.length >= constraints.maxSelections) {
      deferReasons.push(REASON_CODES.SELECTION_ENVELOPE);
    }

    if (deferReasons.length > 0) {
      deferred.push(makeDecision(c, "DEFERRED", null, utility, deferReasons, getExperimentPreference(c)));
      continue;
    }

    // ── Accept candidate ──────────────────────────────────────────────
    const rank = selected.length + 1;
    const expPref = getExperimentPreference(c);

    // Determine if this candidate should be experiment-preferred
    let finalExpPref = expPref;
    if (expPref === "EXPERIMENT_PREFERRED" && experimentSlotsUsed >= availableExperimentSlots) {
      finalExpPref = "STANDARD_PREFERRED";
    }

    selected.push(makeDecision(c, "SELECTED", rank, utility, [REASON_CODES.SCORE_ELIGIBLE], finalExpPref));

    // Update tracking state
    selectedResourceKeys.add(conflictKey);
    selectedUrls.add(c.url);
    categoryCounts.set(c.category, currentCategoryCount + 1);
    if (c.riskScore >= HIGH_RISK_THRESHOLD) highRiskCount++;
    if (finalExpPref === "EXPERIMENT_PREFERRED") experimentSlotsUsed++;
  }

  // ── 5. Build result ───────────────────────────────────────────────────
  const diagnostics: PortfolioDiagnostics = {
    totalCandidates: candidates.length,
    selectedCount: selected.length,
    deferredCount: deferred.length,
    excludedCount: excluded.length,
    experimentPreferredCount: selected.filter(s => s.experimentPreference === "EXPERIMENT_PREFERRED").length,
    durationMs: Date.now() - startMs,
  };

  const resolvedSiteId = siteId ?? candidates[0]?.siteId ?? "";

  return {
    cycleId: generateCycleId(resolvedSiteId),
    siteId: resolvedSiteId,
    optimizerVersion: PORTFOLIO_ALGORITHM_VERSION,
    allocatedAt: now,
    selected,
    deferred,
    excluded,
    constraintSnapshot: { ...constraints },
    utilityWeights: { ...weights },
    diagnostics,
  };
}

// ── Utility Function ────────────────────────────────────────────────────────

/**
 * Computes the portfolio utility score for a candidate.
 *
 * utility =
 *     finalScore      * weights.finalScore
 *   + impactScore     * weights.impact
 *   + confidenceScore * weights.confidence
 *   + (100 - effortScore) * weights.effortInverse
 *
 * Range: 0–100 (clamped)
 */
export function computeUtility(
  candidate: AllocationCandidate,
  weights: UtilityWeights = DEFAULT_UTILITY_WEIGHTS
): number {
  const raw =
    candidate.finalScore * weights.finalScore +
    candidate.impactScore * weights.impact +
    candidate.confidenceScore * weights.confidence +
    (100 - candidate.effortScore) * weights.effortInverse;

  return Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100;
}

// ── Deterministic Sorting ───────────────────────────────────────────────────

interface ScoredCandidate {
  candidate: AllocationCandidate;
  utility: number;
}

/**
 * Deterministic total-order comparator.
 *
 * 1. utility DESC
 * 2. finalScore DESC
 * 3. riskScore ASC
 * 4. createdAt ASC
 * 5. opportunityId ASC (lexicographic — absolute tie-break)
 */
function compareCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  // 1. utility DESC
  if (a.utility !== b.utility) return b.utility - a.utility;

  // 2. finalScore DESC
  if (a.candidate.finalScore !== b.candidate.finalScore) {
    return b.candidate.finalScore - a.candidate.finalScore;
  }

  // 3. riskScore ASC
  if (a.candidate.riskScore !== b.candidate.riskScore) {
    return a.candidate.riskScore - b.candidate.riskScore;
  }

  // 4. createdAt ASC
  const aTime = a.candidate.createdAt.getTime();
  const bTime = b.candidate.createdAt.getTime();
  if (aTime !== bTime) return aTime - bTime;

  // 5. opportunityId ASC (absolute deterministic tie-break)
  return a.candidate.opportunityId.localeCompare(b.candidate.opportunityId);
}

// ── Exclusion Rules ─────────────────────────────────────────────────────────

/**
 * Checks if a candidate should be EXCLUDED (not eligible at all).
 * EXCLUDED candidates are never considered for DEFERRED.
 */
function getExclusionReasons(
  c: AllocationCandidate,
  constraints: PortfolioConstraints,
  now: Date
): string[] {
  const reasons: string[] = [];

  // Expired opportunity
  if (c.expiresAt && c.expiresAt.getTime() <= now.getTime()) {
    reasons.push(REASON_CODES.EXPIRED);
  }

  // Below minimum score threshold
  if (c.finalScore < constraints.minFinalScore) {
    reasons.push(REASON_CODES.MIN_SCORE);
  }

  // Individual risk ceiling
  if (c.riskScore > constraints.maxIndividualRisk) {
    reasons.push(REASON_CODES.RISK_CEILING);
  }

  return reasons;
}

// ── Experiment Preference ───────────────────────────────────────────────────

/**
 * Determines if a candidate is eligible for D.5 experimentation.
 *
 * D.7 only sets PREFERENCE — D.5 remains the authority for actual
 * experiment creation, control/treatment generation, and idempotency.
 */
function getExperimentPreference(c: AllocationCandidate): ExperimentPreference {
  if (!c.experimentEligibility) return "NOT_EXPERIMENT_ELIGIBLE";
  return "EXPERIMENT_PREFERRED";
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeDecision(
  c: AllocationCandidate,
  decision: "SELECTED" | "DEFERRED" | "EXCLUDED",
  rank: number | null,
  utility: number,
  reasonCodes: string[],
  experimentPreference: ExperimentPreference
): AllocationDecision {
  return {
    opportunityId: c.opportunityId,
    scoreRecordId: c.scoreRecordId,
    evidenceHash: c.evidenceHash,
    rank,
    utilityScore: utility,
    decision,
    reasonCodes,
    experimentPreference,
    candidateSnapshot: { ...c },
  };
}
