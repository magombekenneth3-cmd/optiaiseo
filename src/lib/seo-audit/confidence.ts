import { prisma } from "@/lib/prisma";

export type ConfidenceLabel = "High confidence" | "Medium confidence" | "Low confidence" | "Estimated";

export interface RecommendationConfidence {
    label: ConfidenceLabel;
    rate: number;        
    sampleSize: number;
    description: string;
}

/**
 * Returns confidence data for a given issueType + optional niche.
 * Falls back to estimated 0.7 if fewer than 5 outcomes exist.
 */
export async function getRecommendationConfidence(
    issueType: string,
    siteNiche?: string | null
): Promise<RecommendationConfidence> {
    const outcomes = await prisma.healingOutcome.findMany({
        where: {
            issueType,
            measuredAt: { not: null },
            outcome: { not: null },
            ...(siteNiche
                ? { site: { niche: siteNiche } }
                : {}),
        },
        select: { outcome: true },
        take: 200,
    });

    if (outcomes.length < 5) {
        return {
            label: "Estimated",
            rate: 0.7,
            sampleSize: outcomes.length,
            description: "Estimated 70% success rate (fewer than 5 measured outcomes for this fix type)",
        };
    }

    const improved = outcomes.filter(o => o.outcome === "improved").length;
    const rate = improved / outcomes.length;

    let label: ConfidenceLabel;
    let description: string;
    if (rate >= 0.8) {
        label = "High confidence";
        description = `${Math.round(rate * 100)}% success rate across ${outcomes.length} similar sites — strong evidence this fix works`;
    } else if (rate >= 0.6) {
        label = "Medium confidence";
        description = `${Math.round(rate * 100)}% success rate across ${outcomes.length} sites — likely to improve rankings`;
    } else {
        label = "Low confidence";
        description = `${Math.round(rate * 100)}% success rate across ${outcomes.length} sites — results vary significantly`;
    }

    return { label, rate, sampleSize: outcomes.length, description };
}

/**
 * Inject per-issue-type success rates into a recommendation string.
 * Called by Aria's tool orchestration when delivering issue recommendations.
 */
export async function annotateWithConfidence(
    issueType: string,
    niche?: string | null
): Promise<string> {
    const { label, description } = await getRecommendationConfidence(issueType, niche);
    return `[${label}] ${description}`;
}
