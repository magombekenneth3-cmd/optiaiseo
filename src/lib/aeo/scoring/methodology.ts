/**
 * scoring/methodology.ts — Self-documenting scoring methodology.
 *
 * Returns a machine-readable description of how the AEO score was computed.
 * This serves two purposes:
 *
 * 1. **Transparency** — Users can understand why their score changed.
 *    The methodology object can be serialized into an "About this score"
 *    modal or exported as part of the API response.
 *
 * 2. **Reproducibility** — If the scoring formula changes, old snapshots
 *    record which version of the methodology was used, so historical
 *    comparisons remain honest.
 */

import { IMPACT_WEIGHTS, GRADE_THRESHOLDS, CITATION_PREDICTION_WEIGHTS, DIMENSION_CATEGORIES, LAYER_CATEGORIES } from "./weights";

/** Current methodology version. Bump when scoring logic changes materially. */
export const METHODOLOGY_VERSION = "2.0.0";

export interface ScoringMethodology {
    version: string;
    description: string;
    impactWeights: Record<string, number>;
    gradeThresholds: { min: number; grade: string }[];
    citationPredictionWeights: Record<string, number>;
    dimensionCategories: Record<string, string[]>;
    layerCategories: Record<string, string[]>;
    scoringNotes: string[];
}

/**
 * Returns the full scoring methodology as a serializable object.
 * Include this in API responses and audit reports for full transparency.
 */
export function getScoringMethodology(): ScoringMethodology {
    return {
        version: METHODOLOGY_VERSION,
        description: [
            "AEO scores are computed using weighted check results.",
            "Each check has an impact level (high=15, medium=8, low=4).",
            "NOT_APPLICABLE and UNKNOWN checks are excluded from the scoring denominator.",
            "PASS and PARTIAL checks earn their full weight; FAIL checks earn 0.",
            "The final score is (earned_weight / total_weight) × 100, rounded.",
        ].join(" "),
        impactWeights: { ...IMPACT_WEIGHTS },
        gradeThresholds: GRADE_THRESHOLDS.map((t) => ({ ...t })),
        citationPredictionWeights: { ...CITATION_PREDICTION_WEIGHTS },
        dimensionCategories: Object.fromEntries(
            Object.entries(DIMENSION_CATEGORIES).map(([k, v]) => [k, [...v]])
        ),
        layerCategories: Object.fromEntries(
            Object.entries(LAYER_CATEGORIES).map(([k, v]) => [k, [...v]])
        ),
        scoringNotes: [
            "aiVisibility is derived from Generative Share of Voice (GSoV), not from checks.",
            "Citation prediction uses a separate set of check-specific weights.",
            "Provider failures return null/UNKNOWN — they never count as 0/FAIL.",
            "Confidence level reflects the fraction of providers that responded successfully.",
        ],
    };
}
