/**
 * scoring/dimensions.ts — 4-dimensional AEO score decomposition.
 *
 * Breaks the single 0–100 AEO score into four observable dimensions:
 *   1. technicalReadiness  — schema + technical + E-E-A-T checks
 *   2. contentReadiness    — content quality checks
 *   3. aiVisibility        — observed multi-model mention rate (GSoV)
 *   4. citationQuality     — citation + GEO + AIO checks
 *
 * This decomposition makes it possible to diagnose *why* a score is low
 * ("great content but no schema" vs "good schema but thin content").
 */

import type { AeoCheck, AeoDimensions } from "../index";
import type { MentionResult } from "../multi-model";
import { computeLayerScore } from "./aggregate";
import { DIMENSION_CATEGORIES } from "./weights";

/**
 * Computes the 4 dimension scores from normalized checks and model results.
 *
 * @param checks        - Normalized AeoCheck[] (status field populated)
 * @param gsov          - Generative Share of Voice (0–100) from multi-model audit
 */
export function computeDimensions(
    checks: AeoCheck[],
    gsov: number
): AeoDimensions {
    return {
        technicalReadiness: computeLayerScore(checks, DIMENSION_CATEGORIES.technicalReadiness),
        contentReadiness: computeLayerScore(checks, DIMENSION_CATEGORIES.contentReadiness),
        aiVisibility: gsov,
        citationQuality: computeLayerScore(checks, DIMENSION_CATEGORIES.citationQuality),
    };
}

/**
 * Returns a simple human-readable summary of which dimensions need work.
 * Useful for top-level recommendations and email alerts.
 */
export function dimensionWeaknesses(dims: AeoDimensions, threshold = 50): string[] {
    const weaknesses: string[] = [];

    if (dims.technicalReadiness >= 0 && dims.technicalReadiness < threshold) {
        weaknesses.push("Technical readiness is low — add Organization schema, author markup, and structured data.");
    }
    if (dims.contentReadiness >= 0 && dims.contentReadiness < threshold) {
        weaknesses.push("Content readiness is low — add definitions, statistics, entity-dense paragraphs, and micro-answers.");
    }
    if (dims.aiVisibility < threshold) {
        weaknesses.push("AI visibility is low — your brand is not being mentioned by major AI engines.");
    }
    if (dims.citationQuality >= 0 && dims.citationQuality < threshold) {
        weaknesses.push("Citation quality is low — improve FAQ schema, GEO signals, and AI Overview eligibility.");
    }

    return weaknesses;
}
