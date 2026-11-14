import { describe, it, expect } from "vitest";
import {
    assessResearchCompleteness,
    MIN_ANALYZED_PAGES_FOR_COMPLETE_RESEARCH,
} from "@/lib/blog/research-completeness";
import { guardEditorialRewrite } from "@/lib/blog/editorial-guards";
import { evaluatePublicationGate } from "@/lib/blog/publication-gate";
import type { SerpCompetitiveBrief, ResearchPacket, EvidencePacket } from "@/lib/blog/contracts";

function makeCompleteBrief(overrides?: Partial<SerpCompetitiveBrief>): SerpCompetitiveBrief {
    return {
        version: 1,
        keyword: "choosing an seo tool",
        researchedAt: "2026-11-14T20:00:00.000Z",
        retrieval: {
            status: "AVAILABLE",
            confidence: "high",
            organicResultsReceived: 10,
            uniqueResults: 10,
            scrapeAttempts: 5,
            analyzedPages: 5,
            scrapeFailures: [],
            coverageRatio: 0.5,
            notes: [],
        },
        intent: {
            label: "commercial",
            confidence: 0.9,
            rationale: "Comparison queries dominate the SERP.",
            signals: ["top results are comparison guides"],
        },
        dominantFormats: [{ format: "comparison", count: 4, share: 0.8 }],
        recommendedFormat: "comparison",
        serpFeatures: [],
        pages: [1, 2, 3, 4, 5].map(rank => ({
            rank,
            url: `https://example${rank}.com/seo-tools`,
            title: `Top SEO Tools Compared (${rank})`,
            snippet: "Compare crawl limits, pricing, and rank tracking accuracy.",
            pageType: "comparison",
            dominantFormat: "comparison",
            scrapeStatus: "ANALYZED",
            headings: ["Pricing Comparison", "Crawler Accuracy"],
            wordCount: 2200,
            publishedAt: "2026-10-01",
            schemaTypes: ["Article"],
        })),
        requiredCoverage: [
            {
                topic: "Pricing Comparison",
                reason: "Appears in 4 of 5 top pages",
                classification: "observed_pattern",
                supportCount: 4,
                totalAnalyzed: 5,
                observedOn: ["https://example1.com/seo-tools"],
                confidence: 0.9,
            },
        ],
        readerNeeds: [
            {
                question: "How much do enterprise SEO tools cost?",
                source: "people_also_ask",
                relatedUrls: ["https://example1.com/seo-tools"],
                confidence: 0.85,
            },
        ],
        decisionCriteria: [],
        opportunities: [
            {
                id: "opp-1",
                type: "inferred_coverage_gap",
                description: "Explain API credit limits and data ownership.",
                confidence: 0.85,
                verificationStatus: "observed",
                additionalValue: "Concrete API rate limit table.",
                sourceUrls: ["https://example1.com/seo-tools"],
                supportingObservations: [],
            },
        ],
        outlineGuidance: ["Include an API data-ownership section."],
        differentiationPlan: ["Include an API data-ownership checklist."],
        evidenceRequirements: ["Cite official pricing pages for every tier mentioned."],
        ...overrides,
    };
}

