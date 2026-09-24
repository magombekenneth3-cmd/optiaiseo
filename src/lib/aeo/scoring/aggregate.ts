/**
 * scoring/aggregate.ts — Aggregate scoring functions.
 *
 * All scoring flows (deep audit, lite audit, layer scores, dimensions)
 * use these functions so the weighting formula is defined exactly once.
 */

import type { AeoCheck, AeoResult } from "../index";
import { IMPACT_WEIGHTS, GRADE_THRESHOLDS, CITATION_PREDICTION_WEIGHTS } from "./weights";
import { scorableChecks, isCheckEarned } from "./normalize";

/**
 * Computes a 0–100 weighted score for a set of checks.
 * Excludes NOT_APPLICABLE and UNKNOWN checks from the denominator.
 *
 * Returns -1 if there are no scorable checks in the set (so callers can
 * distinguish "no data" from "0% passed").
 */
export function computeWeightedScore(checks: AeoCheck[]): number {
    const eligible = scorableChecks(checks);
    if (eligible.length === 0) return -1;

    const total = eligible.reduce((sum, c) => sum + IMPACT_WEIGHTS[c.impact], 0);
    const earned = eligible
        .filter(isCheckEarned)
        .reduce((sum, c) => sum + IMPACT_WEIGHTS[c.impact], 0);

    return Math.round((earned / total) * 100);
}

/**
 * Computes a 0–100 weighted score for a subset of checks filtered by category.
 * Thin wrapper around computeWeightedScore for category-specific scoring.
 */
export function computeLayerScore(
    checks: AeoCheck[],
    categories: AeoCheck["category"][]
): number {
    return computeWeightedScore(
        checks.filter((c) => categories.includes(c.category))
    );
}

/**
 * Maps a 0–100 score to a letter grade using the defined thresholds.
 */
export function scoreToGrade(score: number): AeoResult["grade"] {
    for (const { min, grade } of GRADE_THRESHOLDS) {
        if (score >= min) return grade;
    }
    return "F";
}

/**
 * Predicts how likely AI engines are to cite this page based on which
 * high-signal checks passed.
 *
 * Uses a fixed set of check-ID-specific weights (not the generic impact weights)
 * because citation prediction is about the *type* of signal, not its severity.
 */
export function predictCitationLikelihood(checks: AeoCheck[]): number {
    let earned = 0;
    let total = 0;

    for (const check of checks) {
        const weight = CITATION_PREDICTION_WEIGHTS[check.id];
        if (weight) {
            total += weight;
            if (check.passed) earned += weight;
        }
    }

    return Math.round((earned / (total || 1)) * 100);
}

/**
 * Extracts the top N recommendations from failed checks, prioritizing
 * one recommendation from each layer (AEO → GEO → AIO) before filling
 * the remaining slots with high-impact failures.
 */
export function buildTopRecommendations(
    checks: AeoCheck[],
    maxCount = 5
): string[] {
    const pickTopFail = (categories: AeoCheck["category"][]): string | null =>
        checks.find(
            (c) =>
                categories.includes(c.category) &&
                c.status === "FAIL" &&
                c.impact !== "low"
        )?.recommendation ?? null;

    const aeoRec = pickTopFail(["schema", "eeat", "content", "technical", "citation"]);
    const geoRec = pickTopFail(["geo"]);
    const aioRec = pickTopFail(["aio"]);

    const layerRecs = [aeoRec, geoRec, aioRec].filter(
        (r): r is string => r !== null
    );

    const remaining = checks
        .filter(
            (c) =>
                c.status === "FAIL" &&
                c.impact === "high" &&
                !layerRecs.includes(c.recommendation)
        )
        .map((c) => c.recommendation);

    return [...new Set([...layerRecs, ...remaining])].slice(0, maxCount);
}
