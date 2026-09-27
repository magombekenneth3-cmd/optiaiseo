import { describe, expect, it } from "vitest";
import { analyzeSeoOpportunities } from "@/lib/blog/seo-opportunity";
import type { SerpResult } from "@/lib/blog/serp";

/**
 * Each page needs >= 300 chars of scrapedContent to pass the content-length filter
 * inside analyzeSeoOpportunities. Use repeat() to fill content while preserving
 * word boundaries (avoids bigram-boundary corruption from whitespace-padding).
 *
 * A phrase must appear in >= 2 pages to enter the candidateMap, and coverage >= 0.7
 * (i.e., count/total >= 0.7) to be in tableStakes. Opportunities have coverage < 0.7.
 */
function page(title: string, headings: string[], body: string): SerpResult {
    const fullBody = body.repeat(Math.ceil(320 / Math.max(body.length, 1))).slice(0, 400);
    return {
        title,
        link: "https://" + title.replace(/\s+/g, "-").toLowerCase() + ".example.com",
        snippet: title,
        scrapedContent: fullBody,
        scrapedHeadings: headings,
        wordCount: fullBody.split(/\s+/).length,
    };
}

describe("SEO opportunity analysis", () => {
    it("separates table stakes from under-covered topics", () => {
        // 3 pages total. "technical seo audit" appears in all 3 → tableStakes (coverage 1.0).
        // "startup" appears in 2/3 pages → coverage 0.67 < 0.7 → opportunity, not tableStakes.
        const results = [
            page(
                "A",
                ["SEO audit", "technical SEO", "startup tips"],
                "technical SEO audit fundamentals. startup tips for technical SEO audit coverage.",
            ),
            page(
                "B",
                ["SEO audit", "technical SEO", "startup guide"],
                "technical SEO audit fundamentals. startup guide for technical SEO audit success.",
            ),
            page(
                "C",
                ["SEO audit", "technical SEO"],
                "technical SEO audit fundamentals. technical SEO audit improves crawlability.",
            ),
        ];
        const result = analyzeSeoOpportunities("technical SEO audit", results);

        // "technical" + "seo" + "audit" bigrams appear in all 3 → tableStakes
        expect(result.tableStakes.length).toBeGreaterThan(0);
        expect(
            result.tableStakes.some(t =>
                ["seo", "audit", "technical"].some(kw => t.includes(kw))
            )
        ).toBe(true);

        // "startup" appears in 2/3 pages (coverage 0.67) → opportunity
        expect(result.opportunities.some(item => item.topic.includes("startup"))).toBe(true);
    });

    it("detects unanswered PAA questions", () => {
        // Pages only discuss crawlability — "How long" question is NOT covered
        const results = [
            page("A", ["SEO audit"], "SEO audit covers crawlability and indexing performance at scale for websites."),
            page("B", ["SEO audit"], "SEO audit covers crawlability and indexing performance at scale for websites."),
        ];
        const result = analyzeSeoOpportunities("SEO audit", results, [
            { question: "How long does an SEO audit take?" },
        ]);

        // The PAA question is unanswered
        expect(result.unansweredQuestions).toContain("How long does an SEO audit take?");

        // It should appear as a question_gap opportunity
        expect(result.opportunities.some(item => item.type === "question_gap")).toBe(true);
    });
});
