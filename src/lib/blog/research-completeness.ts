/**
 * Research completeness rule shared by the generation workflow, the
 * publication gate, and the Content Studio UI. Pure — no I/O.
 */
import type { SerpCompetitiveBrief } from "./contracts";

// ─── Research completeness ──────────────────────────────────────────────────

/** Minimum readable ranking pages before competitive research counts as complete. */
export const MIN_ANALYZED_PAGES_FOR_COMPLETE_RESEARCH = 3;

export type ResearchCompletenessStatus = "COMPLETE" | "PARTIAL" | "INCOMPLETE";

export interface ResearchCompleteness {
    status: ResearchCompletenessStatus;
    /** True only when the article may be described as research-backed. */
    researchBacked: boolean;
    analyzedPages: number;
    organicResults: number;
    reasons: string[];
}

export function assessResearchCompleteness(
    brief: SerpCompetitiveBrief | null | undefined,
): ResearchCompleteness {
    if (!brief) {
        return {
            status: "INCOMPLETE",
            researchBacked: false,
            analyzedPages: 0,
            organicResults: 0,
            reasons: ["No SERP competitive research snapshot was produced."],
        };
    }

    const { retrieval } = brief;
    const reasons: string[] = [];

    if (retrieval.status === "UNAVAILABLE" || retrieval.organicResultsReceived === 0) {
        reasons.push(
            "SERP retrieval was unavailable or returned no organic results, so search intent, competitor coverage, and content gaps were not observed.",
        );
        return {
            status: "INCOMPLETE",
            researchBacked: false,
            analyzedPages: retrieval.analyzedPages,
            organicResults: retrieval.organicResultsReceived,
            reasons,
        };
    }

    if (retrieval.analyzedPages < MIN_ANALYZED_PAGES_FOR_COMPLETE_RESEARCH) {
        reasons.push(
            `Only ${retrieval.analyzedPages} ranking page(s) could be analysed (minimum ${MIN_ANALYZED_PAGES_FOR_COMPLETE_RESEARCH}). Competitive gaps are not sufficiently established.`,
        );
        return {
            status: "PARTIAL",
            researchBacked: false,
            analyzedPages: retrieval.analyzedPages,
            organicResults: retrieval.organicResultsReceived,
            reasons,
        };
    }

    if (retrieval.status === "PARTIAL" || retrieval.confidence === "low") {
        reasons.push(`SERP retrieval is ${retrieval.status.toLowerCase()} with ${retrieval.confidence} confidence.`);
        return {
            status: "PARTIAL",
            researchBacked: false,
            analyzedPages: retrieval.analyzedPages,
            organicResults: retrieval.organicResultsReceived,
            reasons,
        };
    }

    return {
        status: "COMPLETE",
        researchBacked: true,
        analyzedPages: retrieval.analyzedPages,
        organicResults: retrieval.organicResultsReceived,
        reasons,
    };
}
