import { describe, it, expect, vi } from "vitest";

// Mock external dependencies that require DB/API access
vi.mock("@/lib/opportunity-engine/evidence", () => ({
    fetchGscEvidence: vi.fn().mockResolvedValue([
        { url: "/blog/best-aeo-software", position: 8.2, impressions: 1200, clicks: 45 },
    ]),
}));

vi.mock("@/lib/seo-audit/llm-citation-probe", () => ({
    probeLlmCitation: vi.fn().mockResolvedValue({
        score: 4,
        geminiScore: 5,
        perplexityScore: 2,
        chatGptScore: 3,
    }),
}));

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
    });

    it("should return GSC metrics when URL matches", async () => {
        const report = await getCombinedAeoSeoOverview(
            "site-123",
            "best aeo software",
            "/blog/best-aeo-software"
        );

        expect(report.googleRank).toBe(8.2);
        expect(report.impressions).toBe(1200);
        expect(report.clicks).toBe(45);
    });

    it("should compute consensus score from LLM probe results", async () => {
        const report = await getCombinedAeoSeoOverview(
            "site-123",
            "best aeo software",
            "/blog/best-aeo-software"
        );

        // geminiScore=5 (>=3 → cited), perplexityScore=2 (<3 → not cited),
        // chatGptScore=3 (>=3 → cited), score=4 (claude >=3 → cited)
        // 3 out of 4 cited = 75%
        expect(report.aeoConsensusScore).toBe(75);
        expect(report.aiVisibility.geminiCited).toBe(true);
        expect(report.aiVisibility.perplexityCited).toBe(false);
        expect(report.aiVisibility.chatgptCited).toBe(true);
        expect(report.aiVisibility.claudeCited).toBe(true);
    });
});
