import { fetchGscEvidence } from "./evidence";
import { detectRawOpportunities } from "./detector";
import { consolidateOpportunities } from "./deduplicator";
import { analyzeSerpConsensus } from "@/lib/intelligence/intent-profiler";
import { rankGrowthDecisions } from "./decision-ranker";
import { savePersistedDecisions } from "@/lib/growth/decision-persistence";
import { acquireSyncLock, releaseSyncLock } from "@/lib/growth/decision-lock";
import { GrowthDecision, OpportunityIntelligence, ConsolidatedOpportunity } from "./types";
import { logger } from "@/lib/logger";

/**
 * Fetches live SERP data for a batch of opportunities with concurrency limits.
 * Returns a Map of keyword → SerpContext-compatible object for analyzeSerpConsensus.
 *
 * FIX (PR #36): Previously this always passed `null` to analyzeSerpConsensus,
 * which meant intent alignment and commercial value were heuristic defaults.
 */
async function fetchSerpIntelligence(
    consolidated: ConsolidatedOpportunity[],
): Promise<Map<string, OpportunityIntelligence>> {
    const intelligenceMap = new Map<string, OpportunityIntelligence>();

    // Check if SERP API is available
    if (!process.env.SERPER_API_KEY) {
        logger.warn("[DecisionPipeline] SERPER_API_KEY not set — using heuristic-only intent analysis (no live SERP data)");
        for (const opp of consolidated) {
            intelligenceMap.set(opp.keyword, analyzeSerpConsensus(opp.keyword, null));
        }
        return intelligenceMap;
    }

    // Lazy-import to avoid loading SERP module when key is missing
    const { fetchGoogleSerp } = await import("@/lib/blog/serp");

    // Process in batches with concurrency=3 to respect Serper rate limits
    const BATCH_SIZE = 3;
    const keywords = consolidated.map(opp => opp.keyword);
    // Deduplicate keywords to avoid redundant API calls
    const uniqueKeywords = [...new Set(keywords)];

    for (let i = 0; i < uniqueKeywords.length; i += BATCH_SIZE) {
        const batch = uniqueKeywords.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
            batch.map(async (keyword) => {
                try {
                    const { organic } = await fetchGoogleSerp(keyword, 7);
                    // Build a minimal SerpContext-compatible object for analyzeSerpConsensus
                    const serpContext = organic.length > 0
                        ? {
                            keyword,
                            results: organic,
                            peopleAlsoAsk: [] as { question: string; answer?: string }[],
                            featuredSnippet: null,
                            relatedSearches: [] as string[],
                            formattedContext: "",
                            opportunityAnalysis: {
                                opportunities: [],
                                tableStakes: [],
                                unansweredQuestions: [],
                            } satisfies import("@/lib/blog/seo-opportunity").SeoOpportunityAnalysis,
                        }
                        : null;
                    return { keyword, intel: analyzeSerpConsensus(keyword, serpContext) };
                } catch (err: unknown) {
                    logger.warn("[DecisionPipeline] SERP fetch failed for keyword, falling back to heuristic", {
                        keyword,
                        error: (err as Error)?.message || String(err),
                    });
                    return { keyword, intel: analyzeSerpConsensus(keyword, null) };
                }
            })
        );

        for (const result of results) {
            if (result.status === "fulfilled") {
                intelligenceMap.set(result.value.keyword, result.value.intel);
            }
        }
    }

    // Fill any remaining keywords that weren't in uniqueKeywords (shouldn't happen, but safety)
    for (const opp of consolidated) {
        if (!intelligenceMap.has(opp.keyword)) {
            intelligenceMap.set(opp.keyword, analyzeSerpConsensus(opp.keyword, null));
        }
    }

    logger.info("[DecisionPipeline] SERP intelligence fetched", {
        total: uniqueKeywords.length,
        withSerpData: [...intelligenceMap.values()].filter(i => i.serpConsensus).length,
        heuristicOnly: [...intelligenceMap.values()].filter(i => !i.serpConsensus).length,
    });

    return intelligenceMap;
}

export async function runGrowthDecisionPipeline(siteId: string): Promise<{ success: boolean; count: number; status?: string }> {
    const locked = await acquireSyncLock(siteId);
    if (!locked) {
        logger.info("[DecisionPipeline] Sync job skipped — already running for site", { siteId });
        return { success: true, count: 0, status: "ALREADY_RUNNING" };
    }

    try {
        logger.info("[DecisionPipeline] Starting growth decision pipeline", { siteId });

        // 1. Evidence Stage (Fetch Real GSC Metrics)
        const gscMetrics = await fetchGscEvidence(siteId);

        // 2. Detection Stage (Extract Raw Opportunities)
        const rawSignals = await detectRawOpportunities(siteId, gscMetrics);

        // 3. Deduplication Stage (Merge per Canonical URL)
        const consolidated = consolidateOpportunities(rawSignals);

        // 4. Intent Intelligence Stage (Analyze SERP Consensus per Keyword)
        // FIX (PR #36): Now fetches live SERP data instead of always passing null
        const intelligenceMap = await fetchSerpIntelligence(consolidated);

        // 5. Ranking Stage (Weighted Bounded 0-100 Scoring & Action Mapping)
        const decisions = rankGrowthDecisions(siteId, consolidated, intelligenceMap);

        // 6. Persistence Stage (Prisma DB + Redis Cache)
        await savePersistedDecisions(siteId, decisions);

        logger.info("[DecisionPipeline] Completed growth decision pipeline", { siteId, count: decisions.length });
        return { success: true, count: decisions.length, status: "COMPLETED" };
    } catch (err: unknown) {
        logger.error("[DecisionPipeline] Pipeline execution failed", { siteId, error: (err as Error)?.message || String(err) });
        return { success: false, count: 0, status: "FAILED" };
    } finally {
        await releaseSyncLock(siteId);
    }
}

export { generateOpportunitiesFromFindings } from "./findings-to-opportunities";

