/**
 * Phase D.2 — Deterministic Score Calculator
 *
 * Computes score components and final weighted score.
 * All scoring is deterministic — same inputs produce same outputs.
 * No LLM, no external calls.
 *
 * finalScore =
 *     impactScore      * IMPACT_WEIGHT
 *   + confidenceScore  * CONFIDENCE_WEIGHT
 *   + evidenceScore    * EVIDENCE_WEIGHT
 *   + urgencyScore     * URGENCY_WEIGHT
 *   - effortScore      * EFFORT_WEIGHT
 *   - riskScore        * RISK_WEIGHT
 *
 * All component scores: 0–100
 * Final score: 0–100 (clamped)
 */

import type {
  ScoreComponents,
  ScoringWeights,
  ScoringInput,
} from "./types";
import { DEFAULT_WEIGHTS } from "./types";
import { FRESHNESS_POLICIES } from "@/lib/discovery/freshness";
import type { LearnedSignalMap } from "@/lib/learning/signal-registry";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Action Effort Estimates ─────────────────────────────────────────────────

const ACTION_EFFORT: Record<string, number> = {
  OPTIMIZE_TITLE:          20,  // Low effort
  BUILD_INTERNAL_LINKS:    30,
  IMPROVE_SEARCH_INTENT:   50,
  REFRESH_CONTENT:         60,
  OPTIMIZE_CONTENT_DEPTH:  65,
  CONSOLIDATE_CONTENT:     75,
  CREATE_NEW_CONTENT:      85,
  DEINDEX_OR_REDIRECT:     25,
  MONITOR:                 10,
};

// ── Action Risk Estimates ───────────────────────────────────────────────────

