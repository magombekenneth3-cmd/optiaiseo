import { describe, expect, it } from "vitest";
import {
    SiteContentLibrarySchema,
    type PageExistenceResult,
} from "@/lib/blog/contracts";
import { buildCompetitorBeatStrategy, type CompetitorProfile, type SerpContext } from "@/lib/blog/serp";
import { buildSerpCompetitiveBrief } from "@/lib/blog/serp-competitive-brief";
import { enrichOutlineWithCompetitiveBrief, type OutlinePlan } from "@/lib/blog/pipeline";

const keyword = "best technical SEO tools";

function result(
    rank: number,
    options: {
        title?: string;
        url?: string;
        headings?: string[];
        scrapeStatus?: "ANALYZED" | "SNIPPET_ONLY" | "UNSCRAPPABLE" | "FAILED";
    } = {},
) {
    const analyzed = (options.scrapeStatus ?? "ANALYZED") === "ANALYZED";
    return {
        rank,
        title: options.title ?? `Best technical SEO tools: guide ${rank}`,
        link: options.url ?? `https://publisher${rank}.example.com/technical-seo-tools`,
        snippet: `Compare technical SEO tools for crawling, indexing, audits and reporting. Result ${rank}.`,
        scrapeStatus: options.scrapeStatus ?? "ANALYZED",
        ...(analyzed ? {
            scrapedContent: ("A practical guide to technical SEO audits, crawl analysis, indexation, reporting, and evaluation criteria. ").repeat(8),
            scrapedHeadings: options.headings ?? ["Technical SEO tools comparison", "Features and use cases", "Pricing and limitations"],
            scrapedSchemaTypes: ["Article"],
            scrapedPublishedDate: "2026-09-05",
            wordCount: 1200 + rank,
        } : {
            scrapeFailureReason: "Robots policy or page retrieval failure prevented content analysis.",
        }),
    };
}

function context(results: ReturnType<typeof result>[], extras?: Partial<SerpContext>): SerpContext {
    return {
        keyword,
        results: results as SerpContext["results"],
        peopleAlsoAsk: [
            {
                question: "How do you compare technical SEO tools?",
                answer: "Compare how each tool handles crawl coverage and evidence.",
            },
        ],
        featuredSnippet: null,
        relatedSearches: ["technical SEO audit tool", "crawl analysis software"],
        formattedContext: "SERP context fixture",
        opportunityAnalysis: {
            tableStakes: [],
            opportunities: [],
            unansweredQuestions: [],
        },
        ...extras,
    };
}

