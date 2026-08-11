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

    it("should evaluate 28-day experiment lift and compute revenue gains", async () => {
        const exp = await evaluate28DayExperimentLift("exp-dec-101");

        expect(exp).toBeDefined();
        expect(exp.status).toBe("COMPLETED");
        expect(exp.lift).toBeDefined();
        expect(exp.lift?.positionDelta).toBeGreaterThan(0);
        expect(exp.lift?.revenueLiftAmount).toBeGreaterThan(0);
        expect(exp.lift?.clicksLiftPercent).toBeGreaterThan(0);
    });

    it("should calculate aggregated site experiment summary ROI metrics", async () => {
        const summary = await getSiteExperimentSummary("site-123");

        expect(summary).toBeDefined();
        expect(summary.siteId).toBe("site-123");
        expect(summary.totalExperimentsExecuted).toBeGreaterThan(0);
        expect(summary.averagePositionGain).toBeGreaterThan(0);
        expect(summary.totalRevenueGenerated).toBeGreaterThan(0);
    });
});