describe("Phase 1 — Research Completeness & Editorial Rewrite Guards", () => {
    describe("assessResearchCompleteness", () => {
        it("returns INCOMPLETE and researchBacked=false when brief is missing", () => {
            const res = assessResearchCompleteness(null);
            expect(res.status).toBe("INCOMPLETE");
            expect(res.researchBacked).toBe(false);
            expect(res.analyzedPages).toBe(0);
            expect(res.reasons.length).toBeGreaterThan(0);
        });

        it("returns INCOMPLETE when retrieval status is UNAVAILABLE or 0 pages analyzed", () => {
            const brief = makeCompleteBrief({
                retrieval: {
                    status: "UNAVAILABLE",
                    confidence: "low",
                    organicResultsReceived: 0,
                    uniqueResults: 0,
                    scrapeAttempts: 0,
                    analyzedPages: 0,
                    scrapeFailures: [],
                    coverageRatio: 0,
                    notes: ["API key missing"],
                },
            });
            const res = assessResearchCompleteness(brief);
            expect(res.status).toBe("INCOMPLETE");
            expect(res.researchBacked).toBe(false);
        });

        it("returns PARTIAL when analyzedPages is below MIN_ANALYZED_PAGES_FOR_COMPLETE_RESEARCH", () => {
            const brief = makeCompleteBrief({
                retrieval: {
                    status: "AVAILABLE",
                    confidence: "medium",
                    organicResultsReceived: 8,
                    uniqueResults: 8,
                    scrapeAttempts: 5,
                    analyzedPages: MIN_ANALYZED_PAGES_FOR_COMPLETE_RESEARCH - 1,
                    scrapeFailures: [],
                    coverageRatio: 0.25,
                    notes: [],
                },
            });
            const res = assessResearchCompleteness(brief);
            expect(res.status).toBe("PARTIAL");
            expect(res.researchBacked).toBe(false);
        });

        it("returns COMPLETE and researchBacked=true when SERP retrieval and page analysis succeed", () => {
            const brief = makeCompleteBrief();
            const res = assessResearchCompleteness(brief);
            expect(res.status).toBe("COMPLETE");
            expect(res.researchBacked).toBe(true);
            expect(res.analyzedPages).toBe(5);
            expect(res.reasons).toEqual([]);
        });
    });

    describe("guardEditorialRewrite", () => {
        const originalHtml = [
            "<h2>How Google Search Console Reports Impressions</h2>",
            '<p>According to <a href="https://developers.google.com/search/docs">Google Search Central</a>, impressions are counted when a link appears in search results for 28 days.</p>',
            "<h2>Evaluating Crawler Limits</h2>",
            '<p>Teams auditing more than 10,000 URLs should verify crawl quotas in <a href="https://example.com/pricing">official pricing documentation</a>.</p>',
        ].join("\n");

        it("accepts a clean stylistic rewrite that preserves links, H2 sections, and numbers", () => {
            const editedHtml = [
                "<h2>How Google Search Console Reports Impressions</h2>",
                '<p><a href="https://developers.google.com/search/docs">Google Search Central</a> notes that an impression is recorded whenever a link appears in search results over 28 days.</p>',
                "<h2>Evaluating Crawler Limits</h2>",
                '<p>If you\'re auditing more than 10,000 URLs, check crawl quotas in the <a href="https://example.com/pricing">official pricing documentation</a>.</p>',
            ].join("\n");

            const result = guardEditorialRewrite(originalHtml, editedHtml);
            expect(result.accepted).toBe(true);
            expect(result.reasons).toEqual([]);
        });

        it("rejects a rewrite that drops a source link", () => {
            const editedHtml = originalHtml.replace(
                '<a href="https://example.com/pricing">official pricing documentation</a>',
                "official pricing documentation",
            );
            const result = guardEditorialRewrite(originalHtml, editedHtml);
            expect(result.accepted).toBe(false);
            expect(result.reasons.some(r => r.includes("removed 1 source link"))).toBe(true);
        });

        it("rejects a rewrite that introduces unverified numbers", () => {
            const editedHtml = originalHtml.replace(
                "more than 10,000 URLs",
                "more than 10,000 URLs (which improves rankings by 73%)",
            );
            const result = guardEditorialRewrite(originalHtml, editedHtml);
            expect(result.accepted).toBe(false);
            expect(result.reasons.some(r => r.includes("introduced numbers"))).toBe(true);
        });

        it("rejects a rewrite that drops H2 headings", () => {
            const editedHtml = originalHtml.replace("<h2>Evaluating Crawler Limits</h2>", "<p>Evaluating Crawler Limits</p>");
            const result = guardEditorialRewrite(originalHtml, editedHtml);
            expect(result.accepted).toBe(false);
            expect(result.reasons.some(r => r.includes("dropped sections"))).toBe(true);
        });
    });

    describe("Publication Gate Research Completeness enforcement", () => {
        it("blocks publication with RESEARCH_INCOMPLETE when serpCompetitiveBrief is missing", async () => {
            const emptyResearchPacket: ResearchPacket = {
                collectedAt: new Date().toISOString(),
                evidenceAvailability: "AVAILABLE",
                keyword: "choosing an seo tool",
                intent: "commercial",
                brain: {
                    intent: "commercial",
                    searcherMindset: "Evaluating tools before purchase",
                    contentGaps: [],
                    entities: ["Google Search Console"],
                    contrarianAngles: [],
                    examplesNeeded: [],
                    faqTargets: [],
                    commonMisconceptions: [],
                    industryMyths: [],
                    whatPeopleAvoidSaying: [],
                },
                sources: [
                    {
                        id: "src-1",
                        title: "Google Search Central",
                        url: "https://developers.google.com/search",
                        claim: "Google Search Console reports performance data.",
                        evidence: "Google Search Console reports search impressions and clicks.",
                        sourceType: "official",
                        confidence: 0.95,
                        retrievedAt: new Date().toISOString(),
                        authorityScore: 0.95,
                    },
                ],
                serp: {
                    competitors: [],
                    paa: [],
                    tableStakes: [],
                    opportunities: [],
                    unansweredQuestions: [],
                    format: "comparison",
                },
                entities: [],
                authorEvidence: {
                    name: "Editorial Team",
                },
                contentGaps: [],
                misconceptions: [],
                contrarianAngles: [],
            };

            const evidencePacket: EvidencePacket = {
                availability: "AVAILABLE",
                claims: [],
                sources: emptyResearchPacket.sources,
                claimSourceMap: [],
                examples: [],
                caseStudies: [],
                visuals: [],
                unsupportedClaims: [],
                unsourcedStatistics: [],
                unverifiedCaseStudies: [],
                fabricatedClaims: [],
                extraction: {
                    extractedAt: new Date().toISOString(),
                    extractorVersion: "blog-evidence-v1",
                    researchAvailability: "AVAILABLE",
                    researchCollectedAt: new Date().toISOString(),
                    sourceCitationCount: 1,
                    claimCount: 0,
                },
            };

            const decision = await evaluatePublicationGate({
                content: "<h2>Choosing an SEO Tool</h2><p>Google Search Console provides search performance metrics.</p>",
                title: "Choosing an SEO Tool: Practical Evaluation Guide",
                metaDescription: "Learn how to evaluate an SEO tool using verified documentation, crawler accuracy checks, and API limits.",
                targetKeywords: ["choosing an seo tool"],
                evidencePacket,
                serpContext: null,
                researchPacket: emptyResearchPacket,
                riskTier: "low",
                hasFirstPartyEvidence: true,
                factCheckComplete: true,
                factCheckCoverage: 1,
            });

            const researchGate = decision.gates.find(g => g.name === "Research");
            expect(researchGate).toBeDefined();
            expect(researchGate?.status).toBe("FAIL");
            expect(researchGate?.issues.some(i => i.includes("RESEARCH_INCOMPLETE"))).toBe(true);
            expect(decision.canPublish).toBe(false);
        });
    });
});
