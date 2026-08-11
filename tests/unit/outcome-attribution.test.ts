import { describe, it, expect } from "vitest";
import { attributeFixOutcome } from "@/lib/growth/outcome-attribution";

describe("Outcome Attribution Engine Unit Tests (Gate 6)", () => {
    const decisionId = "dec-123";
    const siteId = "site-456";
    const baselineWindow = { start: "2026-06-01", end: "2026-07-01" };
    const observationWindow = { start: "2026-07-01", end: "2026-08-01" };

    it("should classify a clean traffic/rank gain as WIN with high attribution confidence", () => {
        const baseline = { clicks: 200, impressions: 4000, position: 8.0, conversions: 5 };
        const observed = { clicks: 300, impressions: 5500, position: 4.5, conversions: 12 };

        const res = attributeFixOutcome(
            decisionId, siteId, "REFRESH_CONTENT", baseline, observed, baselineWindow, observationWindow
        );

        expect(res.outcome).toEqual("WIN");
        expect(res.attributionConfidence).toBeGreaterThanOrEqual(0.70);
        expect(res.rawRankingDelta).toEqual(3.5); // #8 -> #4.5 = +3.5
        expect(res.attributedTrafficDeltaPct).toEqual(50); // +50% click lift
    });

    it("should penalize attribution confidence and tag INCONCLUSIVE during active Google Core updates", () => {
        const baseline = { clicks: 200, impressions: 4000, position: 8.0, conversions: 5 };
        const observed = { clicks: 280, impressions: 5000, position: 5.0, conversions: 10 };

        const res = attributeFixOutcome(
            decisionId, siteId, "REFRESH_CONTENT", baseline, observed, baselineWindow, observationWindow,
            { googleAlgUpdateActive: true }
        );

        expect(res.attributionConfidence).toBeLessThan(0.60);
        expect(res.outcome).toEqual("INCONCLUSIVE");
    });

    it("should deduct control group traffic delta from attributed net traffic lift", () => {
        const baseline = { clicks: 100, impressions: 2000, position: 10.0, conversions: 2 };
        const observed = { clicks: 140, impressions: 2500, position: 7.0, conversions: 4 };

        const res = attributeFixOutcome(
            decisionId, siteId, "BUILD_INTERNAL_LINKS", baseline, observed, baselineWindow, observationWindow,
            { controlGroupTrafficDeltaPct: 25 } // control group gained 25% organically
        );

        expect(res.rawTrafficDeltaPct).toEqual(40);
        expect(res.attributedTrafficDeltaPct).toEqual(15); // 40% - 25% = 15%
    });
});
