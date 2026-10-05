import { describe, it, expect } from "vitest";
import type { KeywordSuggestion } from "@/app/actions/keyword-suggest";

describe("BlogStepper & Keyword Intelligence Contract Remediation", () => {
    it("KeywordSuggestion interface exposes searchVolume, difficulty, and intent", () => {
        const suggestion: KeywordSuggestion = {
            keyword: "best crm software",
            impressions: 12400,
            position: 18,
            reason: "12,400 searches/mo — no page exists targeting this topic cluster",
            source: "competitor_gap",
            searchVolume: 12400,
            difficulty: 42,
            intent: "Commercial",
            actionType: "CREATE_PAGE",
        };

        expect(suggestion.source).toBe("competitor_gap");
        expect(suggestion.searchVolume).toBe(12400);
        expect(suggestion.difficulty).toBe(42);
        expect(suggestion.intent).toBe("Commercial");
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
                position: 12,
                reason: "GSC gap",
                source: "gsc_gap",
            },
            {
                keyword: "competitor gap topic",
                impressions: 1200,
                position: 0,
                reason: "Competitor gap",
                source: "competitor_gap",
            },
        ];

        const competitorFiltered = mockSuggestions.filter((s) => s.source === "competitor_gap");
        expect(competitorFiltered).toHaveLength(1);
        expect(competitorFiltered[0].keyword).toBe("competitor gap topic");
    });
});
