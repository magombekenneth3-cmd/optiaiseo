/**
 * Phase D.2 — Scoring Types
 *
 * CONFIDENCE SEPARATION:
 *   D.1 discoveryConfidence  = "does the condition exist?"           (0.0–1.0)
 *   D.2 confidenceScore      = "how confident are we that acting     (0–100)
 *                               will produce the predicted benefit?"
 *
 * These are NEVER overloaded onto the same field.
 */

// ── Scoring Version ─────────────────────────────────────────────────────────

export const SCORING_VERSION = "d2-v1";

// ── Weights ─────────────────────────────────────────────────────────────────

export interface ScoringWeights {
  impact: number;
  confidence: number;
  evidence: number;
  urgency: number;
  effort: number;      // Subtracted
  risk: number;        // Subtracted
}

export const DEFAULT_WEIGHTS: Readonly<ScoringWeights> = {
  impact: 0.30,
  confidence: 0.20,
  evidence: 0.15,
  urgency: 0.15,
  effort: 0.10,
  risk: 0.10,
} as const;

// ── Score Components ────────────────────────────────────────────────────────

export interface ScoreComponents {
  impactScore: number;       // 0–100: expected SEO upside
  confidenceScore: number;   // 0–100: confidence action produces benefit
  evidenceScore: number;     // 0–100: quality/quantity/freshness
  urgencyScore: number;      // 0–100: time sensitivity
  effortScore: number;       // 0–100: implementation cost
  riskScore: number;         // 0–100: downside / uncertainty
}

// ── Decision ────────────────────────────────────────────────────────────────

export type ScoringDecision = "PROMOTE" | "DEFER" | "REJECT";

export interface DecisionReason {
  rule: string;
  details: string;
}

// ── Scoring Result ──────────────────────────────────────────────────────────

export interface ScoringResult {
  opportunityId: string;
  impactScore: number;
  confidenceScore: number;
  evidenceScore: number;
  urgencyScore: number;
  effortScore: number;
  riskScore: number;
  finalScore: number;
  decision: ScoringDecision;
  decisionReasons: DecisionReason[];
  evidenceHash: string;
  scoringVersion: string;
  scoredAt: Date;
  weightsUsed: ScoringWeights;
}

// ── Eligibility Config ──────────────────────────────────────────────────────

export interface EligibilityConfig {
  minEvidenceScore: number;
  maxRiskScore: number;
  promotionThreshold: number;
}

export const DEFAULT_ELIGIBILITY: Readonly<EligibilityConfig> = {
  minEvidenceScore: 30,
  maxRiskScore: 80,
  promotionThreshold: 50,
} as const;

// ── Scoring Input ───────────────────────────────────────────────────────────

/** Data loaded for scoring a single candidate */
export interface ScoringInput {
  opportunityId: string;
  siteId: string;
  url: string;
  primaryKeyword: string;
  category: string;
  action: string;
  discoveryConfidence: number | null;
  expiresAt: Date | null;
  lastRefreshedAt: Date | null;
  primaryDiscoverySource: string | null;
  evidenceItems: EvidenceItem[];
  existingScore: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export interface EvidenceItem {
  sourceType: string;
  metric?: string;
  value?: string;
  observedAt: Date;
  metadata?: Record<string, unknown>;
}

// ── Promotion Result ────────────────────────────────────────────────────────

export interface PromotionResult {
  promoted: boolean;
  reason?: string;
}
