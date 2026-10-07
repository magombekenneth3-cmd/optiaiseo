import { describe, it, expect } from "vitest";
import { analyzeCompetitorGap, urlBelongsToDomain } from "@/lib/blog/competitor-gap-analyzer";
import { renderCompetitorAnalysisBlock } from "@/lib/blog/pipeline";
import { CompetitorAnalysisSchema } from "@/lib/blog/contracts";
import type { SerpContext, SerpResult } from "@/lib/blog/serp";

const NOW = new Date("2026-10-01T00:00:00Z");

function page(link: string, headings: string[], body: string, extra: Partial<SerpResult> = {}): SerpResult {
    const scrapedContent = `${body} ${"filler text about the topic ".repeat(20)}`;
    return {
        title: `Title for ${link}`,
        link,
        snippet: "A snippet long enough to pass the low-signal filter in SERP.",
        scrapedContent,
        scrapedHeadings: headings,
        scrapedSchemaTypes: [],
        scrapedPublishedDate: null,
        wordCount: scrapedContent.split(/\s+/).filter(Boolean).length,
        ...extra,
    };
}

function serp(results: SerpResult[], paa: string[] = []): SerpContext {
    return {
        keyword: "crm software",
        results,
        peopleAlsoAsk: paa.map(question => ({ question })),
        featuredSnippet: null,
        relatedSearches: [],
        formattedContext: "",
        opportunityAnalysis: { opportunities: [] } as any,
    };
}

