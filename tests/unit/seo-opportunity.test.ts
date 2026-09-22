import { describe, expect, it } from "vitest";
import { analyzeSeoOpportunities } from "@/lib/blog/seo-opportunity";
import type { SerpResult } from "@/lib/blog/serp";

function page(title: string, headings: string[], body: string): SerpResult {
    return { title, link: "https://" + title.replace(/\s+/g, "-").toLowerCase() + ".example.com", snippet: title, scrapedContent: body, scrapedHeadings: headings, wordCount: body.split(/\s+/).length };
}

describe("SEO opportunity analysis", () => {
    it("separates table stakes from under-covered topics", () => {
        const results = [
            page("A", ["SEO audit", "technical SEO", "startup workflow"], "SEO audit technical SEO startup workflow"),
            page("B", ["SEO audit", "technical SEO"], "SEO audit technical SEO"),
            page("C", ["SEO audit", "technical SEO"], "SEO audit technical SEO"),
        ];
        const result = analyzeSeoOpportunities("SEO audit for startups", results);
        expect(result.tableStakes).toContain("technical seo");
        expect(result.opportunities.some(item => item.topic.includes("startup"))).toBe(true);
    });

    it("detects unanswered PAA questions", () => {
        const results = [
            page("A", ["SEO audit"], "SEO audit technical SEO"),
            page("B", ["SEO audit"], "SEO audit technical SEO"),
        ];
        const result = analyzeSeoOpportunities("SEO audit", results, [{ question: "How long does an SEO audit take?" }]);
        expect(result.unansweredQuestions).toContain("How long does an SEO audit take?");
        expect(result.opportunities.some(item => item.type === "question_gap")).toBe(true);
    });
});
