import { describe, it, expect } from "vitest";
import { runRankerExperiment } from "@/lib/growth/learning-ranker-experiment";
import { ConsolidatedOpportunity } from "@/lib/opportunity-engine/types";
import { InterventionEvidence } from "@/lib/growth/empirical-calibration";

describe("Dual Static vs. Learning Ranker Experiment Unit Tests (Gate 7)", () => {
    it("should evaluate recommendations from Static vs Learning Rankers on unseen data", () => {
        const siteId = "site-experiment-123";

        const unseenOpps: ConsolidatedOpportunity[] = Array.from({ length: 6 }).map((_, i) => ({
            url: `https://acme.com/page-${i}`,
            keyword: `target keyword ${i}`,
            primaryCategory: "QUICK_WIN",
            categories: ["QUICK_WIN", "STALE"],
            impressions: 2500 + i * 500,
            clicks: 100 + i * 20,
            position: 7.0 + i * 0.5,
            inboundInternalLinksCount: 1,
            signals: [],
        }));

        const evidenceStore = new Map<string, InterventionEvidence>([
            ["REFRESH_CONTENT", {
                actionType: "REFRESH_CONTENT",
                siteId,
                attempts: 55,
                successes: 50,
                failures: 5,
                inconclusive: 0,
                medianTrafficDeltaPct: 35,
                medianRankingDelta: 3.8,
                medianTimeToEffectDays: 12,
                confidenceInterval95: [25, 45],
                lastObservedAt: new Date().toISOString()
            }]
        ]);

        const res = runRankerExperiment(siteId, unseenOpps, evidenceStore);

        expect(res.experimentId).toMatch(/^exp-site-experiment-123-\d+$/);
        expect(res.datasetSize).toEqual(6);
        expect(res.staticDecisions).toHaveLength(6);
        expect(res.learningDecisions).toHaveLength(6);
        expect(res.meanTrafficLiftLearningPct).toBeGreaterThan(res.meanTrafficLiftStaticPct);
        expect(res.effectSize).toBeGreaterThanOrEqual(0.35);
        expect(res.statisticalSignificancePassed).toBe(true);
        expect(res.practicalSignificancePassed).toBe(true);
        expect(res.level6AccreditationGranted).toBe(true);
    });
});