describe("analyzeCompetitorGap", () => {
    it("is UNAVAILABLE with no claims when the competitor is not in the SERP", () => {
        const ctx = serp([
            page("https://a.com/crm", ["CRM pricing tiers"], "crm pricing tiers"),
            page("https://b.com/crm", ["CRM pricing tiers"], "crm pricing tiers"),
        ]);
        const result = analyzeCompetitorGap({ keyword: "crm software", competitorDomain: "rival.com", serpContext: ctx, now: NOW });

        expect(result.availability).toBe("UNAVAILABLE");
        expect(result.unavailableReason).toContain("rival.com");
        expect(result.contentWeaknesses).toBeUndefined();
        expect(result.differentiationOpportunities).toBeUndefined();
        expect(result.missingSubtopics).toBeUndefined();
        expect(() => CompetitorAnalysisSchema.parse(result)).not.toThrow();
    });

    it("does not match look-alike domains via substring", () => {
        expect(urlBelongsToDomain("https://notrival.com/x", "rival.com")).toBe(false);
        expect(urlBelongsToDomain("https://rival.com.evil.io/x", "rival.com")).toBe(false);
        expect(urlBelongsToDomain("https://blog.rival.com/x", "https://www.rival.com/")).toBe(true);

        const ctx = serp([page("https://notrival.com/crm", ["CRM"], "crm")]);
        const result = analyzeCompetitorGap({ keyword: "crm", competitorDomain: "rival.com", serpContext: ctx, now: NOW });
        expect(result.availability).toBe("UNAVAILABLE");
    });

    it("is UNAVAILABLE when the competitor ranks but was not scraped", () => {
        const unscraped: SerpResult = { title: "Rival", link: "https://rival.com/crm", snippet: "snippet text long enough here for filter" };
        const result = analyzeCompetitorGap({ keyword: "crm", competitorDomain: "rival.com", serpContext: serp([unscraped]), now: NOW });
        expect(result.availability).toBe("UNAVAILABLE");
        expect(result.competitorRankingUrl).toBe("https://rival.com/crm");
        expect(result.unavailableReason).toContain("could not be scraped");
    });

    it("reports peer-consensus subtopics and PAA questions the competitor misses, each with evidence", () => {
        const ctx = serp(
            [
                page("https://a.com/crm", ["CRM pricing tiers explained", "Onboarding checklist"], "pricing tiers onboarding checklist"),
                page("https://rival.com/crm", ["What is CRM", "Onboarding checklist"], "customer relationship management onboarding checklist"),
                page("https://b.com/crm", ["Pricing tiers for CRM", "Integrations"], "pricing tiers integrations"),
                page("https://c.com/crm", ["Integrations with email"], "integrations email"),
            ],
            ["How much does CRM software cost per user?", "What is customer relationship management?"],
        );

        const result = analyzeCompetitorGap({ keyword: "crm software", competitorDomain: "rival.com", serpContext: ctx, now: NOW });

        expect(result.availability).toBe("AVAILABLE");
        expect(result.structuralStrengths?.[0]).toContain("Ranks #2");
        expect(result.missingSubtopics).toEqual(expect.arrayContaining(["CRM pricing tiers explained"]));
        expect(result.missingSubtopics?.some(s => /integrations/i.test(s))).toBe(true);
        // Onboarding is covered by competitor → never a gap
        expect(result.missingSubtopics?.some(s => /onboarding/i.test(s))).toBe(false);
        expect(result.missingQuestions).toContain("How much does CRM software cost per user?");
        expect(result.missingQuestions).not.toContain("What is customer relationship management?");
        expect(result.differentiationOpportunities).toEqual(
            expect.arrayContaining(["CRM pricing tiers explained", "How much does CRM software cost per user?"]),
        );
        expect(result.evidence?.some(e => e.includes("ranks 1, 3"))).toBe(true);
        expect(() => CompetitorAnalysisSchema.parse(result)).not.toThrow();
    });

    it("does not flag a subtopic only one peer covers", () => {
        const ctx = serp([
            page("https://a.com/x", ["Niche migration tips"], "niche migration tips"),
            page("https://rival.com/x", ["Basics"], "basics"),
            page("https://b.com/x", ["Something else"], "something else"),
        ]);
        const result = analyzeCompetitorGap({ keyword: "x", competitorDomain: "rival.com", serpContext: ctx, now: NOW });
        expect(result.missingSubtopics).toEqual([]);
        expect(result.differentiationOpportunities).toBeUndefined();
    });

    it("flags thin, stale and FAQ-schema weaknesses only when measured", () => {
        const longBody = "detailed coverage ".repeat(400);
        const ctx = serp(
            [
                page("https://a.com/x", [], longBody, { scrapedSchemaTypes: ["FAQPage"] }),
                page("https://b.com/x", [], longBody),
                page("https://rival.com/x", [], "short", { scrapedPublishedDate: "2023-01-15T00:00:00Z" }),
            ],
            ["Is it worth it?"],
        );
        const result = analyzeCompetitorGap({ keyword: "x", competitorDomain: "rival.com", serpContext: ctx, now: NOW });

        expect(result.contentWeaknesses?.some(w => w.startsWith("Thinner than peers"))).toBe(true);
        expect(result.contentWeaknesses?.some(w => w.startsWith("Stale"))).toBe(true);
        expect(result.contentWeaknesses).toContain("No FAQPage schema despite People Also Ask demand");

        // A fresh, long competitor gets none of these
        const fresh = analyzeCompetitorGap({
            keyword: "x",
            competitorDomain: "rival.com",
            serpContext: serp([
                page("https://a.com/x", [], longBody),
                page("https://b.com/x", [], longBody),
                page("https://rival.com/x", [], longBody, { scrapedPublishedDate: "2026-08-01T00:00:00Z" }),
            ]),
            now: NOW,
        });
        expect(fresh.contentWeaknesses).toEqual([]);
    });

    it("contains no templated generic claims", () => {
        const ctx = serp([page("https://rival.com/x", ["A"], "a"), page("https://a.com/x", ["B"], "b")]);
        const result = analyzeCompetitorGap({ keyword: "x", competitorDomain: "rival.com", serpContext: ctx, now: NOW });
        const all = JSON.stringify(result);
        expect(all).not.toMatch(/telemetry|generic advice|first-party experience/i);
    });

    it("is deterministic", () => {
        const ctx = serp(
            [
                page("https://a.com/crm", ["CRM pricing tiers"], "pricing tiers"),
                page("https://rival.com/crm", ["Intro"], "intro"),
                page("https://b.com/crm", ["Pricing tiers"], "pricing tiers"),
            ],
            ["How much does it cost?"],
        );
        const a = analyzeCompetitorGap({ keyword: "crm", competitorDomain: "rival.com", serpContext: ctx, now: NOW });
        const b = analyzeCompetitorGap({ keyword: "crm", competitorDomain: "rival.com", serpContext: ctx, now: NOW });
        expect(a).toEqual(b);
    });
});

describe("renderCompetitorAnalysisBlock", () => {
    it("forbids competitor claims when UNAVAILABLE", () => {
        const block = renderCompetitorAnalysisBlock(
            { competitorDomain: "rival.com", availability: "UNAVAILABLE", unavailableReason: "not in SERP" },
            "MANDATE",
        );
        expect(block).toContain("UNAVAILABLE");
        expect(block).toContain("Do NOT make any claims about rival.com");
        expect(block).not.toContain("stated incorrectly");
    });

    it("renders measured gaps and evidence when AVAILABLE", () => {
        const block = renderCompetitorAnalysisBlock(
            {
                competitorDomain: "rival.com",
                availability: "AVAILABLE",
                missingSubtopics: ["Pricing tiers"],
                missingQuestions: ["How much does it cost?"],
                evidence: ["Subtopic \"Pricing tiers\" covered by 2/3 peers"],
            },
            "MANDATE",
        );
        expect(block).toContain("Pricing tiers");
        expect(block).toContain("How much does it cost?");
        expect(block).toContain("covered by 2/3 peers");
        expect(block).toContain("Only the gaps listed above are verified");
    });
});
