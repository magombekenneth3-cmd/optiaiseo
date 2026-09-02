/**
 * Phase D.2 — Deterministic Eligibility Rules
 *
 * Evaluates whether a scored candidate should be PROMOTED, DEFERRED, or REJECTED.
 * All rules are explicit, ordered, and deterministic.
 *
 * Rule evaluation order (first terminal decision wins):
 *   1. Evidence expired?           → DEFER
 *   2. Evidence score < minimum?   → DEFER
 *   3. Risk score > maximum?       → REJECT
 *   4. Final score >= threshold?   → PROMOTE
 *   5. Otherwise                   → DEFER
 */

import type {
  ScoreComponents,
  ScoringDecision,
  DecisionReason,
  EligibilityConfig,
  ScoringInput,
} from "./types";
import { DEFAULT_ELIGIBILITY } from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

export interface EligibilityResult {
  decision: ScoringDecision;
  reasons: DecisionReason[];
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Evaluates eligibility of a scored candidate.
 *
 * All rules are checked and their reasons are collected.
 * The first terminal rule determines the decision.
 */
export function evaluateEligibility(
  components: ScoreComponents,
  finalScore: number,
  candidate: ScoringInput,
  config: EligibilityConfig = DEFAULT_ELIGIBILITY,
  now: Date = new Date()
): EligibilityResult {
  const reasons: DecisionReason[] = [];
  let decision: ScoringDecision | null = null;

  // ── Rule 1: Evidence expired? → DEFER ─────────────────────────────────
  if (candidate.expiresAt && candidate.expiresAt.getTime() <= now.getTime()) {
    reasons.push({
      rule: "EVIDENCE_EXPIRED",
      details: `Opportunity expired at ${candidate.expiresAt.toISOString()}`,
    });
    if (!decision) decision = "DEFER";
  }

  // ── Rule 2: Evidence score below minimum? → DEFER ─────────────────────
  if (components.evidenceScore < config.minEvidenceScore) {
    reasons.push({
      rule: "INSUFFICIENT_EVIDENCE",
      details: `Evidence score ${components.evidenceScore} < minimum ${config.minEvidenceScore}`,
    });
    if (!decision) decision = "DEFER";
  }

  // ── Rule 3: Risk score above maximum? → REJECT ────────────────────────
  if (components.riskScore > config.maxRiskScore) {
    reasons.push({
      rule: "EXCESSIVE_RISK",
      details: `Risk score ${components.riskScore} > maximum ${config.maxRiskScore}`,
    });
    if (!decision) decision = "REJECT";
  }

  // ── Rule 4: Final score meets threshold? → PROMOTE ────────────────────
  if (finalScore >= config.promotionThreshold) {
    reasons.push({
      rule: "SCORE_THRESHOLD_MET",
      details: `Final score ${finalScore} >= threshold ${config.promotionThreshold}`,
    });
    if (!decision) decision = "PROMOTE";
  }

  // ── Rule 5: Default → DEFER ───────────────────────────────────────────
  if (!decision) {
    reasons.push({
      rule: "BELOW_THRESHOLD",
      details: `Final score ${finalScore} < threshold ${config.promotionThreshold}`,
    });
    decision = "DEFER";
  }

  return { decision, reasons };
}