const ACTION_RISK: Record<string, number> = {
  OPTIMIZE_TITLE:          15,  // Low risk — easily reversible
  BUILD_INTERNAL_LINKS:    10,
  IMPROVE_SEARCH_INTENT:   30,
  REFRESH_CONTENT:         25,
  OPTIMIZE_CONTENT_DEPTH:  20,
  CONSOLIDATE_CONTENT:     55,  // Higher risk — content deletion
  CREATE_NEW_CONTENT:      20,
  DEINDEX_OR_REDIRECT:     70,  // High risk — removes from index
  MONITOR:                  5,
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Computes all score components for a candidate.
 *
 * @param signals — Optional D.6 learned signals. When provided, risk and
 *                  confidence scores receive additive adjustments from ACTIVE
 *                  signals. When omitted, behavior is identical to pre-D.6.
 */
export function computeScoreComponents(
  input: ScoringInput,
  signals?: LearnedSignalMap
): ScoreComponents {
  return {
    impactScore: clamp(computeImpactScore(input)),
    confidenceScore: clamp(computeConfidenceScore(input, signals)),
    evidenceScore: clamp(computeEvidenceScore(input)),
    urgencyScore: clamp(computeUrgencyScore(input)),
    effortScore: clamp(computeEffortScore(input)),
    riskScore: clamp(computeRiskScore(input, signals)),
  };
}

/**
 * Calculates the final weighted score from components.
 * Result is clamped to 0–100.
 */
export function calculateFinalScore(
  components: ScoreComponents,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): number {
  const raw =
    components.impactScore      * weights.impact
    + components.confidenceScore  * weights.confidence
    + components.evidenceScore    * weights.evidence
    + components.urgencyScore     * weights.urgency
    - components.effortScore      * weights.effort
    - components.riskScore        * weights.risk;

  return clamp(raw);
}

// ── Component Scoring Functions ─────────────────────────────────────────────

/**
 * Impact: Expected SEO upside.
 * Based on: category strategic value, existing position, traffic indicators.
 *
 * DOES NOT use discoveryConfidence — that's D.1.
 */
function computeImpactScore(input: ScoringInput): number {
  let score = 40; // Base

  // Category-based impact
  const categoryImpact: Record<string, number> = {
    DECLINING: 30,       // High impact — recovering traffic
    CANNIBALIZATION: 25, // High — resolves structural issue
    QUICK_WIN: 20,       // Good — low-hanging fruit
    ALMOST_RANKING: 15,  // Moderate — page-2 opportunity
    ORPHANED: 10,        // Moderate — structural fix
    STALE: 10,           // Moderate — freshness
    DEAD_WEIGHT: 5,      // Low — cleanup
  };

  score += categoryImpact[input.category] ?? 0;

  // Boost from traffic data in metadata
  const impressions = Number(input.metadata?.impressions) || 0;
  if (impressions >= 1000) score += 20;
  else if (impressions >= 500) score += 15;
  else if (impressions >= 100) score += 10;
  else if (impressions >= 30) score += 5;

  // Position-based opportunity
  const position = Number(input.metadata?.position) || 0;
  if (position > 0 && position <= 20) {
    // Striking distance — higher impact
    score += Math.max(0, 20 - position);
  }

  return score;
}

/**
 * Confidence: How confident are we that acting will produce the predicted benefit?
 *
 * NOT discoveryConfidence (that's "does the condition exist?").
 * This is "if we act, will we get the expected result?"
 *
 * D.6: If a CONFIDENCE_ADJUSTMENT signal exists for this action type,
 * it is applied as an additive adjustment (positive or negative).
 */
function computeConfidenceScore(input: ScoringInput, signals?: LearnedSignalMap): number {
  let score = 30; // Base

  // Multi-source evidence increases confidence
  const uniqueSources = new Set(input.evidenceItems.map((e) => e.sourceType));
  if (uniqueSources.size >= 3) score += 25;
  else if (uniqueSources.size >= 2) score += 15;

  // More evidence items = more confidence
  if (input.evidenceItems.length >= 5) score += 20;
  else if (input.evidenceItems.length >= 3) score += 10;

  // If D.1 discovery confidence is high, that supports (but doesn't replace) D.2 confidence
  if (input.discoveryConfidence !== null) {
    score += Math.round(input.discoveryConfidence * 15); // Up to 15 bonus
  }

  // Quantitative metrics boost confidence
  const hasQuantitative = input.evidenceItems.some(
    (e) => e.metric && ["position", "impressions", "clicks", "ctr"].includes(e.metric)
  );
  if (hasQuantitative) score += 10;

  // D.6: Apply learned confidence adjustment
  const confSignal = signals?.get(`CONFIDENCE_ADJUSTMENT:${input.action}`);
  if (confSignal) {
    score += confSignal.adjustment;
  }

  return score;
}

/**
 * Evidence: Quality, quantity, and freshness of evidence.
 */
function computeEvidenceScore(input: ScoringInput): number {
  if (input.evidenceItems.length === 0) return 0;

  let score = 20; // Base

  // Quantity
  if (input.evidenceItems.length >= 5) score += 25;
  else if (input.evidenceItems.length >= 3) score += 15;
  else if (input.evidenceItems.length >= 1) score += 5;

  // Freshness — how recent is the most recent evidence?
  const now = Date.now();
  const ages = input.evidenceItems.map((e) => (now - e.observedAt.getTime()) / MS_PER_DAY);
  const newestAge = Math.min(...ages);

  if (newestAge <= 1) score += 25;        // < 1 day: very fresh
  else if (newestAge <= 3) score += 20;
  else if (newestAge <= 7) score += 15;
  else if (newestAge <= 14) score += 10;
  else if (newestAge <= 30) score += 5;

  // Source diversity
  const sources = new Set(input.evidenceItems.map((e) => e.sourceType));
  score += Math.min(sources.size * 5, 20);

  // Penalize if opportunity is about to expire
  if (input.expiresAt) {
    const daysToExpiry = (input.expiresAt.getTime() - now) / MS_PER_DAY;
    if (daysToExpiry <= 2) score -= 15;
    else if (daysToExpiry <= 5) score -= 10;
  }

  return score;
}

/**
 * Urgency: Time sensitivity.
 */
function computeUrgencyScore(input: ScoringInput): number {
  let score = 30; // Base

  // Declining traffic = urgent
  if (input.category === "DECLINING") score += 30;
  else if (input.category === "CANNIBALIZATION") score += 20;

  // Near expiry = urgent
  if (input.expiresAt) {
    const daysToExpiry = (input.expiresAt.getTime() - Date.now()) / MS_PER_DAY;
    if (daysToExpiry <= 3) score += 25;
    else if (daysToExpiry <= 7) score += 15;
    else if (daysToExpiry <= 14) score += 10;
  }

  // Position drop evidence = urgent
  const hasDrop = input.evidenceItems.some((e) =>
    e.metric === "previousPosition" && e.value
  );
  if (hasDrop) score += 10;

  return score;
}

/**
 * Effort: Expected implementation cost.
 */
function computeEffortScore(input: ScoringInput): number {
  return ACTION_EFFORT[input.action] ?? 50;
}

/**
 * Risk: Downside / uncertainty.
 *
 * D.6: If a RISK_ADJUSTMENT signal exists for this action type,
 * it is applied as an additive adjustment (positive increases risk,
 * negative decreases risk).
 */
function computeRiskScore(input: ScoringInput, signals?: LearnedSignalMap): number {
  let score = ACTION_RISK[input.action] ?? 30;

  // Higher traffic pages = higher risk (more to lose)
  const impressions = Number(input.metadata?.impressions) || 0;
  if (impressions >= 5000) score += 15;
  else if (impressions >= 1000) score += 10;

  // Low evidence = higher risk
  if (input.evidenceItems.length <= 1) score += 15;

  // D.6: Apply learned risk adjustment
  const riskSignal = signals?.get(`RISK_ADJUSTMENT:${input.action}`);
  if (riskSignal) {
    score += riskSignal.adjustment;
  }

  return score;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number = 0, max: number = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
