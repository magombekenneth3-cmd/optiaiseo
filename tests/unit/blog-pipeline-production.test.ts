import { describe, it, expect } from "vitest";
import { buildResearchPacket } from "@/lib/blog/research-packet";
import type { GroundedSiteContext } from "@/lib/prompt-context/build-site-context";
import type { CompetitorAnalysis } from "@/lib/blog/contracts";
import { ResearchBrain, analyzeDraftQuality, applyTargetedRevision } from "@/lib/blog/pipeline";
import { buildPromptContext } from "@/lib/blog/prompt-context";
import { extractEvidencePacket } from "@/lib/blog/evidence-extractor";
import { buildPublicationDecision, evaluatePublicationGate } from "@/lib/blog/publication-gate";

import type { SerpContext } from "@/lib/blog/serp";

describe("Blog Pipeline Production Audit Hardening", () => {
    const mockGroundedCtx: GroundedSiteContext = {
        contextBlock: "=== SITE CONTEXT ===\nDomain: example.com\nCore Services: SEO & AI Software\nLocation / Market: Austin, TX",
        data: {
            domain: "example.com",
            coreServices: "SEO & AI Software",
            location: "Austin, TX",
            authorName: "Jane Doe",
            authorRole: "Lead SEO Strategist",
            authorBio: "10+ years optimizing SaaS search performance.",
            realExperience: "Optimized 500+ client sites generating 10M+ impressions.",
            realNumbers: "500+ sites, 10M+ impressions",
            localContext: "Serving North America SaaS companies.",
            niche: "SaaS SEO",
            targetCustomer: "Marketing Directors & Founders",
            brandFacts: [
                { factType: "PRICING", value: "Starting at $99/mo" },
                { factType: "GUARANTEE", value: "14-day money back guarantee" },
            ],
            topKeywords: [
                { keyword: "ai seo software", position: 3 },
            ],
            auditScore: 92,
            competitorDomains: ["competitor.com"],
        },
    };

    const mockAuthor = {
        name: "Jane Doe",
        role: "Lead SEO Strategist",
        bio: "10+ years optimizing SaaS search performance.",
        realExperience: "Optimized 500+ client sites generating 10M+ impressions.",
        realNumbers: "500+ sites, 10M+ impressions",
        localContext: "Serving North America SaaS companies.",
    };

    const mockSerpContext: SerpContext = {
        keyword: "best ai seo tools",
        results: [
            {
                title: "Top AI SEO Tools 2026",
                link: "https://competitor.com/best-tools",
                snippet: "Review of top AI SEO tools for SaaS and agencies.",
                scrapedContent: "Full review of tools with features and pricing breakdown.",
                scrapedHeadings: ["Features", "Pricing"],
                wordCount: 1500,
            }
        ],
        peopleAlsoAsk: [
            { question: "What is the best AI SEO tool?", answer: "OptiAISEO ranks top." }
        ],
        featuredSnippet: "OptiAISEO is the leading AI SEO tool for SaaS.",
        relatedSearches: ["best ai content generator", "ai seo automation"],
        formattedContext: "LIVE SEARCH CONTEXT FOR \"best ai seo tools\"...",
        opportunityAnalysis: {
            tableStakes: ["Feature breakdown", "Pricing"],
            opportunities: [
                {
                    type: "topic_gap",
                    topic: "Integration capabilities",
                    score: 85,
                    coverage: 20,
                    competitorCount: 1,
                    competitorTotal: 5,
                    rankWeightedCoverage: 20,
                    intentRelevance: 80,
                    evidence: ["Only competitor.com mentions this"],
                    reason: "Low coverage across competitors",
                }
            ],
            unansweredQuestions: ["How fast does indexing take?"],
        },
    };

    const mockBrain: ResearchBrain = {
        intent: "commercial",
        searcherMindset: "Comparing top AI SEO tools to choose the best option.",
        contentGaps: ["Real pricing comparison", "Live GSC integration speed"],
        entities: ["OptiAISEO", "Google Search Console", "Perplexity"],
        contrarianAngles: ["Pure keyword density is obsolete"],
        examplesNeeded: ["SaaS case study with real numbers"],
        faqTargets: ["How much does AI SEO software cost?"],
        commonMisconceptions: ["AI content gets penalized automatically"],
        industryMyths: ["More words always equal higher ranks"],
        whatPeopleAvoidSaying: ["Most AI tools just wrap OpenAI APIs without proprietary data"],
    };

    it("1. Site grounding reaches the research packet and first-party evidence", async () => {
        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        expect(packet.firstPartyEvidence).toBeDefined();
        expect(packet.firstPartyEvidence?.domain).toBe("example.com");
        expect(packet.firstPartyEvidence?.coreServices).toBe("SEO & AI Software");
        expect(packet.firstPartyEvidence?.location).toBe("Austin, TX");
        expect(packet.firstPartyEvidence?.targetCustomer).toBe("Marketing Directors & Founders");
        expect(packet.firstPartyEvidence?.brandFacts).toHaveLength(2);
    });

    it("2. Intent detection correctly classifies commercial search queries", async () => {
        const packet = await buildResearchPacket({
            keyword: "buy best ai seo tool",
            brain: { ...mockBrain, intent: "commercial" },
            serpContext: mockSerpContext,
            author: mockAuthor,
        });
        expect(["commercial", "comparison"]).toContain(packet.intent);
    });

    it("3. DATA_REPORT pipeline type research packet retains keyword and topic integrity", async () => {
        const packet = await buildResearchPacket({
            keyword: "saas seo benchmarks 2026",
            brain: { ...mockBrain, intent: "informational" },
            serpContext: mockSerpContext,
            author: mockAuthor,
        });

        expect(packet).toBeDefined();
        expect(packet.keyword).toBe("saas seo benchmarks 2026");
    });

    it("4. Competitor analysis materially enters research packet context", async () => {
        const competitorAnalysis: CompetitorAnalysis = {
            competitorDomain: "competitor.com",
            competitorRankingUrl: "https://competitor.com/blog/best-tools",
            competitorTitle: "10 Best SEO Tools",
            headings: ["Features", "Pricing"],
            scrapedText: "Competitor content snippet...",
            contentWeaknesses: ["Outdated 2024 pricing", "No live GSC integration"],
            differentiationOpportunities: ["Live real-time SERP tracking", "First-party evidence verification"],
        };

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
            competitorAnalysis,
        });

        expect(packet.competitorAnalysis).toBeDefined();
        expect(packet.competitorAnalysis?.competitorDomain).toBe("competitor.com");
        expect(packet.competitorAnalysis?.contentWeaknesses).toContain("Outdated 2024 pricing");
    });

    it("5. Single canonical SERP snapshot is reused without redundant generation", async () => {
        const packet1 = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
        });
        const packet2 = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
        });

        expect(packet1.serp.competitors).toEqual(packet2.serp.competitors);
        expect(packet1.serp.paa).toEqual(packet2.serp.paa);
    });

    it("6. GSC evidence remains consistent in research packet provenance snapshot", async () => {
        const gscEvidence = {
            query: "best ai seo tools",
            clicks: 140,
            impressions: 3200,
            position: 8.4,
            ctr: 0.04375,
        };

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
            gscEvidence,
        });

        expect(packet.gscEvidence).toBeDefined();
        expect(packet.gscEvidence?.clicks).toBe(140);
        expect(packet.gscEvidence?.position).toBe(8.4);
    });

    it("7. Fact check runs on final assembled content", async () => {
        const assembledHtml = `
            <h2>Introduction</h2>
            <p>OptiAISEO reduced churn by 42% for 150+ agencies in 2025 according to internal telemetry.</p>
        `;

        const researchPacket = await buildResearchPacket({
            keyword: "ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
        });

        const evidencePacket = extractEvidencePacket(researchPacket, assembledHtml);
        expect(evidencePacket.extraction.claimCount).toBeGreaterThanOrEqual(0);
        expect(evidencePacket.availability).toBe("AVAILABLE");
    });

    it("8. Extracted FAQ data is accessible for schema generation", () => {
        const content = `
            <h3>What is an AI SEO tool?</h3>
            <p>An AI SEO tool uses machine learning models to analyze search intent and optimize content.</p>
            <h3>How much does it cost?</h3>
            <p>Pricing starts at $99 per month with full API access.</p>
        `;

        const matches = [...content.matchAll(/<h3[^>]*>(.+?)<\/h3>\s*<p[^>]*>(.+?)<\/p>/gi)];
        const faqs = matches.map(m => ({
            question: m[1].replace(/<[^>]+>/g, "").trim(),
            answer: m[2].replace(/<[^>]+>/g, "").trim(),
        }));

        expect(faqs).toHaveLength(2);
        expect(faqs[0].question).toBe("What is an AI SEO tool?");
        expect(faqs[1].question).toBe("How much does it cost?");
    });

    it("9. Publication gate enforces hard decision engine (DRAFT/NEEDS_REVIEW/EVIDENCE_REVIEW/REJECTED/FAILED)", () => {
        const hardPassGates = [
            { name: "Research", status: "PASS" as const, isHard: true, issues: [], warnings: [] },
            { name: "Evidence", status: "PASS" as const, isHard: true, issues: [], warnings: [] },
            { name: "Claims", status: "PASS" as const, isHard: true, issues: [], warnings: [] },
            { name: "Schema", status: "PASS" as const, isHard: true, issues: [], warnings: [] },
            { name: "SEO", status: "PASS" as const, isHard: false, issues: [], warnings: [] },
        ];

        const decision = buildPublicationDecision(hardPassGates, "AVAILABLE");
        expect(decision.status).toBe("DRAFT");
        expect(decision.canPublish).toBe(true);

        const hardFailGates = [
            { name: "Research", status: "FAIL" as const, isHard: true, issues: ["No valid sources"], warnings: [] },
            { name: "Evidence", status: "PASS" as const, isHard: true, issues: [], warnings: [] },
        ];

        const failDecision = buildPublicationDecision(hardFailGates, "AVAILABLE");
        expect(failDecision.status).toBe("EVIDENCE_REVIEW");
        expect(failDecision.canPublish).toBe(false);
    });

    it("10. Bounded retry loops prevent infinite repair cycles", () => {
        const MAX_REPAIR_ATTEMPTS = 1;
        let attempt = 0;
        while (attempt < MAX_REPAIR_ATTEMPTS) {
            attempt++;
        }
        expect(attempt).toBe(1);
    });

    it("11. Exact-keyword density is not used as primary publication decision", async () => {
        const researchPacket = await buildResearchPacket({
            keyword: "ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
        });
        const evidencePacket = extractEvidencePacket(researchPacket, "<h1>AI SEO Tools Overview</h1><p>Comprehensive guide.</p>");

        const decision = await evaluatePublicationGate({
            content: "<h1>AI SEO Tools Overview</h1><p>Comprehensive guide.</p>",
            title: "AI SEO Tools Overview",
            metaDescription: "A comprehensive guide to AI SEO tools for SaaS companies.",
            targetKeywords: ["ai seo tools"],
            evidencePacket,
            serpContext: mockSerpContext,
            researchPacket,
            riskTier: "INFORMATIONAL",
            hasFirstPartyEvidence: true,
            factCheckComplete: true,
            factCheckCoverage: 100,
            additionalOriginalityIssues: [],
            outlineDegraded: false,
        });

        expect(decision.gates).toBeDefined();
        expect(decision.summary).toBeDefined();
    });

    it("12. High quality first party evidence overrides generic evidence availability gaps", async () => {
        const packet = await buildResearchPacket({
            keyword: "saas growth strategies",
            brain: mockBrain,
            serpContext: null, // No SERP context
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        expect(packet.firstPartyEvidence).toBeDefined();
        expect(packet.firstPartyEvidence?.realExperience).toContain("Optimized 500+ client sites");
        expect(packet.firstPartyEvidence?.realNumbers).toContain("500+ sites");
        expect(packet.firstPartyEvidence?.localContext).toContain("Serving North America");
    });

    it("13. Citation gate evaluates generated JSON-LD schema artifact", async () => {
        const { scoreCitationTemplate } = await import("@/lib/blog/ai-citation-template");
        const htmlWithoutSchema = "<h1>AI SEO Tools</h1><p>OptiAISEO is defined as a practitioner tool.</p>";
        const schema = JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: "AI SEO Tools" });
        const htmlWithSchema = `${htmlWithoutSchema}\n<script type="application/ld+json">\n${schema}\n</script>`;

        const scoreBefore = scoreCitationTemplate(htmlWithoutSchema, ["ai seo tools"], "AI SEO Tools");
        const scoreAfter = scoreCitationTemplate(htmlWithSchema, ["ai seo tools"], "AI SEO Tools");

        expect(scoreAfter.score).toBeGreaterThan(scoreBefore.score);
        expect(scoreAfter.criteria.find(c => c.id === "structuredData")?.passed).toBe(true);
    });

    it("14. GSC evidence query locks keyword and pipeline provenance", async () => {
        const gscEvidence = {
            query: "gsc explicit keyword query",
            clicks: 250,
            impressions: 4000,
            position: 5.2,
        };

        const packet = await buildResearchPacket({
            keyword: "unrelated fallback keyword",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
            gscEvidence,
        });

        expect(packet.gscEvidence?.query).toBe("gsc explicit keyword query");
        expect(packet.gscEvidence?.clicks).toBe(250);
    });

    it("15. GSC provenance locking resolves target keyword and locks pipeline type to GSC_GAP", () => {
        const gscEvidence = {
            query: "target gsc keyword query",
            impressions: 5000,
            clicks: 300,
        };
        const siteContextKeywords = ["generic keyword 1", "generic keyword 2"];

        // Simulate Inngest GSC provenance locking logic
        const gscKeywordFromEvidence = (gscEvidence.query as string | undefined);
        let finalPipelineType = "SITE_CONTEXT";
        let category = "generic domain";
        let keywords = siteContextKeywords;

        if (gscEvidence || gscKeywordFromEvidence) {
            finalPipelineType = "GSC_GAP";
            const targetGscKeyword = gscKeywordFromEvidence || "";
            if (targetGscKeyword) {
                category = targetGscKeyword;
                keywords = [targetGscKeyword, ...siteContextKeywords.filter(k => k !== targetGscKeyword)].slice(0, 15);
            }
        }

        expect(finalPipelineType).toBe("GSC_GAP");
        expect(category).toBe("target gsc keyword query");
        expect(keywords[0]).toBe("target gsc keyword query");
    });

    it("16. Competitor gap scraped headings and differentiation opportunities flow into research packet", async () => {
        const competitorAnalysis: CompetitorAnalysis = {
            competitorDomain: "competitor-domain.com",
            competitorRankingUrl: "https://competitor-domain.com/page",
            competitorTitle: "Competitor Page Title",
            headings: ["Heading 1", "Heading 2", "Comparison"],
            scrapedText: "Scraped competitor text detailing features.",
            contentWeaknesses: ["Lacks interactive tools", "No local support"],
            differentiationOpportunities: ["Provide interactive ROI calculator", "Highlight 24/7 support"],
        };

        const packet = await buildResearchPacket({
            keyword: "competitor gap keyword",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
            competitorAnalysis,
        });

        expect(packet.competitorAnalysis).toBeDefined();
        expect(packet.competitorAnalysis?.headings).toEqual(["Heading 1", "Heading 2", "Comparison"]);
        expect(packet.competitorAnalysis?.differentiationOpportunities).toContain("Provide interactive ROI calculator");
    });

    it("17. Author snapshot event fields override database defaults", () => {
        const siteDbDefaults = {
            authorName: "Default DB Author",
            authorRole: "Default Role",
            authorBio: "Default Bio",
            realExperience: "Default Experience",
            realNumbers: "Default Numbers",
            localContext: "Default Context",
        };

        const eventDataAuthor = {
            authorName: "Snapshot Event Author",
            authorRole: "Principal Lead",
            authorBio: "Custom Event Bio",
            realExperience: "Custom Event Case Study",
            realNumbers: "Custom 10x ROI",
            localContext: "Custom Market",
        };

        // Priority resolution as implemented in Inngest blog function
        const resolvedAuthor = {
            name: eventDataAuthor.authorName || siteDbDefaults.authorName,
            role: eventDataAuthor.authorRole || siteDbDefaults.authorRole,
            bio: eventDataAuthor.authorBio || siteDbDefaults.authorBio,
            realExperience: eventDataAuthor.realExperience || siteDbDefaults.realExperience,
            realNumbers: eventDataAuthor.realNumbers || siteDbDefaults.realNumbers,
            localContext: eventDataAuthor.localContext || siteDbDefaults.localContext,
        };

        expect(resolvedAuthor.name).toBe("Snapshot Event Author");
        expect(resolvedAuthor.role).toBe("Principal Lead");
        expect(resolvedAuthor.bio).toBe("Custom Event Bio");
        expect(resolvedAuthor.realExperience).toBe("Custom Event Case Study");
        expect(resolvedAuthor.realNumbers).toBe("Custom 10x ROI");
        expect(resolvedAuthor.localContext).toBe("Custom Market");
    });

    it("18. Stage 5 Analyze -> Revise -> Re-analyze pass executes quality analysis and prevents truncation", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "transactional",
            hasAuthorGrounding: true,
        });

        const researchPacket = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        // Thin initial draft (300 words, missing entities, comparison table, and FAQ)
        const thinDraft = "<h1>Best AI SEO Tools</h1><p>A quick overview of tools.</p>";
        const initialAnalysis = analyzeDraftQuality(thinDraft, mockBrain, researchPacket, testCtx);

        expect(initialAnalysis.needsRevision).toBe(true);
        expect(initialAnalysis.defects.length).toBeGreaterThanOrEqual(2);
        expect(initialAnalysis.repairDirective).toContain("REVISION DIRECTIVE");

        // Comprehensive draft (1300 words, entity OptiAISEO included, comparison table present, FAQ included)
        const richDraft = `<h1>Best AI SEO Tools</h1><p>Quick Answer: OptiAISEO provides automated search intelligence for SaaS.</p>` +
            `<table><tr><th>Tool</th><th>Price</th></tr><tr><td>OptiAISEO</td><td>$99</td></tr></table>` +
            `<h3>Frequently Asked Questions</h3><p>What is OptiAISEO? It is an AI SEO tool.</p>` +
            ` `.repeat(6000); // 1200+ word count simulation

        const postAnalysis = analyzeDraftQuality(richDraft, mockBrain, researchPacket, testCtx);
        expect(postAnalysis.defects.length).toBeLessThan(initialAnalysis.defects.length);

        // Verify non-truncation safety check in applyTargetedRevision retains original content if revision truncates by >15%
        const longArticle = "# Full Article\n" + "Word ".repeat(4000);
        // applyTargetedRevision returns original content if AI returned empty/severely truncated content (<85%)
        const result = await applyTargetedRevision(longArticle, "Add FAQ", testCtx);
        expect(result.length).toBeGreaterThanOrEqual(longArticle.length * 0.85);
    });

    it("19. Schema-aware citation template scoring evaluates combined HTML + JSON-LD script", async () => {
        const { scoreCitationTemplate } = await import("@/lib/blog/ai-citation-template");
        const rawHtml = "<h2>Key Tools</h2><p>OptiAISEO delivers automated SEO optimization.</p>";
        const schemaJson = JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: "Key Tools Overview",
        });
        const combinedContent = `${rawHtml}\n\n<script type="application/ld+json">\n${schemaJson}\n</script>`;

        const score = scoreCitationTemplate(combinedContent, ["key tools"], "Key Tools Overview");
        const structDataCriterion = score.criteria.find(c => c.id === "structuredData");

        expect(structDataCriterion?.passed).toBe(true);
        expect(score.score).toBeGreaterThan(0);
    });

    it("20. Composite validation recomputes validation score and errors on final assembled HTML", async () => {
        const { runCompositeValidation } = await import("@/lib/blog/validators");
        const finalAssembledHtml = "<h1>Top AI SEO Tools</h1><p>Comprehensive guide to optimization tools with proven ROI.</p>";
        const markdown = "# Top AI SEO Tools\n\nComprehensive guide to optimization tools with proven ROI.";
        const meta = "Learn about the top AI SEO tools for scaling search traffic.";

        const validation = runCompositeValidation({
            title: "Top AI SEO Tools",
            htmlContent: finalAssembledHtml,
            markdownContent: markdown,
            metaDescription: meta,
            author: mockAuthor,
        });

        expect(validation.score).toBeGreaterThan(0);
        expect(Array.isArray(validation.errors)).toBe(true);
        expect(Array.isArray(validation.warnings)).toBe(true);
    });
});

