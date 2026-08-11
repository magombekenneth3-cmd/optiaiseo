import { describe, it, expect } from "vitest";
import { getCombinedAeoSeoOverview } from "@/lib/seo-audit/modules/aeo-tracker";

describe("Combined AEO + SEO SERP Overview Widget Unit Tests", () => {
    it("should calculate combined AEO + SEO overview report with consensus score", async () => {
        const report = await getCombinedAeoSeoOverview(
            "site-123",
            "best aeo software",
            "/blog/best-aeo-software"
        );

        expect(report).toBeDefined();
        expect(report.siteId).toBe("site-123");
        expect(report.keyword).toBe("best aeo software");
        expect(report.aeoConsensusScore).toBeGreaterThanOrEqual(0);
        expect(report.aeoConsensusScore).toBeLessThanOrEqual(100);
        expect(report.aiVisibility).toBeDefined();
        expect(report.aeoOpportunityRecommendation).toBeDefined();
    }, 15000);

});
