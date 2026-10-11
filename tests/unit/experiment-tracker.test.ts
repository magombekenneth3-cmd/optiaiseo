import { describe, it, expect } from "vitest";
import {
    recordExperimentBaseline,
    evaluate28DayExperimentLift,
    getSiteExperimentSummary
} from "@/lib/experiments/tracker";

describe("28-Day Automated ROI & Revenue Lift Prover Unit Tests", () => {
    it("should lock in T0 baseline metrics for an executed decision", async () => {
        const exp = await recordExperimentBaseline(
            "dec-101",
            "site-123",
            "/blog/seo-guide",
            "IMPROVE_SEARCH_INTENT"
        );

        expect(exp).toBeDefined();
        expect(exp.decisionId).toBe("dec-101");
        expect(exp.siteId).toBe("site-123");
        expect(exp.targetUrl).toBe("/blog/seo-guide");
        expect(exp.status).toBe("RECORDED");
        expect(exp.baseline.position).toBeGreaterThan(0);
        expect(exp.baseline.clicks).toBeGreaterThan(0);
    });

    // Phase 5 (BUG-5C): a seed/synthetic baseline with no real GSC post-data
    // must NOT be turned into a fabricated WIN. Previously this test asserted
    // invented +position/+revenue lift, which corrupted calibration win rates.
    it("does not fabricate lift for a synthetic seed baseline (INSUFFICIENT_DATA)", async () => {
        const exp = await evaluate28DayExperimentLift("exp-dec-101");

        expect(exp).toBeDefined();
        expect(exp.status).toBe("INSUFFICIENT_DATA");
        expect(exp.lift).toBeFalsy();
    });

    it("site summary counts the experiment but reports no synthetic ROI", async () => {
        const summary = await getSiteExperimentSummary("site-123");

        expect(summary).toBeDefined();
        expect(summary.siteId).toBe("site-123");
        expect(summary.totalExperimentsExecuted).toBeGreaterThan(0);
        // Only COMPLETED experiments with real lift contribute to ROI.
        expect(summary.completedExperiments).toBe(0);
        expect(summary.averagePositionGain).toBe(0);
        expect(summary.totalRevenueGenerated).toBe(0);
    });
});
