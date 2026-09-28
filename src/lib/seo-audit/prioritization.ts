/**
 * src/lib/seo-audit/prioritization.ts
 *
 * Unified Prioritization Policy v4.
 *
 * Replaces the three competing priority models:
 *   1. computePriority() in types.ts  (impact × ease × confidence)
 *   2. SCORING_WEIGHTS in engine.ts   (ROI 60% + AI Visibility 40%)
 *   3. computeRecommendationPriority() in recommendations.ts
 *
 * Every finding carries an ExplainablePriority so the dashboard can answer:
 *   "Why is this #1?"
 *
 * Pure functions — no DB calls, no side effects.
 */

import type { RemediationType } from "./diagnostic-types";

// ── Policy Version ──────────────────────────────────────────────────────────

export const PRIORITIZATION_POLICY_VERSION = "priority-v4";

// ── Components ──────────────────────────────────────────────────────────────

export interface PriorityComponents {
  /** Business value at stake (traffic × conversion rate × revenue) */
  businessImpact: number;      // 0–1
  /** Search-signal criticality (indexability blocker > content gap) */
  searchImpact: number;        // 0–1
  /** Fraction of affected URLs relative to total crawlable pages */
  affectedScope: number;       // 0–1
  /** Evidence-backed confidence this is a real issue */
  confidence: number;          // 0–1
  /** Likelihood of a successful fix (deterministic=1, AI=0.8, manual=0.5) */
  fixability: number;          // 0–1
  /** Number of independent evidence sources corroborating the finding */
  evidenceStrength: number;    // 0–1
  /** Recency of the evidence (newer = higher) */
  recency: number;             // 0–1
}

export interface ExplainablePriority {
  policyVersion: typeof PRIORITIZATION_POLICY_VERSION;
  score: number;               // 0–100
  components: PriorityComponents;
}

// ── Weights ─────────────────────────────────────────────────────────────────

const WEIGHTS: Record<keyof PriorityComponents, number> = {
  businessImpact:   0.25,
  searchImpact:     0.20,
  affectedScope:    0.15,
  confidence:       0.15,
  fixability:       0.10,
  evidenceStrength: 0.10,
  recency:          0.05,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

/**
 * Map a RemediationType to a fixability score.
 * Deterministic fixes always work. AI patches usually work.
 * Manual actions and experiments are uncertain.
 */
export function fixabilityForRemediation(remediationType: RemediationType): number {
  switch (remediationType) {
    case "DETERMINISTIC": return 1.0;
    case "AI_PATCH":      return 0.8;
    case "EXPERIMENT":    return 0.65;
    case "MANUAL":        return 0.5;
    default:              return 0.5;
  }
}

/**
 * Map evidence age to a recency score.
 * Evidence < 1 day old = 1.0, > 30 days = 0.3.
 */
export function recencyScore(observedAt: Date | string): number {
  const ageMs = Date.now() - new Date(observedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays <= 1) return 1.0;
  if (ageDays <= 7) return 0.9;
  if (ageDays <= 14) return 0.75;
  if (ageDays <= 30) return 0.5;
  return 0.3;
}

/**
 * Map affected URL count to a scope score.
 * 1 URL = 0.2, ≥100 URLs = 1.0.
 */
export function scopeScore(affectedUrls: number, totalPages: number): number {
  if (totalPages <= 0) return 0.5;
  const ratio = Math.min(1, affectedUrls / totalPages);
  // Minimum 0.2 even for a single page — a homepage canonical issue is still critical.
  return Math.max(0.2, ratio);
}

// ── Core ────────────────────────────────────────────────────────────────────

/**
 * Compute a transparent, explainable priority score.
 *
 * Every component is clamped to [0, 1] and weighted.
 * The final score is an integer 0–100.
 */
export function computePriorityV4(input: PriorityComponents): ExplainablePriority {
  const components: PriorityComponents = {
    businessImpact:   clamp(input.businessImpact),
    searchImpact:     clamp(input.searchImpact),
    affectedScope:    clamp(input.affectedScope),
    confidence:       clamp(input.confidence),
    fixability:       clamp(input.fixability),
    evidenceStrength: clamp(input.evidenceStrength),
    recency:          clamp(input.recency),
  };

  let score = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    score += components[key as keyof PriorityComponents] * weight;
  }

  return {
    policyVersion: PRIORITIZATION_POLICY_VERSION,
    score: Math.round(score * 100),
    components,
  };
}

// ── Legacy Bridge ───────────────────────────────────────────────────────────

/**
 * Backward-compatible wrapper: maps the old (impact, ease, confidence) signature
 * to the v4 priority model.
 *
 * Call sites that use the old `computePriority(issue)` can switch to this
 * without changing their data shapes.
 */
export function computePriorityLegacy(
  estimatedTrafficImpact: number,  // 1–10
  fixDifficulty: number,           // 1–10 (1 = easy)
  confidence: number,              // 0–1
): number {
  return computePriorityV4({
    businessImpact:   clamp(estimatedTrafficImpact / 10),
    searchImpact:     clamp(estimatedTrafficImpact / 10),
    affectedScope:    0.5,         // unknown scope → middle
    confidence:       clamp(confidence),
    fixability:       clamp(1 - fixDifficulty / 10),
    evidenceStrength: 0.5,         // no evidence source info in legacy
    recency:          0.8,         // assume recent
  }).score;
}
