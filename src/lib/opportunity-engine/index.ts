import { fetchGscEvidence } from "./evidence";
import { detectRawOpportunities } from "./detector";
import { consolidateOpportunities } from "./deduplicator";
import { buildOpportunityIntelligence } from "./serp-intelligence";
import { rankGrowthDecisions } from "./decision-ranker";
import { savePersistedDecisions } from "@/lib/growth/decision-persistence";
import { acquireSyncLock, releaseSyncLock } from "@/lib/growth/decision-lock";
import { logger } from "@/lib/logger";

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

        // 4. Intent Intelligence Stage (bounded, real SERP evidence when available)
        const intelligenceMap = await buildOpportunityIntelligence(consolidated);
        const serpStatuses = [...intelligenceMap.values()].reduce<Record<string, number>>(
            (counts, intel) => {
                const status = intel.serpEvidenceStatus ?? "UNAVAILABLE";
                counts[status] = (counts[status] ?? 0) + 1;
                return counts;
            },
            {},
        );
        logger.info("[DecisionPipeline] SERP evidence coverage", {
            siteId,
            keywords: intelligenceMap.size,
            statuses: serpStatuses,
        });

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

