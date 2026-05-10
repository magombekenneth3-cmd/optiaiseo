/**
 * AI Visibility Forecasting
 * ─────────────────────────────────────────────────────────────────────────────
 * Analyses a site's AEO trajectory and produces a 90-day forecast of its
 * AI citation rate. Uses AeoSnapshot history, AiShareOfVoice data, brand fact
 * completeness, and Gemini reasoning to project where the site will be.
 *
 * This is the metric that connects your tool's work to business outcomes users
 * actually care about — not just "your score went up" but "in 90 days you will
 * appear in X% of Perplexity answers for your core keywords."
 */

import { prisma } from "@/lib/prisma";
import { callGemini } from "@/lib/gemini/client";
import { logger } from "@/lib/logger";

export interface VisibilityForecast {
    /** % of AI answers where brand currently appears (from AiShareOfVoice data) */
    currentCitationRate: number;
    /** Projected citation rate if current trajectory continues for 90 days */
    projected90DayCitationRate: number;
    /** Score trajectory: "improving" | "stable" | "declining" */
    trend: "improving" | "stable" | "declining";
    /** The biggest single reason a top competitor is cited more */
    topCompetitorAdvantage: string;
    /** Specific actions ranked by expected citation impact */
    keyActionsToImprove: string[];
    /** Gemini's full reasoning narrative */
    forecastReasoning: string;
    /** Data freshness */
    generatedAt: string;
    /** Number of weeks of AEO history used in the forecast */
    historyWeeksUsed: number;
    /** Gap 4: true when fewer than 4 weeks of snapshots — UI should show confidence caveat */
    dataSparse: boolean;
    /** Gap 4: OLS regression R² over snapshot score series (0.0–1.0); low = high noise */
    trendConfidence: number;
}


// Replaces the 3-snapshot average delta with proper OLS slope estimation over
// up to 24 weeks, weighted by recency (oldest = 0.5, most recent = 1.0).
// Returns slope (score units/week) and R² as a confidence signal.
function weightedLinearTrend(scores: number[]): { slope: number; r2: number } {
    const n = scores.length;
    if (n < 3) return { slope: 0, r2: 0 };

    const weights = scores.map((_, i) => 0.5 + 0.5 * (i / (n - 1)));
    const xs      = scores.map((_, i) => i);

    const wSum = weights.reduce((a, b) => a + b, 0);
    const xBar = xs.reduce((a, x, i)      => a + weights[i] * x, 0)         / wSum;
    const yBar = scores.reduce((a, y, i)  => a + weights[i] * y, 0)         / wSum;
    const num  = xs.reduce((a, x, i)      => a + weights[i] * (x - xBar) * (scores[i] - yBar), 0);
    const den  = xs.reduce((a, x, i)      => a + weights[i] * (x - xBar) ** 2, 0);
    const slope = den === 0 ? 0 : num / den;

    const ssRes = scores.reduce((a, y, i) =>
        a + weights[i] * (y - (yBar + slope * (xs[i] - xBar))) ** 2, 0);
    const ssTot = scores.reduce((a, y, i) =>
        a + weights[i] * (y - yBar) ** 2, 0);
    const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);

    return { slope, r2 };
}

