import { describe, it, expect } from "vitest";
import { auditCompetitorWeaknesses } from "@/lib/intelligence/competitor-interceptor";

describe("Automated Competitor Steal Engine Unit Tests", () => {
    it("should audit competitor domain vulnerabilities and generate counter-strategy blueprint", async () => {
        const report = await auditCompetitorWeaknesses(
            "site-123",
            "semrush.com",
            "seo tools"
        );

        expect(report).toBeDefined();
        expect(report.siteId).toBe("site-123");
        expect(report.competitorDomain).toBe("semrush.com");
        expect(report.targetKeyword).toBe("seo tools");
        expect(report.overallStealabilityScore).toBeGreaterThanOrEqual(0);
        expect(report.overallStealabilityScore).toBeLessThanOrEqual(100);
        expect(report.vulnerabilities.length).toBeGreaterThan(0);
        expect(report.recommendedCounterArticleTitle).toContain("2026");
        expect(report.actionableBlueprint.length).toBeGreaterThan(0);
    });
});
