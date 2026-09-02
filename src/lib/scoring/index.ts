/**
 * Phase D.2 — Scoring Module Barrel Export
 */

// Types
export type {
  ScoringWeights,
  ScoreComponents,
  ScoringDecision,
  DecisionReason,
  ScoringResult,
  EligibilityConfig,
  ScoringInput,
  EvidenceItem,
  PromotionResult,
} from "./types";

export {
  SCORING_VERSION,
  DEFAULT_WEIGHTS,
  DEFAULT_ELIGIBILITY,
} from "./types";

// Score Calculator
export {
  computeScoreComponents,
  calculateFinalScore,
} from "./score-calculator";

// Eligibility
export { evaluateEligibility } from "./eligibility";
export type { EligibilityResult } from "./eligibility";

// Evidence Fencing
export {
  hashScoringEvidence,
  verifyEvidenceBeforePromotion,
} from "./evidence-fencing";

// Promoter
export { promoteCandidateToOpen } from "./promoter";

// Scorer Orchestrator
export { scoreCandidate } from "./scorer";