export async function generateVisibilityForecast(siteId: string): Promise<VisibilityForecast> {

    const generatedAt = new Date().toISOString();

    try {
        const [site, aeoSnapshots, shareOfVoice, brandFacts, latestAudit, competitors] =
            await Promise.all([
                prisma.site.findUnique({
                    where: { id: siteId },
                    select: {
                        domain: true,
                        coreServices: true,
                        location: true,
                    },
                }),
                prisma.aeoSnapshot.findMany({
                    where: { siteId },
                    orderBy: { createdAt: "desc" },
                    take: 24, // Gap 4: 24 weekly snapshots = 6 months for reliable OLS regression
                    select: {
                        score: true,
                        citationScore: true,
                        perplexityScore: true,
                        chatgptScore: true,
                        claudeScore: true,
                        googleAioScore: true,
                        grokScore: true,
                        generativeShareOfVoice: true,
                        createdAt: true,
                    },
                }),
                prisma.aiShareOfVoice.findMany({
                    where: { siteId },
                    orderBy: { recordedAt: "desc" },
                    take: 50,
                    select: {
                        keyword: true,
                        modelName: true,
                        brandMentioned: true,
                        competitorsMentioned: true,
                        recordedAt: true,
                    },
                }),
                prisma.brandFact.findMany({
                    where: { siteId },
                    select: { factType: true, verified: true },
                }),
                prisma.audit.findFirst({
                    where: { siteId },
                    orderBy: { runTimestamp: "desc" },
                    select: { categoryScores: true },
                }),
                prisma.competitor.findMany({
                    where: { siteId },
                    take: 5,
                    select: { domain: true },
                }),
            ]);

        if (!site) {
            return buildEmptyForecast("Site not found", generatedAt);
        }

        const citationRate = shareOfVoice.length > 0
            ? Math.round(
                (shareOfVoice.filter((r) => r.brandMentioned).length / shareOfVoice.length) * 100
              )
            : aeoSnapshots[0]?.generativeShareOfVoice ?? 0;

        // Gap 4: slope > 1.5/week = improving; < -1.5/week = declining.
        // Snapshots are DESC from DB — reverse for chronological order.
        let trend: "improving" | "stable" | "declining" = "stable";
        let trendConfidence = 0;
        const dataSparse = aeoSnapshots.length < 4;

        if (aeoSnapshots.length >= 3) {
            const chronoScores = [...aeoSnapshots].reverse().map(s => s.score);
            const { slope, r2 } = weightedLinearTrend(chronoScores);
            trendConfidence = Math.round(r2 * 100) / 100;
            if (slope > 1.5)  trend = "improving";
            else if (slope < -1.5) trend = "declining";
        }

        const verifiedFacts = brandFacts.filter((f) => f.verified).length;
        const totalFacts = brandFacts.length;
        const factCompleteness = totalFacts > 0 ? Math.round((verifiedFacts / totalFacts) * 100) : 0;

        let schemaScore: number | null = null;
        if (latestAudit?.categoryScores) {
            try {
                const scores = latestAudit.categoryScores as Record<string, number>;
                schemaScore = scores.schema ?? scores.technical ?? null;
            } catch {
                // ignore
            }
        }

        const competitorMentions: Record<string, number> = {};
        for (const record of shareOfVoice) {
            for (const comp of record.competitorsMentioned) {
                competitorMentions[comp] = (competitorMentions[comp] ?? 0) + 1;
            }
        }
        const topCompetitor = Object.entries(competitorMentions)
            .sort(([, a], [, b]) => b - a)[0];

        // Gap 4: pass all 24 snapshots for richer context
        const snapshotSummary = aeoSnapshots
            .map((s, i) => `Week -${i + 1}: AEO ${s.score}/100, Citation Rate ${s.generativeShareOfVoice}%, Perplexity ${s.perplexityScore}/100`)
            .join("\n");

        const prompt = `You are an AI search visibility analyst. Based on the data below, generate a precise 90-day AI citation forecast for this site.

SITE: ${site.domain}
SERVICES: ${site.coreServices ?? "not specified"}
LOCATION: ${site.location ?? "not specified"}

CURRENT STATUS:
- Current citation rate: ${citationRate}% (brand appears in ${citationRate}% of tracked AI answers)
- AEO score trend: ${trend} (${aeoSnapshots.length} weeks of data, trend confidence R²=${trendConfidence.toFixed(2)})
- Data sparse: ${dataSparse ? "YES — fewer than 4 weeks; use conservative projection" : "NO"}
- Brand fact completeness: ${factCompleteness}% (${verifiedFacts}/${totalFacts} verified)
- Schema score: ${schemaScore !== null ? `${schemaScore}/100` : "not available"}
- Known competitors: ${competitors.map((c) => c.domain).join(", ") || "none tracked"}
- Top competitor cited instead of this site: ${topCompetitor ? `${topCompetitor[0]} (cited ${topCompetitor[1]}x in tracked queries)` : "none identified yet"}

HISTORICAL AEO SNAPSHOT TREND (most recent first, up to 24 weeks):
${snapshotSummary || "No historical data yet — this is a first run"}

AI SHARE OF VOICE (last 50 tracked queries):
- Brand cited: ${shareOfVoice.filter((r) => r.brandMentioned).length} times
- Brand not cited: ${shareOfVoice.filter((r) => !r.brandMentioned).length} times
- Models checked: ${[...new Set(shareOfVoice.map((r) => r.modelName))].join(", ") || "none"}

Produce a JSON response with exactly this structure:
{
  "projected90DayCitationRate": <number 0-100>,
  "topCompetitorAdvantage": "<one specific, actionable reason why the top competitor is cited more — or 'No clear competitor advantage identified' if unknown>",
  "keyActionsToImprove": ["<action 1>", "<action 2>", "<action 3>"],
  "forecastReasoning": "<2-3 sentence narrative explaining the projection, referencing specific data points>"
}

Rules:
- Be specific and data-driven — reference actual numbers from the data above
- Projection must account for the ${trend} trend
- Actions must be ranked by expected citation impact, most impactful first
- If data is sparse, say so in the reasoning and give a conservative projection`;

        const rawResponse = await callGemini(prompt, {
            model: "gemini-2.5-flash",
            maxOutputTokens: 1024,
            temperature: 0.2,
            responseFormat: "json",
        });

        // Parse Gemini response
        type GeminiForecastResponse = {
            projected90DayCitationRate: number;
            topCompetitorAdvantage: string;
            keyActionsToImprove: string[];
            forecastReasoning: string;
        };

        let parsed: GeminiForecastResponse;
        try {
            const clean = rawResponse.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
            parsed = JSON.parse(clean) as GeminiForecastResponse;
        } catch {
            logger.warn("[VisibilityForecast] Failed to parse Gemini response — using defaults", { siteId });
            parsed = {
                projected90DayCitationRate: citationRate,
                topCompetitorAdvantage: topCompetitor
                    ? `${topCompetitor[0]} was cited ${topCompetitor[1]}x more than your domain in tracked queries`
                    : "No competitor data available yet — run more AEO checks to identify gaps",
                keyActionsToImprove: [
                    "Add FAQ schema to your top 5 pages",
                    "Increase brand fact completeness to 100%",
                    "Publish content targeting your top 10 seed keywords",
                ],
                forecastReasoning: "Insufficient data for a precise forecast. Run weekly AEO audits to build the historical trend needed for accurate projections.",
            };
        }

        return {
            currentCitationRate: citationRate,
            projected90DayCitationRate: Math.min(100, Math.max(0, Math.round(parsed.projected90DayCitationRate))),
            trend,
            topCompetitorAdvantage: parsed.topCompetitorAdvantage,
            keyActionsToImprove: (parsed.keyActionsToImprove ?? []).slice(0, 5),
            forecastReasoning: parsed.forecastReasoning,
            generatedAt,
            historyWeeksUsed: aeoSnapshots.length,
            // Gap 4: expose data quality signals to the UI
            dataSparse,
            trendConfidence,
        };

    } catch (err: unknown) {
        logger.error("[VisibilityForecast] Failed", {
            siteId,
            error: (err as Error)?.message ?? String(err),
        });
        return buildEmptyForecast((err as Error)?.message ?? "Unknown error", generatedAt);
    }
}


function buildEmptyForecast(reason: string, generatedAt: string): VisibilityForecast {
    return {
        currentCitationRate: 0,
        projected90DayCitationRate: 0,
        trend: "stable",
        topCompetitorAdvantage: reason,
        keyActionsToImprove: [
            "Run your first AEO audit to collect baseline data",
            "Add FAQ schema to your homepage",
            "Set up weekly AEO tracking",
        ],
        forecastReasoning: `Could not generate forecast: ${reason}. Run at least 1 AEO audit to start collecting data.`,
        generatedAt,
        historyWeeksUsed: 0,
        dataSparse:       true,
        trendConfidence:  0,
    };
}