describe("SERP competitive brief", () => {
    it("traces observed coverage and reader needs to the actual ranking-page URLs", () => {
        const pages = [
            result(1, { headings: ["Technical SEO tools comparison", "Crawl coverage and limitations", "Pricing and plans"] }),
            result(2, { headings: ["Technical SEO tools comparison", "Crawl coverage and limitations", "Features and use cases"] }),
            result(3, { headings: ["Technical SEO tools comparison", "Crawl coverage and limitations", "Implementation"] }),
            result(4),
            result(5),
        ];
        const brief = buildSerpCompetitiveBrief({
            keyword,
            serpContext: context(pages, { featuredSnippet: "A technical SEO audit compares crawlability, indexation, and rendering." }),
            priorIntent: "commercial",
        });

        expect(brief.retrieval.analyzedPages).toBe(5);
        expect(brief.retrieval.confidence).toBe("high");
        expect(brief.intent.label).toBe("commercial");
        expect(brief.intent.confidence).toBeGreaterThan(0.6);
        expect(brief.requiredCoverage.some(topic =>
            topic.topic === "Technical SEO tools comparison" &&
            topic.supportCount === 3 &&
            topic.observedOn.includes("https://publisher1.example.com/technical-seo-tools"),
        )).toBe(true);
        expect(brief.readerNeeds.some(need =>
            need.question === "How do you compare technical SEO tools?" &&
            need.source === "people_also_ask",
        )).toBe(true);
        expect(brief.serpFeatures.some(feature =>
            feature.type === "featured_snippet" &&
            feature.classification === "observed",
        )).toBe(true);
        expect(brief.serpFeatures.some(feature =>
            feature.type === "people_also_ask" &&
            feature.evidence.some(question => question.includes("How do you compare technical SEO tools?")),
        )).toBe(true);
        expect(brief.serpFeatures.some(feature => feature.type === "related_searches")).toBe(true);
        expect(brief.opportunities.every(opportunity =>
            opportunity.supportingObservations.every(observation =>
                observation.sourceUrls.every(url => /^https?:\/\//.test(url)),
            ),
        )).toBe(true);
    });

    it("turns the SERP brief into section-specific value contracts and traceable source URLs", () => {
        const pages = [
            result(1, { headings: ["Technical SEO tools comparison", "Crawl coverage and limitations", "Pricing and plans"] }),
            result(2, { headings: ["Technical SEO tools comparison", "Crawl coverage and limitations", "Features and use cases"] }),
            result(3, { headings: ["Technical SEO tools comparison", "Crawl coverage and limitations", "Implementation"] }),
            result(4),
            result(5),
        ];
        const brief = buildSerpCompetitiveBrief({
            keyword,
            serpContext: context(pages),
            priorIntent: "commercial",
        });
        const outline: OutlinePlan = {
            title: "How to Evaluate Technical SEO Tools",
            slug: "evaluate-technical-seo-tools",
            quickAnswer: "Compare coverage, limits, reliability, and the workflow each tool supports.",
            metaDescription: "A practical guide to comparing technical SEO tools and evaluation criteria.",
            thesis: "Tool selection should follow the site's crawling and decision needs.",
            estimatedTotal: 1800,
            sections: [{
                heading: "Technical SEO tools comparison",
                goal: "Help readers choose a tool using concrete evaluation criteria.",
                tone: "analytical",
                evidenceType: "comparison",
                wordTarget: 500,
                keyEntities: ["crawl coverage", "pricing", "indexing"],
            }],
        };

        const enriched = enrichOutlineWithCompetitiveBrief(outline, brief);
        const section = enriched.sections[0];

        expect(section.readerTask).toBe(outline.sections[0].goal);
        expect(section.observedCompetitorCoverage).toContain("Technical SEO tools comparison");
        expect(section.additionalValue).toContain("decision criteria");
        expect(section.evidenceRequirements?.length).toBeGreaterThan(0);
        expect(section.competitiveSourceUrls).toContain("https://publisher1.example.com/technical-seo-tools");
        expect(section.contributionStatus).not.toBe("verified");
    });

    it("deduplicates ranking URLs and lowers confidence when pages cannot be analysed", () => {
        const pages = [
            result(1),
            result(2, { url: "https://publisher1.example.com/technical-seo-tools/" }),
            result(3, { scrapeStatus: "SNIPPET_ONLY" }),
            result(4, { scrapeStatus: "UNSCRAPPABLE" }),
            result(5, { scrapeStatus: "FAILED" }),
        ];
        const brief = buildSerpCompetitiveBrief({
            keyword,
            serpContext: context(pages),
            priorIntent: "commercial",
        });

        expect(brief.pages).toHaveLength(4);
        expect(brief.retrieval.uniqueResults).toBe(4);
        expect(brief.retrieval.confidence).toBe("low");
        expect(brief.retrieval.status).toBe("PARTIAL");
        expect(brief.retrieval.scrapeFailures.length).toBeGreaterThan(0);
        expect(brief.opportunities.filter(opportunity =>
            opportunity.type === "inferred_coverage_gap",
        )).toHaveLength(0);
        expect(brief.siteFit?.humanReviewRequired).toBe(true);
    });

    it("recommends review when tools dominate instead of pretending an article is a tool", () => {
        const brief = buildSerpCompetitiveBrief({
            keyword,
            serpContext: context([
                result(1, { title: "Free technical SEO audit tool", url: "https://tools.example.com/audit" }),
                result(2, { title: "Technical SEO checker and tool", url: "https://checker.example.com/" }),
                result(3, { title: "Technical SEO tool comparison guide", url: "https://guide.example.com/compare" }),
            ]),
        });

        expect(brief.dominantFormats.find(item => item.format === "tool")?.share).toBeGreaterThanOrEqual(0.4);
        expect(brief.siteFit?.recommendedAction).toBe("REQUEST_REVIEW");
        expect(brief.siteFit?.humanReviewRequired).toBe(true);
    });

    it("uses existing-page evidence and the site library to prevent a duplicate content action", () => {
        const capturedAt = new Date().toISOString();
        const library = SiteContentLibrarySchema.parse({
            retrievalStatus: "AVAILABLE",
            capturedAt,
            consideredCount: 1,
            warnings: [],
            relatedPages: [{
                id: "existing-blog",
                title: "Best Technical SEO Tools",
                slug: "best-technical-seo-tools",
                url: "https://mysite.example.com/blog/best-technical-seo-tools",
                status: "PUBLISHED",
                targetKeywords: [keyword],
                publishedAt: "2026-09-01T00:00:00.000Z",
                updatedAt: capturedAt,
                headings: ["Crawl coverage", "Indexing checks", "Pricing"],
                excerpt: "A guide to technical SEO auditing and tool selection.",
                comparisonText: "A guide to technical SEO auditing and tool selection. ".repeat(10),
                relevance: 0.98,
                matchedTerms: ["technical", "seo", "tools"],
            }],
        });
        const existingSite: PageExistenceResult = {
            verdict: "EXISTING_NEEDS_FIX",
            existingPage: {
                url: "https://mysite.example.com/blog/best-technical-seo-tools",
                matchSource: "GSC_RANKING_URL",
                matchConfidence: 0.93,
                issues: ["Outdated examples"],
            },
            allCandidates: [],
            recommendedAction: "UPDATE_META_DESCRIPTION",
            recommendedCategory: "UPDATE_EXISTING",
            reasoning: "A relevant published page already exists.",
        };

        const brief = buildSerpCompetitiveBrief({
            keyword,
            serpContext: context([result(1), result(2), result(3)]),
            siteContentLibrary: library,
            existingSite,
        });

        expect(brief.siteFit?.recommendedAction).toBe("UPDATE_EXISTING");
        expect(brief.siteFit?.matchingPageUrl).toBe("https://mysite.example.com/blog/best-technical-seo-tools");
        expect(brief.siteFit?.humanReviewRequired).toBe(false);
    });

    it("bases the competitor beat strategy on useful coverage rather than word-count padding or missing schema", () => {
        const profiles: CompetitorProfile[] = [
            {
                url: "https://one.example.com/guide",
                title: "Technical SEO Tool Guide",
                headings: ["Crawl coverage", "Indexing diagnostics", "Pricing and limits"],
                estimatedWords: 900,
                rank: 1,
                schemaTypes: ["Article"],
                publishedDate: "2026-07-10",
                scrapeStatus: "ANALYZED",
            },
            {
                url: "https://two.example.com/guide",
                title: "Technical SEO Comparison",
                headings: ["Crawl coverage", "Indexing diagnostics", "Features"],
                estimatedWords: 2_400,
                rank: 2,
                schemaTypes: [],
                publishedDate: "2026-08-12",
                scrapeStatus: "ANALYZED",
            },
            {
                url: "https://three.example.com/guide",
                title: "Technical SEO Tutorial",
                headings: ["Crawl coverage", "Indexing diagnostics", "Implementation"],
                estimatedWords: 1_600,
                rank: 3,
                schemaTypes: ["Article"],
                publishedDate: "2026-09-01",
                scrapeStatus: "ANALYZED",
            },
        ];

        const strategy = buildCompetitorBeatStrategy(profiles, keyword);

        expect(strategy).toContain("Do not pad the article to exceed competitor word counts");
        expect(strategy).toContain("Crawl coverage");
        expect(strategy).toContain("Use structured data only when");
        expect(strategy).not.toMatch(/minimum word count|average competitor word count|+\s*400/i);
    });

    it("marks research unavailable when no current SERP is supplied", () => {
        const brief = buildSerpCompetitiveBrief({
            keyword,
            serpContext: null,
            priorIntent: "commercial",
        });

        expect(brief.retrieval.status).toBe("UNAVAILABLE");
        expect(brief.retrieval.confidence).toBe("low");
        expect(brief.requiredCoverage).toHaveLength(0);
        expect(brief.opportunities).toHaveLength(0);
        expect(brief.siteFit?.humanReviewRequired).toBe(true);
    });
});
