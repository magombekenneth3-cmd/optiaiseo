// =============================================================================
// Competitor detection engine — ranker
// Scores, ranks, and deduplicates competitor candidates.
//
// v2: replaces the old freq×1/√pos formula with a 4-axis weighted score
//     that incorporates similarity, intent, and AI confidence.
// =============================================================================

import type { Competitor, DetectedService, SerperSearchResult, SimilarityResult, VerificationVerdict } from "./types";

// Scoring constants

/** Weights for the final score formula */
const W = {
    serp:       0.30,
    similarity: 0.40,
    intent:     0.20,
    confidence: 0.10,
} as const;

/**
 * Minimum final score for a candidate to survive.
 * Below this threshold the candidate is discarded regardless of SERP rank.
 * Set intentionally conservative — a score of 0.35 means the site has at
 * least moderate similarity + reasonable SERP presence.
 */
export const SCORE_THRESHOLD = 0.35;

// SERP scorer (used internally, and exported for tests)

/**
 * Raw SERP score: frequency × 1/√bestPosition
 * Normalised to 0–1 against an assumed maximum frequency of 8 (6 queries × some bonus).
 */
export function computeSerpScore(frequency: number, bestPosition: number): number {
    const raw = frequency * (1 / Math.sqrt(Math.max(bestPosition, 1)));
    // Normalise: max theoretical score ≈ 8 × 1/√1 = 8
    return Math.min(raw / 8, 1);
}

// Final weighted score

/**
 * Computes the final composite score for a candidate.
 *
 *   finalScore =
 *     (serpScore    × 0.30) +
 *     (similarity   × 0.40) +   ← strongest signal
 *     (intentScore  × 0.20) +   ← type penalty (direct/indirect/content/platform)
 *     (confidence   × 0.10)     ← AI verification confidence
 *
 * @param serpScore   normalised SERP presence (0–1)
 * @param similarity  computeSimilarity().overall (0–1)
 * @param intentScore typePenalty(competitorType) (0–1)
 * @param confidence  AI verification confidence (0–1), defaults to 0.5 when unverified
 */
export function computeFinalScore(
    serpScore:   number,
    similarity:  number,
    intentScore: number,
    confidence:  number = 0.5,
): number {
    return (
        Math.min(serpScore,   1) * W.serp       +
        Math.min(similarity,  1) * W.similarity  +
        Math.min(intentScore, 1) * W.intent      +
        Math.min(confidence,  1) * W.confidence
    );
}

// Primary ranker

/**
 * Ranks competitor candidates.
 *
 * If similarityMap is provided (keyed by domain), uses the full weighted
 * formula. Otherwise falls back to the legacy SERP-only score so the function
 * is safe to call without the similarity engine.
 */
export function rankCompetitors(
    result:        SerperSearchResult,
    service:       DetectedService,
    limit:         number,
    minFrequency = 1.5,
    similarityMap?: Map<string, SimilarityResult>,
    verificationMap?: Map<string, VerificationVerdict>,
): Competitor[] {
    const candidates = Array.from(result.domainFrequency.entries());

    // Adaptive threshold: if nothing passes, relax to 1.0
    const effectiveMin =
        candidates.some(([, freq]) => freq >= minFrequency)
            ? minFrequency
            : 1.0;

    return candidates
        .filter(([, freq]) => freq >= effectiveMin)
        .map(([domain, frequency]) => {
            const bestPosition = result.domainBestPosition.get(domain) ?? 10;
            const serpScore    = computeSerpScore(frequency, bestPosition);

            // Get similarity data if available
            const sim         = similarityMap?.get(domain);
            const verdict      = verificationMap?.get(domain);
            const similarity   = sim?.overall   ?? 0.5;  // neutral when unavailable
            const intentScore  = sim ? typePenaltyFromType(sim.competitorType) : 0.5;
            const confidence   = verdict?.confidence ?? 0.5;
            const competitorType = sim?.competitorType ?? verdict?.type as Competitor["competitorType"];
            const reason       = verdict?.reason;

            const finalScore = computeFinalScore(serpScore, similarity, intentScore, confidence);

            return {
                domain,
                service,
                score:         finalScore,
                serpScore,
                bestPosition,
                frequency,
                similarityScore: similarity,
                competitorType,
                confidence,
                reason,
                scoreBreakdown: {
                    serp:       +(serpScore    * W.serp       ).toFixed(3),
                    similarity: +(similarity   * W.similarity ).toFixed(3),
                    intent:     +(intentScore  * W.intent     ).toFixed(3),
                    confidence: +(confidence   * W.confidence ).toFixed(3),
                },
            } satisfies Competitor;
        })
        .filter(c => c.score >= SCORE_THRESHOLD)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

// Fallback ranker (no similarity data)

/**
 * Used when primary queries return zero results.
 * Relaxed threshold, legacy scoring — safety net only.
 */
export function rankCompetitorsFallback(
    result:  SerperSearchResult,
    service: DetectedService,
    limit:   number,
): Competitor[] {
    return Array.from(result.domainFrequency.entries())
        .map(([domain, frequency]) => {
            const bestPosition = result.domainBestPosition.get(domain) ?? 10;
            const serpScore    = computeSerpScore(frequency, bestPosition);
            return {
                domain,
                service,
                score:       serpScore,
                serpScore,
                bestPosition,
                frequency,
            } satisfies Competitor;
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

// Deduplication

/**
 * Deduplicates across multiple services.
 * When the same domain appears for multiple services, keeps the highest-scoring entry.
 */
export function deduplicateCompetitors(competitors: Competitor[]): Competitor[] {
    const best = new Map<string, Competitor>();
    for (const c of competitors) {
        const existing = best.get(c.domain);
        if (!existing || c.score > existing.score) {
            best.set(c.domain, c);
        }
    }
    return Array.from(best.values()).sort((a, b) => b.score - a.score);
}

// Helpers

function typePenaltyFromType(type: SimilarityResult["competitorType"]): number {
    const MAP: Record<SimilarityResult["competitorType"], number> = {
        direct:   1.0,
        indirect: 0.65,
        content:  0.15,
        platform: 0.20,
    };
    return MAP[type] ?? 0.5;
}
