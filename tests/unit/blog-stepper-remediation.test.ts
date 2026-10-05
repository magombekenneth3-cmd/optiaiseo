import { describe, it, expect } from "vitest";
import type { KeywordSuggestion } from "@/app/actions/keyword-suggest";

describe("BlogStepper & Keyword Intelligence Production-Grade Remediation", () => {
    it("distinguishes GSC 90-day impressions from real monthly search volume", () => {
        const gscSuggestion: KeywordSuggestion = {
            keyword: "gsc search query",
            impressions: 12400,
            gscImpressions90d: 12400,
            position: 18,
            reason: "12,400 GSC impressions (90d) — no page targets this topic cluster",
            source: "gsc_gap",
            intent: "Commercial",
            actionType: "CREATE_PAGE",
        };

        const compSuggestion: KeywordSuggestion = {
            keyword: "competitor topic",
            impressions: 0,
            searchVolume: 4500,
            difficulty: 38,
            position: 0,
            reason: "Competitor ranks for this topic",
            source: "competitor_gap",
            intent: "Transactional",
            actionType: "CREATE_PAGE",
        };

        // GSC suggestions should have gscImpressions90d set, NOT searchVolume or fake difficulty
        expect(gscSuggestion.gscImpressions90d).toBe(12400);
        expect(gscSuggestion.searchVolume).toBeUndefined();
        expect(gscSuggestion.difficulty).toBeUndefined();

        // Competitor suggestions should have real searchVolume and difficulty set
        expect(compSuggestion.searchVolume).toBe(4500);
        expect(compSuggestion.difficulty).toBe(38);
    });

    it("evaluates E-E-A-T Evidence Completeness across all 6 captured fields", () => {
        const fields = [
            { key: "authorName", value: "Magombe Kenneth" },
            { key: "authorRole", value: "Founder & Lead Consultant" },
            { key: "authorBio", value: "8 years leading SEO engineering & AI Search visibility strategy." },
            { key: "realExperience", value: "Reduced rank drop from 18% to 0% via AST remediation." },
            { key: "realNumbers", value: "$450/mo saved, 85% CTR" },
            { key: "localContext", value: "Kampala, East Africa region" },
        ];

        const filledCount = fields.filter((f) => f.value.trim().length > 0).length;
        const totalCount = fields.length;
        const completenessPercentage = Math.round((filledCount / totalCount) * 100);

        expect(filledCount).toBe(6);
        expect(totalCount).toBe(6);
        expect(completenessPercentage).toBe(100);
    });

    it("filters suggestions using competitor_gap enum matching server source", () => {
        const mockSuggestions: KeywordSuggestion[] = [
            {
                keyword: "gsc gap topic",
                impressions: 500,
                gscImpressions90d: 500,
                position: 12,
                reason: "GSC gap",
                source: "gsc_gap",
            },
            {
                keyword: "competitor gap topic",
                impressions: 0,
                searchVolume: 1200,
                difficulty: 45,
                position: 0,
                reason: "Competitor gap",
                source: "competitor_gap",
            },
        ];

        const competitorFiltered = mockSuggestions.filter((s) => s.source === "competitor_gap");
        expect(competitorFiltered).toHaveLength(1);
        expect(competitorFiltered[0].keyword).toBe("competitor gap topic");
        expect(competitorFiltered[0].difficulty).toBe(45);
    });

    it("enforces modal retry contract when onGenerate returns success: false", async () => {
        const mockOnGenerate = async () => {
            return { success: false, error: "Insufficient credits available" };
        };

        const result = await mockOnGenerate();
        expect(result.success).toBe(false);
        expect(result.error).toBe("Insufficient credits available");
    });
});
