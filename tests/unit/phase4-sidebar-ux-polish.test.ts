import { describe, expect, it } from "vitest";
import {
    formatBriefBadgeLabel,
    formatOpportunityGuidanceForUi,
    formatPublishedDateLabel,
    formatSourceDomainLabel,
} from "@/lib/blog/brief-display";
import { buildSerpCompetitiveBrief } from "@/lib/blog/serp-competitive-brief";
import type { SerpContext } from "@/lib/blog/serp";

describe("Phase 4 — Review Sidebar UX Polish & SERP Brief Display", () => {
    it("renders readable domain chips instead of generic Source links", () => {
        expect(formatSourceDomainLabel("https://www.zapier.com/blog/best-seo-tools/")).toBe("zapier.com");
        expect(formatSourceDomainLabel("https://morningscore.io/best-seo-tools/")).toBe("morningscore.io");
        expect(formatSourceDomainLabel("https://ahrefs.com/backlink-checker")).toBe("ahrefs.com");
    });

    it("formats full SERP dates cleanly and omits clipped yearless fragments like 'August 5,'", () => {
        expect(formatPublishedDateLabel("August 5,")).toBeNull();
        expect(formatPublishedDateLabel("August 5")).toBeNull();
        expect(formatPublishedDateLabel("2026-08-05")).toBe("Aug 5, 2026");
        expect(formatPublishedDateLabel("August 5, 2026")).toBe("Aug 5, 2026");
    });

    it("formats raw enum strings into clean human-readable labels", () => {
        expect(formatBriefBadgeLabel("feature", "people_also_ask")).toBe("People Also Ask");
        expect(formatBriefBadgeLabel("feature", "related_searches")).toBe("Related Queries");
        expect(formatBriefBadgeLabel("feature", "interactive_tool_result")).toBe("Interactive Tool");
        expect(formatBriefBadgeLabel("opportunity", "reader_need")).toBe("Reader Question");
        expect(formatBriefBadgeLabel("opportunity", "inferred_coverage_gap")).toBe("Potential Gap");
        expect(formatBriefBadgeLabel("opportunity", "decision_criteria")).toBe("Decision Criterion");
        expect(formatBriefBadgeLabel("pageType", "interactive_tool")).toBe("Tool");
        expect(formatBriefBadgeLabel("scrapeStatus", "ANALYZED")).toBe("Analysed");
        expect(formatBriefBadgeLabel("action", "UPDATE_EXISTING")).toBe("Update Existing Page");
    });

    it("strips raw internal writer directives from legacy persisted brief opportunities", () => {
        const legacyPrompt =
            "Give a direct, evidence-supported answer, explain caveats, and avoid implying the ranking pages failed to answer unless accessible page text supports that claim.";
        const cleaned = formatOpportunityGuidanceForUi(legacyPrompt, "reader_need", 2);

        expect(cleaned).not.toContain("avoid implying");
        expect(cleaned).toContain("2 ranking results");
    });

    it("prevents false-positive YouTube source matching, omits clipped dates, differentiates confidence, and emits clean user-facing guidance", () => {
        const serpContext: SerpContext = {
            keyword: "choosing an seo tool",
            featuredSnippet: null,
            formattedContext: "",
            peopleAlsoAsk: [
                {
                    question: "What makes the best enterprise SEO tool for agencies?",
                    answer: "Agencies prioritize crawl budgets and multi-domain reporting.",
                },
                {
                    question: "How long does SEO migration testing take?",
                },
            ],
            relatedSearches: ["SEO tools YouTube", "free enterprise SEO audit checklist"],
            opportunityAnalysis: {
                tableStakes: [],
                opportunities: [],
                unansweredQuestions: [],
            },
            results: [
                {
                    rank: 1,
                    title: "Zapier: Best SEO Tools for Agencies",
                    link: "https://zapier.com/blog/best-seo-tools/",
                    snippet: "Compare enterprise SEO tools for agencies including reporting and pricing limits.",
                    scrapedPublishedDate: "August 5,",
                    scrapeStatus: "ANALYZED",
                    scrapedHeadings: ["Enterprise reporting", "Pricing limits"],
                    scrapedContent: "Agencies compare enterprise SEO tools across multi-domain reporting, API calls, and workflow integrations. ".repeat(5),
                },
                {
                    rank: 2,
                    title: "Morningscore SEO Comparison",
                    link: "https://morningscore.io/best-seo-tools/",
                    snippet: "Hands-on test of rank trackers and technical crawlers.",
                    scrapedPublishedDate: "2026-09-12",
                    scrapeStatus: "ANALYZED",
                    scrapedHeadings: ["Technical crawlers", "Rank tracking"],
                    scrapedContent: "Technical SEO platforms vary in crawl speed, rank update frequency, and link index coverage. ".repeat(5),
                },
                {
                    rank: 3,
                    title: "Ahrefs Webmaster Guide",
                    link: "https://ahrefs.com/blog/seo-tools/",
                    snippet: "Backlink data and keyword research comparisons for growing teams.",
                    scrapeStatus: "ANALYZED",
                    scrapedHeadings: ["Backlinks", "Keyword data"],
                    scrapedContent: "Backlink checkers and rank trackers serve different workflows depending on agency maturity. ".repeat(5),
                },
            ],
        };

        const brief = buildSerpCompetitiveBrief({
            keyword: "choosing an seo tool",
            serpContext,
            priorIntent: "commercial",
        });

        // Clipped "August 5," date omitted; valid "2026-09-12" retained cleanly
        expect(brief.pages[0]?.publishedAt).toBeUndefined();
        expect(brief.pages[1]?.publishedAt).toBe("2026-09-12");

        // "SEO tools YouTube" must NOT attach Zapier/Morningscore/Ahrefs URLs
        const youtubeNeed = brief.readerNeeds.find((n) => n.question === "SEO tools YouTube");
        expect(youtubeNeed?.relatedUrls).toEqual([]);

        // Confidence scores reflect actual SERP support rather than static 0.9 / 0.65 clones
        const agencyNeed = brief.readerNeeds.find((n) =>
            n.question.includes("enterprise SEO tool for agencies"),
        );
        expect(agencyNeed?.confidence).not.toBe(youtubeNeed?.confidence);
        expect(agencyNeed?.confidence).toBeGreaterThan(youtubeNeed?.confidence ?? 0);

        // No raw writer prompt instructions remain in generated opportunities
        for (const opp of brief.opportunities) {
            expect(opp.additionalValue).not.toContain("avoid implying the ranking pages failed to answer");
            expect(opp.additionalValue).not.toContain("rather than repeating competitor wording");
        }
    });
});

