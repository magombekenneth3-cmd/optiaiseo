import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type ConfidenceLabel = "High confidence" | "Medium confidence" | "Low confidence" | "Estimated";

export interface RecommendationConfidence {
    label: ConfidenceLabel;
    rate: number;
    sampleSize: number;
    description: string;
    /** Breakdown of outcome sources feeding this confidence score */
    sources: {
        healingOutcomes: number;
        diagnosticVerifications: number;
    };
}

/**
 * Returns confidence data for a given issueType + optional niche.
 *
 * Blends two outcome sources:
 *   1. HealingOutcome records (legacy pipeline) — equal weight
 *   2. DiagnosticFindingRecord T+28 evidence (evidence-driven pipeline) — 1.2× weight
 *      because diagnostic outcomes carry richer multi-window verification evidence.
 *
 * Falls back to estimated 0.7 if fewer than 5 total outcomes exist.
 */
export async function getRecommendationConfidence(
    issueType: string,
    siteNiche?: string | null
): Promise<RecommendationConfidence> {
    // ── Source 1: Legacy HealingOutcome pipeline ──────────────────────────
    const healingOutcomes = await prisma.healingOutcome.findMany({
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

    // ── Source 2: T+28 diagnostic verification evidence ──────────────────
    let diagnosticOutcomes: { outcome: string }[] = [];
    try {
        const findings = await prisma.diagnosticFindingRecord.findMany({
            where: {
                issueType,
                status: { in: ["PASS", "FAIL"] },
                resolvedAt: { not: null },
                ...(siteNiche
                    ? { site: { niche: siteNiche } }
                    : {}),
            },
            select: { id: true, status: true },
            take: 200,
        });

        // Enrich with T+28 evidence records to get actual outcome
        for (const finding of findings) {
            const evidence = await prisma.sEOEvidenceRecord.findFirst({
                where: {
                    findingId: finding.id,
                    observedValue: {
                        path: ["verificationType"],
                        equals: "T28_BUSINESS",
                    },
                },
                select: { observedValue: true },
                orderBy: { observedAt: "desc" },
            });

            const observed = evidence?.observedValue as Record<string, unknown> | null;
            if (observed?.outcome) {
                diagnosticOutcomes.push({ outcome: observed.outcome as string });
            } else {
                diagnosticOutcomes.push({
                    outcome: finding.status === "PASS" ? "improved" : "degraded",
                });
            }
        }
    } catch (err) {
        logger.debug("[Confidence] Diagnostic findings query failed (table may not exist):", {
            error: (err as Error)?.message,
        });
    }

    const totalHealingSamples = healingOutcomes.length;
    const totalDiagnosticSamples = diagnosticOutcomes.length;
    const totalSamples = totalHealingSamples + totalDiagnosticSamples;

    if (totalSamples < 5) {
        return {
            label: "Estimated",
            rate: 0.7,
            sampleSize: totalSamples,
            description: "Estimated 70% success rate (fewer than 5 measured outcomes for this fix type)",
            sources: {
                healingOutcomes: totalHealingSamples,
                diagnosticVerifications: totalDiagnosticSamples,
            },
        };
    }

    // Weighted blending: diagnostic outcomes get 1.2× weight because they
    // carry richer multi-window verification evidence (T+0, T+7, T+28).
    const DIAGNOSTIC_WEIGHT = 1.2;
    const healingImproved = healingOutcomes.filter(o => o.outcome === "improved").length;
    const diagnosticImproved = diagnosticOutcomes.filter(o => o.outcome === "improved").length;

    const weightedImproved = healingImproved + (diagnosticImproved * DIAGNOSTIC_WEIGHT);
    const weightedTotal = totalHealingSamples + (totalDiagnosticSamples * DIAGNOSTIC_WEIGHT);
    const rate = weightedTotal > 0 ? weightedImproved / weightedTotal : 0;

    let label: ConfidenceLabel;
    let description: string;
    const pct = Math.round(rate * 100);
    const sourceNote = totalDiagnosticSamples > 0
        ? ` (${totalHealingSamples} healing + ${totalDiagnosticSamples} diagnostic outcomes)`
        : "";

    if (rate >= 0.8) {
        label = "High confidence";
        description = `${pct}% success rate across ${totalSamples} outcomes${sourceNote} — strong evidence this fix works`;
    } else if (rate >= 0.6) {
        label = "Medium confidence";
        description = `${pct}% success rate across ${totalSamples} outcomes${sourceNote} — likely to improve rankings`;
    } else {
        label = "Low confidence";
        description = `${pct}% success rate across ${totalSamples} outcomes${sourceNote} — results vary significantly`;
    }

    return {
        label,
        rate,
        sampleSize: totalSamples,
        description,
        sources: {
            healingOutcomes: totalHealingSamples,
            diagnosticVerifications: totalDiagnosticSamples,
        },
    };
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
