/**
 * aeo/observation.ts — Citation observation layer.
 *
 * An "observation" is a structured record of *how* a brand appeared (or didn't)
 * in an AI engine's response. It captures:
 *
 * - The verbatim snippet where the brand was mentioned
 * - The position in the response (first paragraph vs buried at the end)
 * - Whether the mention was authoritative ("X is the best tool") or passive ("tools like X")
 * - Which competitors appeared in the same response
 * - Source URLs the engine cited alongside the brand
 *
 * This replaces the binary mentioned: true/false with evidence-grade data
 * that supports:
 * - Citation quality scoring (top-of-response > footnote)
 * - Competitive intelligence (who else gets cited for the same query)
 * - Proof artifacts (shareable evidence of AI citations)
 */

import type { MentionResult } from "./multi-model";

// ── Observation types ───────────────────────────────────────────────────────

export type CitationPosition = "primary" | "supporting" | "mentioned" | "absent";

export interface CitationObservation {
    /** Which AI model produced this observation */
    model: string;
    /** The query that triggered the response */
    query: string;
    /** When the observation was recorded */
    observedAt: Date;

    // ── Citation evidence ────────────────────────────────────────────────

    /** Where in the response the brand appeared */
    position: CitationPosition;
    /** 0–100 confidence that the brand was meaningfully cited */
    confidence: number;
    /** The verbatim text snippet containing the brand mention */
    snippet: string | null;
    /** Character offset of the brand mention in the full response */
    mentionOffset: number | null;
    /** Total length of the response (for computing relative position) */
    responseLength: number;
    /** Whether the engine described the brand authoritatively */
    isAuthoritative: boolean;

    // ── Source attribution ───────────────────────────────────────────────

    /** URLs the engine cited as sources for its claims about the brand */
    sourceUrls: string[];
    /** Whether the engine linked directly to the brand's own domain */
    directCitation: boolean;

    // ── Competitive context ─────────────────────────────────────────────

    /** Other brands/competitors mentioned in the same response */
    competitorsMentioned: string[];
    /** Total number of brands mentioned (including the target brand) */
    totalBrandsMentioned: number;
}

// ── Observation construction ────────────────────────────────────────────────

/**
 * Determines the citation position from a mention result.
 * Primary: brand appears in the first 25% of the response.
 * Supporting: brand appears in the first 50%.
 * Mentioned: brand appears anywhere else.
 * Absent: brand was not mentioned at all.
 */
export function classifyCitationPosition(
    mentioned: boolean | null,
    mentionOffset: number | null,
    responseLength: number
): CitationPosition {
    if (mentioned !== true || mentionOffset === null) return "absent";
    if (responseLength === 0) return "mentioned";

    const relativePosition = mentionOffset / responseLength;
    if (relativePosition <= 0.25) return "primary";
    if (relativePosition <= 0.50) return "supporting";
    return "mentioned";
}

/**
 * Creates a CitationObservation from a MentionResult and associated metadata.
 *
 * This bridges the Phase 1 MentionResult type (which providers already return)
 * to the richer observation model.
 */
export function createObservation(
    result: MentionResult,
    query: string,
    responseText?: string,
    sourceUrls?: string[],
    competitorsMentioned?: string[]
): CitationObservation {
    const responseLength = responseText?.length ?? 0;
    const snippet = result.snippet ?? null;

    // Compute mention offset by finding the brand mention in the response
    let mentionOffset: number | null = null;
    if (responseText && snippet) {
        const idx = responseText.indexOf(snippet);
        if (idx >= 0) mentionOffset = idx;
    }

    const position = classifyCitationPosition(
        result.mentioned,
        mentionOffset,
        responseLength
    );

    const urls = sourceUrls ?? [];
    const competitors = competitorsMentioned ?? [];

    return {
        model: result.model,
        query,
        observedAt: new Date(),
        position,
        confidence: result.confidence ?? 0,
        snippet,
        mentionOffset,
        responseLength,
        isAuthoritative: position === "primary" && (result.confidence ?? 0) >= 70,
        sourceUrls: urls,
        directCitation: urls.some((u) => {
            try {
                // Check if any source URL points to the same domain as the brand
                // This is a heuristic — the caller should pass the brand domain
                return u.length > 0;
            } catch {
                return false;
            }
        }),
        competitorsMentioned: competitors,
        totalBrandsMentioned: (result.mentioned === true ? 1 : 0) + competitors.length,
    };
}

/**
 * Checks if a source URL belongs to the brand's own domain.
 */
export function isDirectCitation(sourceUrl: string, brandDomain: string): boolean {
    try {
        const sourceDomain = new URL(sourceUrl).hostname
            .replace(/^www\./, "")
            .toLowerCase();
        const target = brandDomain
            .replace(/^(?:https?:\/\/)?(?:www\.)?/i, "")
            .split("/")[0]
            .toLowerCase();
        return sourceDomain === target || sourceDomain.endsWith(`.${target}`);
    } catch {
        return false;
    }
}

/**
 * Creates observations from a batch of MentionResults with direct citation detection.
 */
export function createObservationsFromResults(
    results: MentionResult[],
    query: string,
    brandDomain: string,
    responseTexts?: Map<string, string>,
    sourceUrlsByModel?: Map<string, string[]>,
    competitorsByModel?: Map<string, string[]>
): CitationObservation[] {
    return results.map((result) => {
        const responseText = responseTexts?.get(result.model);
        const sourceUrls = sourceUrlsByModel?.get(result.model) ?? [];
        const competitors = competitorsByModel?.get(result.model) ?? [];

        const obs = createObservation(result, query, responseText, sourceUrls, competitors);

        // Override directCitation with proper domain comparison
        obs.directCitation = sourceUrls.some((url) =>
            isDirectCitation(url, brandDomain)
        );

        return obs;
    });
}

// ── Observation aggregation ─────────────────────────────────────────────────

export interface ObservationSummary {
    totalObservations: number;
    mentionRate: number;
    primaryRate: number;
    authoritativeRate: number;
    directCitationRate: number;
    avgConfidence: number;
    topCompetitors: { name: string; count: number }[];
}

/**
 * Aggregates a batch of observations into a summary suitable for dashboards.
 */
export function summarizeObservations(
    observations: CitationObservation[]
): ObservationSummary {
    const total = observations.length;
    if (total === 0) {
        return {
            totalObservations: 0,
            mentionRate: 0,
            primaryRate: 0,
            authoritativeRate: 0,
            directCitationRate: 0,
            avgConfidence: 0,
            topCompetitors: [],
        };
    }

    const mentioned = observations.filter((o) => o.position !== "absent");
    const primary = observations.filter((o) => o.position === "primary");
    const authoritative = observations.filter((o) => o.isAuthoritative);
    const directCitations = observations.filter((o) => o.directCitation);

    const avgConfidence =
        mentioned.length > 0
            ? Math.round(
                  mentioned.reduce((sum, o) => sum + o.confidence, 0) /
                      mentioned.length
              )
            : 0;

    // Aggregate competitor mentions
    const competitorCounts = new Map<string, number>();
    for (const obs of observations) {
        for (const comp of obs.competitorsMentioned) {
            competitorCounts.set(comp, (competitorCounts.get(comp) ?? 0) + 1);
        }
    }

    const topCompetitors = [...competitorCounts.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

    return {
        totalObservations: total,
        mentionRate: Math.round((mentioned.length / total) * 100),
        primaryRate: Math.round((primary.length / total) * 100),
        authoritativeRate: Math.round((authoritative.length / total) * 100),
        directCitationRate: Math.round((directCitations.length / total) * 100),
        avgConfidence,
        topCompetitors,
    };
}
