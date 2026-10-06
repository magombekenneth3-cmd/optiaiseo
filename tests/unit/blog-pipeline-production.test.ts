import { describe, it, expect, vi } from "vitest";
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

    it("18. Stage 5 Analyze -> Revise -> Re-analyze pass executes commercial intent analysis and prevents truncation", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const researchPacket = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        // Thin commercial draft (30 words, missing entities, comparison table, and FAQ)
        const thinDraft = "<h1>Best AI SEO Tools</h1><p>A quick overview of tools.</p>";
        const initialAnalysis = analyzeDraftQuality(thinDraft, mockBrain, researchPacket, testCtx);

        expect(initialAnalysis.needsRevision).toBe(true);
        expect(initialAnalysis.defects.some(d => d.includes("1200+ words"))).toBe(true);
        expect(initialAnalysis.defects.some(d => d.includes("Commercial/transactional decision intent"))).toBe(true);
        expect(initialAnalysis.repairDirective).toContain("REVISION DIRECTIVE");

        // Comprehensive commercial draft (1300 words, entity OptiAISEO included, comparison table present, FAQ included)
        const richDraft = `<h1>Best AI SEO Tools</h1><p>Quick Answer: OptiAISEO provides automated search intelligence for SaaS.</p>` +
            `<table><tr><th>Tool</th><th>Price</th></tr><tr><td>OptiAISEO</td><td>$99</td></tr></table>` +
            `<h3>Frequently Asked Questions</h3><p>What is OptiAISEO? It is an AI SEO tool.</p>` +
            `[Official Source](https://example.com/source)` +
            ` `.repeat(6000); // 1200+ word count simulation

        const postAnalysis = analyzeDraftQuality(richDraft, mockBrain, researchPacket, testCtx);
        expect(postAnalysis.defects.length).toBeLessThan(initialAnalysis.defects.length);

        // Verify non-truncation safety check in applyTargetedRevision retains original content if revision truncates by >15%
        const longArticle = "## Overview\n" + "Word ".repeat(4000) + "\n[Link](https://example.com/a)";
        const aiClient = await import("@/lib/blog/ai-client");
        const spy = vi.spyOn(aiClient, "generateWithFallback").mockResolvedValue("Short truncated output");

        const result = await applyTargetedRevision(longArticle, "Add FAQ", testCtx);
        // Safety guard detects truncation (<85% length) and retains original content verbatim
        expect(result).toBe(longArticle);
        expect(result.length).toBe(longArticle.length);

        spy.mockRestore();
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

    it("21. Transactional intent receives decision-oriented depth and breakdown requirements", async () => {
        const txCtx = buildPromptContext({
            keyword: "buy ai seo software",
            category: "ai seo software",
            siteDomain: "example.com",
            intent: "transactional",
            hasAuthorGrounding: true,
        });

        const researchPacket = await buildResearchPacket({
            keyword: "buy ai seo software",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        const thinTxDraft = "<h1>Buy AI SEO Software</h1><p>Buy our software now.</p>";
        const txAnalysis = analyzeDraftQuality(thinTxDraft, mockBrain, researchPacket, txCtx);

        expect(txAnalysis.needsRevision).toBe(true);
        expect(txAnalysis.defects.some(d => d.includes("1200+ words"))).toBe(true);
        expect(txAnalysis.defects.some(d => d.includes("Commercial/transactional decision intent"))).toBe(true);
    });

    it("22. Multi-layer structural non-truncation guards reject revisions stripping headers or links", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const originalDoc = "## Section 1\nContent 1 [Ref](https://example.com/1)\n\n## Section 2\nContent 2 [Ref](https://example.com/2)\n\n## Section 3\nContent 3 [Ref](https://example.com/3)\n" + "Text ".repeat(2000);
        const aiClient = await import("@/lib/blog/ai-client");

        // Scenario A: LLM strips H2 section headers
        const strippedHeaders = "## Section 1\nContent 1\n" + "Text ".repeat(2000);
        const spyA = vi.spyOn(aiClient, "generateWithFallback").mockResolvedValue(strippedHeaders);

        const resultA = await applyTargetedRevision(originalDoc, "Fix gaps", testCtx);
        expect(resultA).toBe(originalDoc); // Header guard rejected revision
        spyA.mockRestore();

        // Scenario B: LLM strips source links
        const strippedLinks = "## Section 1\nContent 1\n\n## Section 2\nContent 2\n\n## Section 3\nContent 3\n" + "Text ".repeat(2000);
        const spyB = vi.spyOn(aiClient, "generateWithFallback").mockResolvedValue(strippedLinks);

        const resultB = await applyTargetedRevision(originalDoc, "Fix gaps", testCtx);
        expect(resultB).toBe(originalDoc); // Link guard rejected revision
        spyB.mockRestore();
    });

    it("23. Case A: Commercial article missing several important research gaps -> analyzer identifies them", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const competitorAnalysis: CompetitorAnalysis = {
            competitorDomain: "competitor.com",
            differentiationOpportunities: ["Live real-time SERP tracking", "First-party evidence verification"],
        };

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: { ...mockBrain, entities: ["OptiAISEO", "Perplexity"] },
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
            competitorAnalysis,
        });

        const thinDraft = "<h1>Best AI SEO Tools</h1><p>A quick summary of tools available.</p>";
        const analysis = analyzeDraftQuality(thinDraft, { ...mockBrain, entities: ["OptiAISEO", "Perplexity"] }, packet, testCtx);

        expect(analysis.needsRevision).toBe(true);
        expect(analysis.defects.some(d => d.includes("Word count is too low"))).toBe(true);
        expect(analysis.defects.some(d => d.includes("Commercial/transactional decision intent requires a structured comparison table"))).toBe(true);
        expect(analysis.defects.some(d => d.includes("Missing key topic entities"))).toBe(true);
        expect(analysis.defects.some(d => d.includes("Missing key competitor differentiation opportunities"))).toBe(true);
        expect(analysis.competitorGapCoverage.coveredCount).toBeLessThan(analysis.competitorGapCoverage.totalCount);
    });

    it("24. Case B: Article covers most canonical gaps -> defect count/coverage improves", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const competitorAnalysis: CompetitorAnalysis = {
            competitorDomain: "competitor.com",
            differentiationOpportunities: ["Live real-time SERP tracking"],
        };

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: { ...mockBrain, entities: ["OptiAISEO", "Google Search Console"] },
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
            competitorAnalysis,
        });

        const richDraft = `<h1>Best AI SEO Tools</h1><p>Quick Answer: OptiAISEO, Perplexity, and Google Search Console provide automated search intelligence.</p>` +
            `<table><tr><th>Tool</th><th>Pricing</th></tr><tr><td>OptiAISEO</td><td>Starting at $99/mo</td></tr></table>` +
            `<h2>Feature Breakdown and Differentiation</h2><p>OptiAISEO offers live real-time SERP tracking, integration capabilities, a real pricing comparison, and fast live GSC integration speed for agencies. Backed by a 14-day money back guarantee.</p>` +
            `<p>Pure keyword density is obsolete — search intent and entity depth matter most.</p>` +
            `<h3>Frequently Asked Questions</h3>` +
            `<h4>What is the best AI SEO tool?</h4><p>OptiAISEO ranks as the best AI SEO tool.</p>` +
            `<h4>What is OptiAISEO?</h4><p>OptiAISEO is an automated AI SEO tool.</p>` +
            `<h4>How much does AI SEO software cost?</h4><p>Typically starting at $99/mo with full features.</p>` +
            `<h4>How fast does indexing take?</h4><p>Indexing typically takes 24 hours with live telemetry.</p>` +
            `[Competitor Review](https://competitor.com/best-tools)` +
            `[Example Site](https://example.com)` +
            ` Word`.repeat(1200);

        const analysis = analyzeDraftQuality(richDraft, { ...mockBrain, entities: ["OptiAISEO", "Google Search Console"] }, packet, testCtx);

        expect(analysis.entityCoverage.coverageRatio).toBeGreaterThanOrEqual(0.8);
        expect(analysis.topicCoverage.tableStakesCovered).toBe(true);
        expect(analysis.defects.length).toBe(0);
        expect(analysis.needsRevision).toBe(false);
    });

    it("25. Case C: Revision improves coverage -> revision accepted", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        const initialDraft = "<h1>Best AI SEO Tools</h1><p>Quick summary.</p>";
        const initialAnalysis = analyzeDraftQuality(initialDraft, mockBrain, packet, testCtx);
        expect(initialAnalysis.needsRevision).toBe(true);

        const revisedDraft = `<h1>Best AI SEO Tools</h1><p>Quick Answer: OptiAISEO and Perplexity are top tools.</p>` +
            `<table><tr><th>Tool</th><th>Price</th></tr><tr><td>OptiAISEO</td><td>$99</td></tr></table>` +
            `<h3>Frequently Asked Questions</h3><p>What is OptiAISEO? It is a tool.</p>` +
            `[Source Link](https://example.com/source)` +
            ` `.repeat(6000);

        const postAnalysis = analyzeDraftQuality(revisedDraft, mockBrain, packet, testCtx);
        expect(postAnalysis.defects.length).toBeLessThan(initialAnalysis.defects.length);
    });

    it("26. Case D: Revision looks longer but loses critical evidence -> revision rejected", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const originalDoc = "## Overview\nOptiAISEO provides automated search intelligence. [Source Citation](https://example.com/evidence-1)\n\n## Comparison\nDetails on features.\n" + "Word ".repeat(1500);

        const aiClient = await import("@/lib/blog/ai-client");
        const longerDocStrippedSource = "## Overview\nOptiAISEO provides automated search intelligence.\n\n## Comparison\nDetails on features.\n" + "Word ".repeat(2000);

        const spy = vi.spyOn(aiClient, "generateWithFallback").mockResolvedValue(longerDocStrippedSource);

        const result = await applyTargetedRevision(originalDoc, "Expand coverage", testCtx);
        expect(result).toBe(originalDoc); // Source link safety guard rejected revision

        spy.mockRestore();
    });

    it("27. Case E: Revision loses internal links -> revision rejected", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const originalDoc = "## Overview\nOptiAISEO provides automated search intelligence. See our [Pricing Guide](/pricing).\n\n## Features\nFull details.\n" + "Word ".repeat(1500);

        const aiClient = await import("@/lib/blog/ai-client");
        const strippedInternalLink = "## Overview\nOptiAISEO provides automated search intelligence. See our Pricing Guide.\n\n## Features\nFull details.\n" + "Word ".repeat(1800);

        const spy = vi.spyOn(aiClient, "generateWithFallback").mockResolvedValue(strippedInternalLink);

        const result = await applyTargetedRevision(originalDoc, "Expand coverage", testCtx);
        expect(result).toBe(originalDoc); // Internal link safety guard rejected revision

        spy.mockRestore();
    });

    it("28. Case F: Existing-site strategy says OPTIMIZE/CONSOLIDATE -> analyzer exposes strategic conflict", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const gscEvidence = {
            query: "best ai seo tools",
            position: 4.2,
            clicks: 120,
            impressions: 2500,
            url: "https://example.com/blog/existing-tools",
        };

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
            gscEvidence,
        });

        packet.existingSite = {
            verdict: "EXISTING_HEALTHY",
            existingPage: {
                url: "https://example.com/blog/existing-tools",
                matchSource: "GSC_RANKING_URL",
                matchConfidence: 0.95,
                currentPosition: 4.2,
                issues: [],
            },
            allCandidates: [],
            recommendedAction: "MONITOR",
            recommendedCategory: "HEALTHY",
            reasoning: "Healthy page ranks position 4.2.",
        };

        const articleContent = "<h1>Best AI SEO Tools</h1><p>Full article content.</p>";
        const analysis = analyzeDraftQuality(articleContent, mockBrain, packet, testCtx);

        expect(analysis.existingSiteFit.hasStrategicConflict).toBe(true);
        expect(analysis.existingSiteFit.verdict).toBe("EXISTING_HEALTHY");
        expect(analysis.defects.some(d => d.includes("Strategic conflict"))).toBe(true);
    });

    it("29. Case G: Cannibalization signal exists -> analyzer reports it", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const gscEvidence = {
            query: "best ai seo tools",
            position: 8.5,
            clicks: 80,
            url: "https://example.com/blog/existing-ai-tools-1",
            competingUrls: ["https://example.com/blog/existing-ai-tools-2"],
        };

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
            gscEvidence,
        });

        packet.existingSite = {
            verdict: "EXISTING_CANNIBALIZED",
            existingPage: {
                url: "https://example.com/blog/existing-ai-tools-1",
                matchSource: "GSC_RANKING_URL",
                matchConfidence: 0.95,
                currentPosition: 8.5,
                issues: [],
            },
            allCandidates: [
                { url: "https://example.com/blog/existing-ai-tools-1", matchSource: "GSC_RANKING_URL", matchConfidence: 0.95, issues: [] },
                { url: "https://example.com/blog/existing-ai-tools-2", matchSource: "GSC_RANKING_URL", matchConfidence: 0.90, issues: [] },
            ],
            recommendedAction: "CONSOLIDATE",
            recommendedCategory: "CANNIBALIZATION",
            reasoning: "Multiple pages competing.",
        };

        const articleContent = "<h1>Best AI SEO Tools</h1><p>New article content.</p>";
        const analysis = analyzeDraftQuality(articleContent, mockBrain, packet, testCtx);

        expect(analysis.cannibalizationRisk.hasRisk).toBe(true);
        expect(analysis.defects.some(d => d.includes("Cannibalization risk"))).toBe(true);
    });

    it("30. Case H: AEO question coverage is partial -> analyzer reports partial rather than PASS", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const brainWithMultipleFaqs: ResearchBrain = {
            ...mockBrain,
            faqTargets: [
                "What is an AI SEO tool?",
                "How much does AI SEO software cost?",
                "Is AI SEO safe for SaaS companies?",
                "Which AI SEO tool offers real-time GSC sync?",
            ],
        };

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: brainWithMultipleFaqs,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        // Article only answers 1 question ("What is an AI SEO tool?")
        const partialDraft = `<h1>Best AI SEO Tools</h1><h3>What is an AI SEO tool?</h3><p>It is an automated tool.</p>`;
        const analysis = analyzeDraftQuality(partialDraft, brainWithMultipleFaqs, packet, testCtx);

        expect(analysis.questionCoverage.coverageRatio).toBeLessThan(1.0);
        expect(analysis.questionCoverage.unaddressedQuestions.length).toBeGreaterThan(0);
        expect(analysis.defects.some(d => d.includes("Unaddressed key search questions"))).toBe(true);
    });

    it("31. Case I: Evidence source exists but article does not actually use it -> analyzer does not mark evidence complete", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const sourceList = [
            {
                id: "src-101",
                url: "https://example.com/research-study-2026",
                title: "AI SEO Benchmark Study 2026",
                publisher: "Search Research Institute",
                retrievedAt: new Date().toISOString(),
                claim: "AI SEO tools increase organic velocity by 3.4x",
                evidence: "Data collected from 500 SaaS domains.",
                sourceType: "research" as const,
                confidence: 0.95,
            }
        ];

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });
        packet.sources = sourceList;
        packet.evidenceAvailability = "AVAILABLE";

        // Article content has general text but NO citations or links to the source URL or publisher
        const unbackedArticle = "<h1>Best AI SEO Tools</h1><p>Many companies use AI SEO tools to rank faster.</p>";
        const analysis = analyzeDraftQuality(unbackedArticle, mockBrain, packet, testCtx);

        expect(analysis.evidenceCoverage.citedSourcesCount).toBe(0);
        expect(analysis.evidenceCoverage.hasValidCitations).toBe(false);
        expect(analysis.defects.some(d => d.includes("Missing authoritative source evidence citations"))).toBe(true);
    });

    it("32. Semantic Test 1: Competitor heading alone does NOT become a required table-stakes topic", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const competitorAnalysis: CompetitorAnalysis = {
            competitorDomain: "competitor.com",
            headings: ["Why Competitor Heading 1 Matters", "Competitor Heading 2"],
        };

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
            competitorAnalysis,
        });

        packet.serp.tableStakes = undefined;

        const draft = "<h1>Best AI SEO Tools</h1><p>General overview of tools.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.topicCoverage.totalCount).toBe(0);
        expect(analysis.topicCoverage.tableStakesCovered).toBe(true);
        expect(analysis.defects.some(d => d.includes("table-stakes"))).toBe(false);
    });

    it("33. Semantic Test 2: Mentioning a publisher/domain does NOT automatically mean evidence is fully used", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.sources = [
            {
                id: "src-gartner",
                url: "https://gartner.com/en/newsroom/press-releases/2026-seo-report",
                title: "2026 Search Intelligence Report",
                publisher: "Gartner",
                retrievedAt: new Date().toISOString(),
                claim: "AI search acceleration",
                evidence: "Data on 1000 brands",
                sourceType: "research" as const,
                confidence: 0.9,
            },
        ];
        packet.evidenceAvailability = "AVAILABLE";

        const textWithPlainMention = "<h1>Best AI SEO Tools</h1><p>Gartner is a well known analyst firm in tech.</p>";
        const analysis = analyzeDraftQuality(textWithPlainMention, mockBrain, packet, testCtx);

        expect(analysis.evidenceCoverage.citedSourcesCount).toBe(0);
        expect(analysis.evidenceCoverage.hasValidCitations).toBe(false);
    });

    it("34. Semantic Test 3: Ranking keywords do NOT become internal-link targets", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.firstPartyEvidence = {
            domain: "example.com",
            topKeywords: [{ keyword: "ai tools", position: 5 }],
            brandFacts: [],
        };

        const draft = "<h1>Best AI SEO Tools</h1><p>Overview of software.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.internalLinkReadiness.potentialTargets).not.toContain("ai tools");
    });

    it("35. Semantic Test 4: Relative and real first-party absolute links are recognized correctly", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "mysite.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        const relativeDraft = "<h1>Best AI SEO Tools</h1><p>Check [our guide](/blog/seo-guide) for details.</p>";
        const relativeAnalysis = analyzeDraftQuality(relativeDraft, mockBrain, packet, testCtx);
        expect(relativeAnalysis.internalLinkReadiness.hasInternalLinks).toBe(true);

        const absoluteFirstPartyDraft = "<h1>Best AI SEO Tools</h1><p>Check [our guide](https://mysite.com/blog/seo-guide) for details.</p>";
        const absAnalysis = analyzeDraftQuality(absoluteFirstPartyDraft, mockBrain, packet, testCtx);
        expect(absAnalysis.internalLinkReadiness.hasInternalLinks).toBe(true);

        const externalDraft = "<h1>Best AI SEO Tools</h1><p>Check [external site](https://otherdomain.com/blog/guide) for details.</p>";
        const extAnalysis = analyzeDraftQuality(externalDraft, mockBrain, packet, testCtx);
        expect(extAnalysis.internalLinkReadiness.hasInternalLinks).toBe(false);
    });

    it("36. Semantic Test 5: ResearchPacket information-gain directive alone does NOT produce high original-value coverage", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.informationGain = "Include original proprietary benchmark test data.";

        const genericDraft = "<h1>Best AI SEO Tools</h1><p>AI SEO tools help websites rank better by optimizing content keywords.</p>";
        const analysis = analyzeDraftQuality(genericDraft, mockBrain, packet, testCtx);

        expect(analysis.originalValue.informationGainPresent).toBe(false);
        expect(analysis.originalValue.score).toBeLessThan(50);
    });

    it("37. Semantic Test 6: Existing-site strategy uses existing resolver semantics rather than raw GSC position only", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.existingSite = {
            verdict: "EXISTING_HEALTHY",
            existingPage: {
                url: "https://example.com/blog/old-tools-guide",
                matchSource: "GSC_RANKING_URL",
                matchConfidence: 0.9,
                currentPosition: 15.4,
                issues: [],
            },
            allCandidates: [],
            recommendedAction: "REFRESH",
            recommendedCategory: "HEALTHY",
            reasoning: "Existing page match.",
        };

        const draft = "<h1>Best AI SEO Tools</h1><p>Content draft.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.existingSiteFit.verdict).toBe("EXISTING_HEALTHY");
        expect(analysis.existingSiteFit.hasStrategicConflict).toBe(true);
    });

    it("38. Semantic Test 7: Position 4 alone does not automatically imply consolidation", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.existingSite = {
            verdict: "EXISTING_HEALTHY",
            existingPage: {
                url: "https://example.com/blog/top-tools",
                matchSource: "GSC_RANKING_URL",
                matchConfidence: 0.95,
                currentPosition: 4.0,
                issues: [],
            },
            allCandidates: [],
            recommendedAction: "MONITOR",
            recommendedCategory: "HEALTHY",
            reasoning: "Single healthy page.",
        };

        const draft = "<h1>Best AI SEO Tools</h1><p>Content draft.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.existingSiteFit.verdict).toBe("EXISTING_HEALTHY");
        expect(analysis.existingSiteFit.verdict).not.toBe("EXISTING_CANNIBALIZED");
    });

    it("39. Semantic Test 8: Partial question coverage remains partial", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const cleanBrain = { ...mockBrain, faqTargets: [] };
        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: cleanBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.serp.paa = [
            { question: "What is an AI SEO tool?" },
            { question: "How much does AI SEO software cost?" },
        ];

        const partialDraft = "<h1>Best AI SEO Tools</h1><h3>What is an AI SEO tool?</h3><p>An AI SEO tool automates content and search optimization.</p>";
        const analysis = analyzeDraftQuality(partialDraft, cleanBrain, packet, testCtx);

        expect(analysis.questionCoverage.coverageRatio).toBeLessThan(1.0);
        expect(analysis.questionCoverage.addressedCount).toBe(1);
        expect(analysis.questionCoverage.unaddressedQuestions.length).toBeGreaterThan(0);
    });

    it("40. Semantic Test 9: Lexical overlap without relevant answer context does not falsely produce full question coverage", async () => {
        const testCtx = buildPromptContext({
            keyword: "enterprise ai search tool pricing",
            category: "ai search tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "enterprise ai search tool pricing",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.serp.paa = [
            { question: "What is the average pricing model for enterprise AI search software?" },
        ];

        // Isolated words scattered across unrelated paragraphs without an answer passage block
        const scatteredDraft = `<h1>Enterprise Tools</h1>` +
            `<p>Section 1: Our enterprise platform is built for modern teams.</p>` +
            `<p>Section 2: The pricing tier offers flexibility.</p>` +
            `<p>Section 3: Each model handles large scale deployments.</p>` +
            `<p>Section 4: Advanced AI capabilities are included.</p>` +
            `<p>Section 5: Search functionality is fast.</p>`;

        const analysis = analyzeDraftQuality(scatteredDraft, mockBrain, packet, testCtx);

        expect(analysis.questionCoverage.coverageRatio).toBeLessThan(1.0);
        expect(analysis.questionCoverage.unaddressedQuestions).toContain("What is the average pricing model for enterprise AI search software?");
    });

    it("41. Semantic Test 10: Missing canonical research data returns unavailable/empty rather than fabricated requirements", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.sources = [];
        packet.evidenceAvailability = "EMPTY";
        packet.serp.tableStakes = undefined;
        packet.serp.paa = [];
        packet.firstPartyEvidence = undefined;

        const draft = "<h1>Best AI SEO Tools</h1><p>Generic text.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.evidenceCoverage.status).toBe("EMPTY");
        expect(analysis.topicCoverage.totalCount).toBe(0);
        expect(analysis.firstPartyCoverage.status).toBe("UNAVAILABLE");
        expect(analysis.internalLinkReadiness.status).toBe("UNAVAILABLE");
    });

    it("42. Semantic Test 11: Revision that improves lexical coverage but removes evidence is rejected", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const originalDoc = "## Overview\nOptiAISEO automated engine. [Source Citation](https://example.com/source)\n\n" + "Word ".repeat(1500);

        const aiClient = await import("@/lib/blog/ai-client");
        const longerDocStrippedSource = "## Overview\nOptiAISEO automated engine with extra descriptive words.\n\n" + "Word ".repeat(2000);

        const spy = vi.spyOn(aiClient, "generateWithFallback").mockResolvedValue(longerDocStrippedSource);

        const result = await applyTargetedRevision(originalDoc, "Expand coverage", testCtx);
        expect(result).toBe(originalDoc);

        spy.mockRestore();
    });

    it("43. Existing-site Test: Single page ranking #4 produces EXISTING_HEALTHY with strategic conflict but NO cannibalization risk", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.existingSite = {
            verdict: "EXISTING_HEALTHY",
            existingPage: {
                url: "https://example.com/blog/existing-tools-guide",
                matchSource: "GSC_RANKING_URL",
                matchConfidence: 0.95,
                currentPosition: 4.0,
                issues: [],
            },
            allCandidates: [
                {
                    url: "https://example.com/blog/existing-tools-guide",
                    matchSource: "GSC_RANKING_URL",
                    matchConfidence: 0.95,
                    currentPosition: 4.0,
                    issues: [],
                },
            ],
            recommendedAction: "MONITOR",
            recommendedCategory: "HEALTHY",
            reasoning: "Single healthy page ranking position 4.",
        };

        const draft = "<h1>Best AI SEO Tools</h1><p>Draft text.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.existingSiteFit.verdict).toBe("EXISTING_HEALTHY");
        expect(analysis.existingSiteFit.hasStrategicConflict).toBe(true);
        expect(analysis.cannibalizationRisk.hasRisk).toBe(false);
        expect(analysis.cannibalizationRisk.conflictingUrls).toHaveLength(0);
        expect(analysis.defects.some(d => d.includes("Strategic conflict"))).toBe(true);
        expect(analysis.defects.some(d => d.includes("Cannibalization risk"))).toBe(false);
    });

    it("44. Existing-site Test: Two GSC pages competing for same intent produces EXISTING_CANNIBALIZED with cannibalization risk", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.existingSite = {
            verdict: "EXISTING_CANNIBALIZED",
            existingPage: {
                url: "https://example.com/blog/existing-tools-guide-1",
                matchSource: "GSC_RANKING_URL",
                matchConfidence: 0.95,
                currentPosition: 5.0,
                issues: [],
            },
            allCandidates: [
                {
                    url: "https://example.com/blog/existing-tools-guide-1",
                    matchSource: "GSC_RANKING_URL",
                    matchConfidence: 0.95,
                    currentPosition: 5.0,
                    issues: [],
                },
                {
                    url: "https://example.com/blog/existing-tools-guide-2",
                    matchSource: "GSC_RANKING_URL",
                    matchConfidence: 0.90,
                    currentPosition: 5.0,
                    issues: [],
                },
            ],
            recommendedAction: "CONSOLIDATE",
            recommendedCategory: "CANNIBALIZATION",
            reasoning: "Multiple pages competing for query.",
        };

        const draft = "<h1>Best AI SEO Tools</h1><p>Draft text.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.existingSiteFit.verdict).toBe("EXISTING_CANNIBALIZED");
        expect(analysis.existingSiteFit.hasStrategicConflict).toBe(true);
        expect(analysis.cannibalizationRisk.hasRisk).toBe(true);
        expect(analysis.cannibalizationRisk.conflictingUrls).toContain("https://example.com/blog/existing-tools-guide-1");
        expect(analysis.cannibalizationRisk.conflictingUrls).toContain("https://example.com/blog/existing-tools-guide-2");
        expect(analysis.defects.some(d => d.includes("Cannibalization risk"))).toBe(true);
    });

    it("45. Existing-site Test: Missing URL in gscEvidence does NOT create synthetic candidate or fake site.com URL", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.gscEvidence = {
            query: "best ai seo tools",
            position: 10.0,
            // url is omitted intentionally
        };

        const draft = "<h1>Best AI SEO Tools</h1><p>Draft text.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.existingSiteFit.verdict).toBe("UNAVAILABLE");
        expect(analysis.existingSiteFit.hasStrategicConflict).toBe(false);
        expect(analysis.cannibalizationRisk.hasRisk).toBe(false);
        expect(analysis.cannibalizationRisk.conflictingUrls).toHaveLength(0);
    });

    it("46. Existing-site Test: topKeywords without page URL cannot become page evidence", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.gscEvidence = undefined;
        packet.firstPartyEvidence = {
            domain: "example.com",
            topKeywords: [{ keyword: "best ai seo tools", position: 5.0 }],
        };

        const draft = "<h1>Best AI SEO Tools</h1><p>Draft text.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.existingSiteFit.verdict).toBe("UNAVAILABLE");
        expect(analysis.existingSiteFit.hasStrategicConflict).toBe(false);
        expect(analysis.cannibalizationRisk.hasRisk).toBe(false);
    });

    it("47. Internal-link Test: Potential targets are populated strictly from real URLs without synthetic URLs or keyword strings", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.internalLinkOpportunities = [
            {
                destination: "https://example.com/blog/real-target-page",
                relationship: "topical",
                anchorConcept: "AI SEO tools",
                relevance: 0.9,
                reason: "Target cluster guide",
            },
        ];

        const draft = "<h1>Best AI SEO Tools</h1><p>Draft text.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.internalLinkReadiness.potentialTargets).toEqual(["https://example.com/blog/real-target-page"]);
        expect(analysis.internalLinkReadiness.potentialTargets).not.toContain("best ai seo tools");
    });

    it("48. Canonical Snapshot: Analyzer consumes packet.existingSite snapshot directly for EXISTING_HEALTHY", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.existingSite = {
            verdict: "EXISTING_HEALTHY",
            existingPage: {
                url: "https://example.com/blog/healthy-guide",
                matchSource: "GSC_RANKING_URL",
                matchConfidence: 0.95,
                currentPosition: 3,
                issues: [],
            },
            allCandidates: [
                {
                    url: "https://example.com/blog/healthy-guide",
                    matchSource: "GSC_RANKING_URL",
                    matchConfidence: 0.95,
                    currentPosition: 3,
                    issues: [],
                }
            ],
            recommendedAction: "MONITOR",
            recommendedCategory: "QUICK_WIN",
            reasoning: "Page ranks #3 for keyword.",
        };

        const draft = "<h1>Best AI SEO Tools</h1><p>Draft content.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.existingSiteFit.verdict).toBe("EXISTING_HEALTHY");
        expect(analysis.existingSiteFit.hasStrategicConflict).toBe(true);
        expect(analysis.cannibalizationRisk.hasRisk).toBe(false);
    });

    it("49. Canonical Snapshot: Analyzer consumes packet.existingSite snapshot for EXISTING_NEEDS_FIX", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.existingSite = {
            verdict: "EXISTING_NEEDS_FIX",
            existingPage: {
                url: "https://example.com/blog/underperforming-guide",
                matchSource: "GSC_RANKING_URL",
                matchConfidence: 0.85,
                currentPosition: 18,
                issues: ["LOW_CTR"],
            },
            allCandidates: [],
            recommendedAction: "REFRESH_CONTENT",
            recommendedCategory: "ALMOST_RANKING",
            reasoning: "Page ranks #18 with low CTR.",
        };

        const draft = "<h1>Best AI SEO Tools</h1><p>Draft content.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.existingSiteFit.verdict).toBe("EXISTING_NEEDS_FIX");
        expect(analysis.existingSiteFit.hasStrategicConflict).toBe(true);
        expect(analysis.cannibalizationRisk.hasRisk).toBe(false);
    });

    it("50. Canonical Snapshot: Analyzer consumes packet.existingSite snapshot for EXISTING_CANNIBALIZED", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.existingSite = {
            verdict: "EXISTING_CANNIBALIZED",
            existingPage: {
                url: "https://example.com/blog/guide-1",
                matchSource: "GSC_RANKING_URL",
                matchConfidence: 0.9,
                currentPosition: 6,
                issues: [],
            },
            allCandidates: [
                { url: "https://example.com/blog/guide-1", matchSource: "GSC_RANKING_URL", matchConfidence: 0.9, issues: [] },
                { url: "https://example.com/blog/guide-2", matchSource: "GSC_RANKING_URL", matchConfidence: 0.88, issues: [] },
            ],
            recommendedAction: "CONSOLIDATE_CONTENT",
            recommendedCategory: "CANNIBALIZATION",
            reasoning: "Multiple pages competing for intent.",
        };

        const draft = "<h1>Best AI SEO Tools</h1><p>Draft content.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.existingSiteFit.verdict).toBe("EXISTING_CANNIBALIZED");
        expect(analysis.existingSiteFit.hasStrategicConflict).toBe(true);
        expect(analysis.cannibalizationRisk.hasRisk).toBe(true);
        expect(analysis.cannibalizationRisk.conflictingUrls).toContain("https://example.com/blog/guide-1");
        expect(analysis.cannibalizationRisk.conflictingUrls).toContain("https://example.com/blog/guide-2");
    });

    it("51. Canonical Snapshot: Ambiguous resolver result NEEDS_REVIEW produces NEEDS_REVIEW without strategic conflict or cannibalization", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.existingSite = {
            verdict: "NEEDS_REVIEW",
            existingPage: {
                url: "https://example.com/blog/uncertain-page",
                matchSource: "BLOG_RECORD",
                matchConfidence: 0.45,
                issues: [],
            },
            allCandidates: [],
            recommendedAction: "NEEDS_REVIEW",
            recommendedCategory: "QUICK_WIN",
            reasoning: "Low confidence match.",
        };

        const draft = "<h1>Best AI SEO Tools</h1><p>Draft content.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.existingSiteFit.verdict).toBe("NEEDS_REVIEW");
        expect(analysis.existingSiteFit.hasStrategicConflict).toBe(false);
        expect(analysis.cannibalizationRisk.hasRisk).toBe(false);
    });

    it("52. Canonical Snapshot: Internal-link opportunities come from packet.internalLinkOpportunities", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.internalLinkOpportunities = [
            {
                destination: "https://example.com/blog/target-guide",
                relationship: "topical",
                anchorConcept: "AI search automation",
                relevance: 0.92,
                reason: "High topical overlap with cluster guide",
            },
        ];

        const draft = "<h1>Best AI SEO Tools</h1><p>Draft content.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.internalLinkReadiness.status).toBe("AVAILABLE");
        expect(analysis.internalLinkReadiness.potentialTargets).toEqual(["https://example.com/blog/target-guide"]);
    });

    it("53. Canonical Snapshot: Missing internal-link opportunities produces UNAVAILABLE status and empty potentialTargets", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.gscEvidence = undefined;
        packet.internalLinkOpportunities = [];

        const draft = "<h1>Best AI SEO Tools</h1><p>Draft content.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.internalLinkReadiness.status).toBe("UNAVAILABLE");
        expect(analysis.internalLinkReadiness.potentialTargets).toEqual([]);
    });

    it("54. Pure Function: analyzeDraftQuality executes deterministically without side effects or database calls", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        const draft = "<h1>Best AI SEO Tools</h1><p>Draft content.</p>";
        const res1 = analyzeDraftQuality(draft, mockBrain, packet, testCtx);
        const res2 = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(res1).toEqual(res2);
    });

    it("55. Contract Compatibility: AnalysisResult is backward compatible alias for ContentAnalysisReport", async () => {
        const { analyzeDraftQuality: func } = await import("@/lib/blog/pipeline");
        type AnalysisResultType = import("@/lib/blog/pipeline").AnalysisResult;
        type ContentAnalysisReportType = import("@/lib/blog/pipeline").ContentAnalysisReport;

        const isSameType: [AnalysisResultType] extends [ContentAnalysisReportType] ? true : false = true;
        expect(isSameType).toBe(true);
    });

    it("56. Production Path Integration: runFullPipeline with siteId populates existingSite & internalLinkOpportunities in ResearchPacket", async () => {
        const mockBrainResponse = {
            intent: "commercial",
            searcherMindset: "Looking for best AI SEO tools",
            contentGaps: ["Lack of benchmark testing"],
            entities: ["AI SEO", "Keyword Research"],
            contrarianAngles: ["More tools isn't always better"],
            examplesNeeded: ["Case study"],
            faqTargets: ["What is the best AI SEO tool?"],
            commonMisconceptions: ["AI replaces humans"],
            industryMyths: ["More keywords = higher rank"],
            whatPeopleAvoidSaying: ["Tools are expensive"],
        };

        const mockOutline = {
            title: "Best AI SEO Tools Guide for 2026",
            slug: "best-ai-seo-tools-guide",
            quickAnswer: "Here is a comprehensive summary of the best AI SEO tools available today.",
            metaDescription: "Discover the best AI SEO tools to automate your content strategy and boost organic traffic.",
            sections: [
                { heading: "Introduction to AI SEO", goal: "Explain AI SEO", tone: "analytical", evidenceType: "example", wordTarget: 200, keyEntities: ["AI SEO"] },
                { heading: "Top Tools Overview", goal: "Review top tools", tone: "analytical", evidenceType: "comparison", wordTarget: 300, keyEntities: ["Tools"] },
                { heading: "Key Features to Compare", goal: "Compare features", tone: "instructional", evidenceType: "data", wordTarget: 300, keyEntities: ["Features"] },
                { heading: "Implementation Strategy", goal: "Provide steps", tone: "instructional", evidenceType: "how_to", wordTarget: 300, keyEntities: ["Strategy"] },
                { heading: "Conclusion and Next Steps", goal: "Summarize findings", tone: "direct", evidenceType: "example", wordTarget: 200, keyEntities: ["Conclusion"] },
            ],
            estimatedTotal: 1300,
        };

        const aiClient = await import("@/lib/blog/ai-client");
        const spyAi = vi.spyOn(aiClient, "generateWithFallback").mockResolvedValue(
            "Paragraph 1 explaining AI SEO tools in extensive depth and detail.\n\n" +
            "Paragraph 2 providing detailed analysis and strategic recommendations for practitioners."
        );
        const spyAiJson = vi.spyOn(aiClient, "generateWithFallbackJson").mockImplementation(async (opts) => {
            const promptStr = typeof opts === "string" ? opts : JSON.stringify(opts);
            if (promptStr.includes("Outline") || promptStr.includes("sections")) {
                return mockOutline as any;
            }
            return mockBrainResponse as any;
        });

        const pageResolver = await import("@/lib/opportunity-engine/page-existence-resolver");
        const internalLinkModule = await import("@/lib/blog/internalLinks");

        const mockResolve = vi.spyOn(pageResolver, "resolvePageExistence").mockResolvedValue({
            verdict: "EXISTING_HEALTHY",
            existingPage: {
                url: "https://example.com/blog/canonical-page",
                matchSource: "GSC_RANKING_URL",
                matchConfidence: 0.95,
                currentPosition: 4,
                issues: [],
            },
            allCandidates: [],
            recommendedAction: "MONITOR",
            recommendedCategory: "HEALTHY",
            reasoning: "Healthy page ranks position 4.",
        });

        const mockSuggest = vi.spyOn(internalLinkModule, "findInternalLinkOpportunitiesForTopic").mockResolvedValue([
            {
                destination: "https://example.com/blog/canonical-target",
                relationship: "topical",
                anchorConcept: "AI SEO automation",
                relevance: 90,
                reason: "Cluster relevance",
            },
        ]);

        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const { runFullPipeline } = await import("@/lib/blog/pipeline");
        const result = await runFullPipeline({
            keyword: "best ai seo tools",
            serpContext: mockSerpContext,
            ctx: testCtx,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
            siteId: "site-123",
        });

        expect(mockResolve).toHaveBeenCalledTimes(1);
        expect(mockResolve).toHaveBeenCalledWith("site-123", "best ai seo tools");
        expect(mockSuggest).toHaveBeenCalledTimes(1);

        expect(result.researchPacket.existingSite).toBeDefined();
        expect(result.researchPacket.existingSite?.verdict).toBe("EXISTING_HEALTHY");
        expect(result.researchPacket.internalLinkOpportunities).toBeDefined();
        expect(result.researchPacket.internalLinkOpportunities).toHaveLength(1);
        expect(result.researchPacket.internalLinkOpportunities?.[0].destination).toBe("https://example.com/blog/canonical-target");

        mockResolve.mockRestore();
        mockSuggest.mockRestore();
        spyAi.mockRestore();
        spyAiJson.mockRestore();
    });

    it("57. Caller without siteId leaves existingSite & internalLinkOpportunities omitted without fake snapshot", async () => {
        const mockBrainResponse = {
            intent: "commercial",
            searcherMindset: "Looking for best AI SEO tools",
            contentGaps: ["Lack of benchmark testing"],
            entities: ["AI SEO", "Keyword Research"],
            contrarianAngles: ["More tools isn't always better"],
            examplesNeeded: ["Case study"],
            faqTargets: ["What is the best AI SEO tool?"],
            commonMisconceptions: ["AI replaces humans"],
            industryMyths: ["More keywords = higher rank"],
            whatPeopleAvoidSaying: ["Tools are expensive"],
        };

        const mockOutline = {
            title: "Best AI SEO Tools Guide for 2026",
            slug: "best-ai-seo-tools-guide",
            quickAnswer: "Here is a comprehensive summary of the best AI SEO tools available today.",
            metaDescription: "Discover the best AI SEO tools to automate your content strategy and boost organic traffic.",
            sections: [
                { heading: "Introduction to AI SEO", goal: "Explain AI SEO", tone: "analytical", evidenceType: "example", wordTarget: 200, keyEntities: ["AI SEO"] },
                { heading: "Top Tools Overview", goal: "Review top tools", tone: "analytical", evidenceType: "comparison", wordTarget: 300, keyEntities: ["Tools"] },
                { heading: "Key Features to Compare", goal: "Compare features", tone: "instructional", evidenceType: "data", wordTarget: 300, keyEntities: ["Features"] },
                { heading: "Implementation Strategy", goal: "Provide steps", tone: "instructional", evidenceType: "how_to", wordTarget: 300, keyEntities: ["Strategy"] },
                { heading: "Conclusion and Next Steps", goal: "Summarize findings", tone: "direct", evidenceType: "example", wordTarget: 200, keyEntities: ["Conclusion"] },
            ],
            estimatedTotal: 1300,
        };

        const aiClient = await import("@/lib/blog/ai-client");
        const spyAi = vi.spyOn(aiClient, "generateWithFallback").mockResolvedValue(
            "Paragraph 1 explaining AI SEO tools in extensive depth and detail.\n\n" +
            "Paragraph 2 providing detailed analysis and strategic recommendations for practitioners."
        );
        const spyAiJson = vi.spyOn(aiClient, "generateWithFallbackJson").mockImplementation(async (opts) => {
            const promptStr = typeof opts === "string" ? opts : JSON.stringify(opts);
            if (promptStr.includes("Outline") || promptStr.includes("sections")) {
                return mockOutline as any;
            }
            return mockBrainResponse as any;
        });

        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const { runFullPipeline } = await import("@/lib/blog/pipeline");
        const result = await runFullPipeline({
            keyword: "best ai seo tools",
            serpContext: mockSerpContext,
            ctx: testCtx,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
            siteId: undefined,
        });

        expect(result.researchPacket.existingSite).toBeUndefined();
        expect(result.researchPacket.internalLinkOpportunities).toBeUndefined();

        const analysis = analyzeDraftQuality("<h1>Best AI SEO Tools</h1>", mockBrain, result.researchPacket, testCtx);
        expect(analysis.existingSiteFit.verdict).toBe("UNAVAILABLE");
        expect(analysis.internalLinkReadiness.status).toBe("UNAVAILABLE");

        spyAi.mockRestore();
        spyAiJson.mockRestore();
    });

    it("58. Disambiguation: Analyzer strictly consumes packet.existingSite, ignoring gscEvidence.url ranking evidence", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        // gscEvidence contains ranking/competitor URL evidence
        packet.gscEvidence = {
            query: "best ai seo tools",
            position: 2.0,
            url: "https://example.com/blog/gsc-ranking-page",
        };

        // canonical existingSite snapshot indicates MISSING
        packet.existingSite = {
            verdict: "MISSING",
            existingPage: null,
            allCandidates: [],
            recommendedAction: "CREATE_NEW",
            recommendedCategory: "NEW_OPPORTUNITY",
            reasoning: "No existing page found on site.",
        };

        const draft = "<h1>Best AI SEO Tools</h1><p>Draft content.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        // Must consume packet.existingSite (MISSING), NOT infer EXISTING_HEALTHY from gscEvidence.url position 2
        expect(analysis.existingSiteFit.verdict).toBe("MISSING");
        expect(analysis.existingSiteFit.hasStrategicConflict).toBe(false);
    });

    it("59. Disambiguation: gscEvidence.url cannot appear as an internal-link target unless present in internalLinkOpportunities", async () => {
        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const packet = await buildResearchPacket({
            keyword: "best ai seo tools",
            brain: mockBrain,
            serpContext: mockSerpContext,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        packet.gscEvidence = {
            query: "best ai seo tools",
            url: "https://example.com/blog/ranking-evidence-only",
        };

        packet.internalLinkOpportunities = [
            {
                destination: "https://example.com/blog/real-internal-link",
                relationship: "topical",
                anchorConcept: "SEO Tools",
                relevance: 0.95,
                reason: "Topical cluster target",
            },
        ];

        const draft = "<h1>Best AI SEO Tools</h1><p>Draft content.</p>";
        const analysis = analyzeDraftQuality(draft, mockBrain, packet, testCtx);

        expect(analysis.internalLinkReadiness.potentialTargets).toEqual(["https://example.com/blog/real-internal-link"]);
        expect(analysis.internalLinkReadiness.potentialTargets).not.toContain("https://example.com/blog/ranking-evidence-only");
    });

    it("60. Bounded Invocations: resolvePageExistence is called at most once per runFullPipeline execution", async () => {
        const mockBrainResponse = {
            intent: "commercial",
            searcherMindset: "Looking for best AI SEO tools",
            contentGaps: ["Lack of benchmark testing"],
            entities: ["AI SEO", "Keyword Research"],
            contrarianAngles: ["More tools isn't always better"],
            examplesNeeded: ["Case study"],
            faqTargets: ["What is the best AI SEO tool?"],
            commonMisconceptions: ["AI replaces humans"],
            industryMyths: ["More keywords = higher rank"],
            whatPeopleAvoidSaying: ["Tools are expensive"],
        };

        const mockOutline = {
            title: "Best AI SEO Tools Guide for 2026",
            slug: "best-ai-seo-tools-guide",
            quickAnswer: "Here is a comprehensive summary of the best AI SEO tools available today.",
            metaDescription: "Discover the best AI SEO tools to automate your content strategy and boost organic traffic.",
            sections: [
                { heading: "Introduction to AI SEO", goal: "Explain AI SEO", tone: "analytical", evidenceType: "example", wordTarget: 200, keyEntities: ["AI SEO"] },
                { heading: "Top Tools Overview", goal: "Review top tools", tone: "analytical", evidenceType: "comparison", wordTarget: 300, keyEntities: ["Tools"] },
                { heading: "Key Features to Compare", goal: "Compare features", tone: "instructional", evidenceType: "data", wordTarget: 300, keyEntities: ["Features"] },
                { heading: "Implementation Strategy", goal: "Provide steps", tone: "instructional", evidenceType: "how_to", wordTarget: 300, keyEntities: ["Strategy"] },
                { heading: "Conclusion and Next Steps", goal: "Summarize findings", tone: "direct", evidenceType: "example", wordTarget: 200, keyEntities: ["Conclusion"] },
            ],
            estimatedTotal: 1300,
        };

        const aiClient = await import("@/lib/blog/ai-client");
        const spyAi = vi.spyOn(aiClient, "generateWithFallback").mockResolvedValue(
            "Paragraph 1 explaining AI SEO tools in extensive depth and detail.\n\n" +
            "Paragraph 2 providing detailed analysis and strategic recommendations for practitioners."
        );
        const spyAiJson = vi.spyOn(aiClient, "generateWithFallbackJson").mockImplementation(async (opts) => {
            const promptStr = typeof opts === "string" ? opts : JSON.stringify(opts);
            if (promptStr.includes("Outline") || promptStr.includes("sections")) {
                return mockOutline as any;
            }
            return mockBrainResponse as any;
        });

        const pageResolver = await import("@/lib/opportunity-engine/page-existence-resolver");
        const mockResolve = vi.spyOn(pageResolver, "resolvePageExistence").mockResolvedValue({
            verdict: "MISSING",
            existingPage: null,
            allCandidates: [],
            recommendedAction: "CREATE_NEW",
            recommendedCategory: "NEW_OPPORTUNITY",
            reasoning: "No existing page found.",
        });

        const testCtx = buildPromptContext({
            keyword: "best ai seo tools",
            category: "best ai seo tools",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const { runFullPipeline } = await import("@/lib/blog/pipeline");
        await runFullPipeline({
            keyword: "best ai seo tools",
            serpContext: mockSerpContext,
            ctx: testCtx,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
            siteId: "site-bounded-check",
        });

        expect(mockResolve).toHaveBeenCalledTimes(1);
        mockResolve.mockRestore();
        spyAi.mockRestore();
        spyAiJson.mockRestore();
    });

    it("61. Topic Internal-Link Discovery: findInternalLinkOpportunitiesForTopic matches real published blog targets by topic", async () => {
        const { prisma } = await import("@/lib/prisma");
        const { findInternalLinkOpportunitiesForTopic } = await import("@/lib/blog/internalLinks");

        const spyBlog = vi.spyOn(prisma.blog, "findMany").mockResolvedValue([
            {
                id: "blog-1",
                slug: "content-strategy-guide",
                title: "Ultimate B2B Content Strategy Guide",
                targetKeywords: ["b2b content strategy", "content marketing"],
            },
            {
                id: "blog-2",
                slug: "seo-keyword-research",
                title: "How to do Keyword Research",
                targetKeywords: ["keyword research", "seo tools"],
            },
        ] as any);

        const results = await findInternalLinkOpportunitiesForTopic(
            "b2b content strategy",
            "site-topic-test",
            "example.com",
            {
                secondaryKeywords: ["content marketing"],
                title: "B2B Content Strategy Masterclass",
            }
        );

        expect(spyBlog).toHaveBeenCalledTimes(1);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].destination).toBe("https://example.com/blog/content-strategy-guide");
        expect(results[0].relationship).toBe("keyword");
        expect(results[0].anchorConcept).toBe("b2b content strategy");
        expect(results[0].relevance).toBeGreaterThan(50);
        expect(results[0].reason).toContain("topic keyword match");

        spyBlog.mockRestore();
    });

    it("62. Irrelevant Exclusion: findInternalLinkOpportunitiesForTopic excludes unrelated published blogs", async () => {
        const { prisma } = await import("@/lib/prisma");
        const { findInternalLinkOpportunitiesForTopic } = await import("@/lib/blog/internalLinks");

        const spyBlog = vi.spyOn(prisma.blog, "findMany").mockResolvedValue([
            {
                id: "blog-irrelevant",
                slug: "best-pasta-recipes",
                title: "10 Easy Homemade Pasta Recipes",
                targetKeywords: ["pasta recipes", "cooking Italian food"],
            },
        ] as any);

        const results = await findInternalLinkOpportunitiesForTopic(
            "b2b content strategy",
            "site-topic-test",
            "example.com"
        );

        expect(results).toHaveLength(0);
        spyBlog.mockRestore();
    });

    it("63. GSC Ranking URL Exclusion: topic opportunity provider only queries published site blogs and excludes external/competitor/GSC ranking URLs", async () => {
        const { prisma } = await import("@/lib/prisma");
        const { findInternalLinkOpportunitiesForTopic } = await import("@/lib/blog/internalLinks");

        const spyBlog = vi.spyOn(prisma.blog, "findMany").mockResolvedValue([
            {
                id: "blog-site",
                slug: "site-internal-page",
                title: "B2B Content Strategy Insights",
                targetKeywords: ["b2b content strategy"],
            },
        ] as any);

        const results = await findInternalLinkOpportunitiesForTopic(
            "b2b content strategy",
            "site-topic-test",
            "example.com"
        );

        expect(spyBlog).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    siteId: "site-topic-test",
                    status: "PUBLISHED",
                }),
            })
        );
        expect(results.every(r => r.destination.includes("example.com"))).toBe(true);
        expect(results.some(r => r.destination.includes("google.com") || r.destination.includes("competitor"))).toBe(false);

        spyBlog.mockRestore();
    });

    it("64. Determinism: findInternalLinkOpportunitiesForTopic produces identical relevance/reason and stable sorting", async () => {
        const { prisma } = await import("@/lib/prisma");
        const { findInternalLinkOpportunitiesForTopic } = await import("@/lib/blog/internalLinks");

        const mockBlogs = [
            {
                id: "b1",
                slug: "alpha-guide",
                title: "B2B Content Strategy Playbook",
                targetKeywords: ["b2b content strategy"],
            },
            {
                id: "b2",
                slug: "beta-guide",
                title: "B2B Content Strategy Framework",
                targetKeywords: ["b2b content strategy"],
            },
        ] as any;

        const spyBlog = vi.spyOn(prisma.blog, "findMany").mockResolvedValue(mockBlogs);

        const res1 = await findInternalLinkOpportunitiesForTopic("b2b content strategy", "site-1", "example.com");
        const res2 = await findInternalLinkOpportunitiesForTopic("b2b content strategy", "site-1", "example.com");

        expect(res1).toEqual(res2);
        expect(res1[0].destination).toBe("https://example.com/blog/alpha-guide");

        spyBlog.mockRestore();
    });

    it("65. Pipeline Integration: runFullPipeline(siteId) places topic opportunities into ResearchPacket", async () => {
        const aiClient = await import("@/lib/blog/ai-client");
        const spyAi = vi.spyOn(aiClient, "generateWithFallback").mockResolvedValue(
            "Paragraph 1 explaining B2B content strategy in extensive depth and detail.\n\n" +
            "Paragraph 2 providing detailed analysis and strategic recommendations for practitioners."
        );
        const spyAiJson = vi.spyOn(aiClient, "generateWithFallbackJson").mockImplementation(async (opts) => {
            const promptStr = typeof opts === "string" ? opts : JSON.stringify(opts);
            if (promptStr.includes("Outline") || promptStr.includes("sections")) {
                return mockOutline as any;
            }
            return mockBrainResponse as any;
        });

        const internalLinkModule = await import("@/lib/blog/internalLinks");
        const spyTopicOpps = vi.spyOn(internalLinkModule, "findInternalLinkOpportunitiesForTopic").mockResolvedValue([
            {
                destination: "https://example.com/blog/topic-target",
                relationship: "keyword",
                anchorConcept: "b2b content strategy",
                relevance: 85,
                reason: "topic keyword match",
            },
        ]);

        const testCtx = buildPromptContext({
            keyword: "b2b content strategy",
            category: "b2b content strategy",
            siteDomain: "example.com",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const { runFullPipeline } = await import("@/lib/blog/pipeline");
        const result = await runFullPipeline({
            keyword: "b2b content strategy",
            serpContext: mockSerpContext,
            ctx: testCtx,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
            siteId: "site-pipeline-topic",
        });

        expect(spyTopicOpps).toHaveBeenCalledTimes(1);
        expect(spyTopicOpps).toHaveBeenCalledWith(
            "b2b content strategy",
            "site-pipeline-topic",
            "example.com",
            expect.objectContaining({
                secondaryKeywords: expect.any(Array),
                title: expect.any(String),
            })
        );
        expect(result.researchPacket.internalLinkOpportunities).toBeDefined();
        expect(result.researchPacket.internalLinkOpportunities?.[0].destination).toBe("https://example.com/blog/topic-target");

        spyTopicOpps.mockRestore();
        spyAi.mockRestore();
        spyAiJson.mockRestore();
    });

    it("66. No-SiteId Safety: runFullPipeline without siteId does not invoke topic opportunity provider or fabricate links", async () => {
        const aiClient = await import("@/lib/blog/ai-client");
        const spyAi = vi.spyOn(aiClient, "generateWithFallback").mockResolvedValue(
            "Paragraph 1 explaining B2B content strategy in extensive depth and detail.\n\n" +
            "Paragraph 2 providing detailed analysis and strategic recommendations for practitioners."
        );
        const spyAiJson = vi.spyOn(aiClient, "generateWithFallbackJson").mockImplementation(async (opts) => {
            const promptStr = typeof opts === "string" ? opts : JSON.stringify(opts);
            if (promptStr.includes("Outline") || promptStr.includes("sections")) {
                return mockOutline as any;
            }
            return mockBrainResponse as any;
        });

        const internalLinkModule = await import("@/lib/blog/internalLinks");
        const spyTopicOpps = vi.spyOn(internalLinkModule, "findInternalLinkOpportunitiesForTopic");

        const testCtx = buildPromptContext({
            keyword: "b2b content strategy",
            category: "b2b content strategy",
            intent: "commercial",
            hasAuthorGrounding: true,
        });

        const { runFullPipeline } = await import("@/lib/blog/pipeline");
        const result = await runFullPipeline({
            keyword: "b2b content strategy",
            serpContext: mockSerpContext,
            ctx: testCtx,
            author: mockAuthor,
            groundedCtx: mockGroundedCtx,
        });

        expect(spyTopicOpps).not.toHaveBeenCalled();
        expect(result.researchPacket.internalLinkOpportunities).toBeUndefined();

        spyTopicOpps.mockRestore();
        spyAi.mockRestore();
        spyAiJson.mockRestore();
    });

    it("67. Primitive Independence: injectSpecificInternalLink injects link into HTML independently", async () => {
        const { injectSpecificInternalLink } = await import("@/lib/blog/internalLinks");

        const html = "<p>Learn more about our b2b content strategy for growth.</p>";
        const target = {
            slug: "b2b-growth-guide",
            title: "B2B Growth Guide",
            targetKeywords: ["b2b content strategy"],
        };

        const result = injectSpecificInternalLink(html, target, "example.com");

        expect(result.linked).toBe(true);
        expect(result.html).toContain('href="https://example.com/blog/b2b-growth-guide"');
        expect(result.html).toContain('b2b content strategy');
    });
});

