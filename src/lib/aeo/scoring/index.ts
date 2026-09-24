/**
 * scoring/index.ts — Barrel export for the centralized scoring engine.
 *
 * Usage:
 *   import { computeWeightedScore, scoreToGrade, computeDimensions } from "@/lib/aeo/scoring";
 */

// Weights & config
export { IMPACT_WEIGHTS, GRADE_THRESHOLDS, CITATION_PREDICTION_WEIGHTS, DIMENSION_CATEGORIES, LAYER_CATEGORIES } from "./weights";

// Normalization
export { normalizeChecks, scorableChecks, isCheckEarned } from "./normalize";

// Aggregate scoring
export { computeWeightedScore, computeLayerScore, scoreToGrade, predictCitationLikelihood, buildTopRecommendations } from "./aggregate";

// Dimension scoring
export { computeDimensions, dimensionWeaknesses } from "./dimensions";

// Confidence
export { computeAuditConfidence, confidenceLabel, isConfidenceSufficientForAlerts } from "./confidence";

// Methodology
export { METHODOLOGY_VERSION, getScoringMethodology } from "./methodology";
export type { ScoringMethodology } from "./methodology";
