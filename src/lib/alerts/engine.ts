import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { compareWithCompetitors } from "@/lib/aeo/competitor-compare";
export interface PredictiveAlert {
    id: string;
    type: "SNIPPET_LOSS" | "COMPETITOR_JUMP" | "RANKING_DROP" | "AEO_CITATION_LOSS" | "KG_PROPAGATION";
    severity: "CRITICAL" | "HIGH" | "MEDIUM";
    title: string;
    description: string;
    impact: string;
    action: string;
    createdAt: Date;
}

/**
 * Analyzes recent data to generate predictive alerts.
 */
export async function generatePredictiveAlerts(siteId: string): Promise<PredictiveAlert[]> {
    const alerts: PredictiveAlert[] = [];

    // 1. Check for Ranking Drops / Competitor Jumps
    const recentSnapshots = await prisma.rankSnapshot.findMany({
        where: { siteId },
        orderBy: { recordedAt: 'desc' },
        take: 100
    });

    // Group by keyword to compare latest vs previous

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kwMap = new Map<string, any[]>();
    recentSnapshots.forEach(snap => {
        const existing = kwMap.get(snap.keyword) ?? [];
        existing.push(snap);
        kwMap.set(snap.keyword, existing);
    });

    kwMap.forEach((snaps, keyword) => {
        if (snaps.length < 2) return;
        const [latest, previous] = snaps;

        // Ranking Drop
        if (latest.position > previous.position + 3) {
            alerts.push({
                id: `rank-${latest.id}`,
                type: "RANKING_DROP",
                severity: latest.position <= 10 ? "HIGH" : "MEDIUM",
                title: `Significant Drop for "${keyword}"`,
                description: `Your ranking dropped from #${previous.position} to #${latest.position}.`,
                impact: "Loss of organic visibility and potential traffic decrease.",
                action: "Review page content and check for technical issues or new competitor content.",
                createdAt: new Date()
            });
        }
    });

    // 2. Check for AEO Citation Loss
    const recentAeo = await prisma.aeoReport.findMany({
        where: { siteId },
        orderBy: { createdAt: 'desc' },
        take: 2
    });

    if (recentAeo.length === 2) {
        const [latest, previous] = recentAeo;
        if (latest.citationScore < previous.citationScore - 10) {
            alerts.push({
                id: `aeo-${latest.id}`,
                type: "AEO_CITATION_LOSS",
                severity: "CRITICAL",
                title: "Major Drop in AI Answer Citations",
                description: `Your AI Citation Score dropped from ${previous.citationScore} to ${latest.citationScore}.`,
                impact: "Reduced visibility in ChatGPT/Perplexity/Gemini search results.",
                action: "Check if your site's structure has changed or if LLMS.txt is missing.",
                createdAt: new Date()
            });
        }
    }

    // 3. Competitor AEO Differential Alerts (Real GSoV Checks)
    try {
        const site = await prisma.site.findUnique({
            where: { id: siteId },
            include: { competitors: true }
        });

        if (site && site.competitors.length > 0) {
            // Pick standard keywords or use AI core services
            const targetKeywords = site.coreServices
                ? [site.coreServices]
                : ["best " + site.domain.split('.')[0] + " alternative", "top " + site.domain.split('.')[0] + " reviews"];

            // Compare vs top 2 competitors max to save API costs in cron
            const topCompetitors = site.competitors.slice(0, 2).map(c => c.domain);

            const comparisonResults = await compareWithCompetitors(site.domain, topCompetitors, targetKeywords[0]);

            // Iterate over competitors to check if any have a significantly higher GSoV than us
            for (const comp of comparisonResults.competitors) {
                // If the competitor's GSoV is 30 points higher than ours, trigger alert
                const gapScore = comp.gsov - comparisonResults.own.gsov;

                if (gapScore > 30) {
                    const theirAdvantages = comparisonResults.competitorAdvantages
                        .filter(a => a.competitor === comp.domain)
                        .map(a => a.label);

                    alerts.push({
                        id: `comp-aeo-${siteId}-${Date.now()}-${comp.domain}`,
                        type: "COMPETITOR_JUMP",
                        severity: gapScore > 50 ? "CRITICAL" : "HIGH",
                        title: `AEO Threat: ${comp.domain} Dominating Generative AI`,
                        description: `${comp.domain} has a ${gapScore}% higher Generative Share of Voice (GSoV) across ChatGPT, Claude, and Perplexity.`,
                        impact: "You are losing high-intent AI referral traffic to a direct competitor.",
                        action: `Review the differential report. They are cited for: ${theirAdvantages.slice(0, 2).join(", ") || "various AEO checks"}.`,
                        createdAt: new Date()
                    });
                }
            }

        }

    } catch (e: unknown) {
        logger.error("[Alerts Engine] Failed to run competitor AEO diff:", { error: (e as Error)?.message || String(e) });
    }

    // 4. Check for Knowledge Graph Propagation (Positive Alert)
    const recentFacts = await prisma.brandFact.findMany({
        where: { siteId },
        orderBy: { updatedAt: 'desc' },
        take: 5

    });

    if (recentFacts.length > 0 && recentFacts.some((f) => f.updatedAt > new Date(Date.now() - 24 * 60 * 60 * 1000))) {
        alerts.push({
            id: `kg-${siteId}-${Date.now()}`,
            type: "KG_PROPAGATION",
            severity: "MEDIUM",
            title: "High Authority Propagation Successful",
            description: `Successfully pushed ${recentFacts.length} verified brand facts to the global AI Knowledge Graph feed via Google Indexing API.`,
            impact: "LLMs like Gemini and Perplexity will now have access to your definitive brand data for citations.",
            action: "Continue publishing authoritative content to expand your Knowledge Graph density.",
            createdAt: new Date()
        });
    }

    return alerts;
}
