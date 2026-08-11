import { describe, it, expect } from "vitest";
import { calculateSampleWeightedConfidence, InterventionEvidence } from "@/lib/growth/empirical-calibration";

describe("Sample-Weighted Empirical Calibration Unit Tests (Gate 3)", () => {
    it("should fall back to baseline heuristic when N < 5 (NONE tier)", () => {
        const evidence: InterventionEvidence = {
            actionType: "REFRESH_CONTENT",
            siteId: "site-1",
            attempts: 3,
            successes: 3,
            failures: 0,
            inconclusive: 0,
            medianTrafficDeltaPct: 25,
            medianRankingDelta: 2.0,
            medianTimeToEffectDays: 14,
            confidenceInterval95: [10, 40],
            lastObservedAt: new Date().toISOString()
        };

        const res = calculateSampleWeightedConfidence(88, evidence);

        expect(res.evidenceTier).toEqual("NONE");
        expect(res.evidenceWeight).toEqual(0.10);
        // Blended: 88 * 0.9 + 100 * 0.1 = 89
        expect(res.calibratedConfidence).toEqual(89);
    });

    it("should grant full evidence weight when N >= 50 (STRONG tier)", () => {
        const evidence: InterventionEvidence = {
            actionType: "BUILD_INTERNAL_LINKS",
            siteId: "site-1",
            attempts: 60,
            successes: 54, // 90% win rate
            failures: 6,
            inconclusive: 0,
            medianTrafficDeltaPct: 30,
            medianRankingDelta: 3.5,
            medianTimeToEffectDays: 10,
            confidenceInterval95: [20, 45],
            lastObservedAt: new Date().toISOString()
        };

        const res = calculateSampleWeightedConfidence(75, evidence);

        expect(res.evidenceTier).toEqual("STRONG");
        expect(res.evidenceWeight).toEqual(1.00);
        expect(res.winRate).toEqual(0.90);
        expect(res.calibratedConfidence).toEqual(90); // 90% empirical confidence fully replaces baseline
    });
});
