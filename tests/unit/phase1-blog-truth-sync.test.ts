import { describe, expect, it } from "vitest";
import { getFunnelForIntent, hasFunnelCta, injectFunnelCta } from "@/lib/aeo/funnels";
import { normalizeCitationCriteria, type CitationCriterion } from "@/lib/blog/ai-citation-template";
import { extractEvidencePacket } from "@/lib/blog/evidence-extractor";
import { evaluatePublicationGate } from "@/lib/blog/publication-gate";
import {
    buildReconstructedResearchPacket,
    evaluateBlogPostState,
    findUnresolvedPlaceholders,
} from "@/lib/blog/revalidate-post";
import type { ResearchPacket, SerpCompetitiveBrief } from "@/lib/blog/contracts";

function makeSampleResearchPacket(): ResearchPacket {
    const collectedAt = "2026-10-15T10:00:00.000Z";
    const brief: SerpCompetitiveBrief = {
        version: 1,
        keyword: "choosing an seo tool",
        researchedAt: collectedAt,
        intent: {
            label: "commercial",
            confidence: 0.9,
            rationale: "Evaluating SEO platforms before trial or purchase",
            signals: ["best seo tools", "framework"],
        },
        dominantFormats: [{ format: "guide", count: 5, share: 0.7 }],
        serpFeatures: [
            {
                type: "people_also_ask",
                classification: "observed",
                description: "People Also Ask questions present on SERP",
                confidence: 0.9,
                sourceUrls: ["https://morningscore.io/best-seo-tools/"],
                evidence: ["What makes an effective SEO tool?"],
            },
        ],
        pages: [
            {
                rank: 1,
                title: "Morningscore Best SEO Tools",
                url: "https://morningscore.io/best-seo-tools/",
                snippet: "Comparison of SEO tools across auditing and rank tracking.",
                pageType: "comparison",
                dominantFormat: "comparison",
                headings: ["Technical Audits", "Rank Tracking"],
                schemaTypes: ["Article"],
                scrapeStatus: "ANALYZED",
            },
        ],
        requiredCoverage: [
            {
                topic: "technical seo audits",
                reason: "Core buyer requirement",
                observedOn: ["https://morningscore.io/best-seo-tools/"],
                supportCount: 4,
                totalAnalyzed: 5,
                classification: "observed_pattern",
                confidence: 0.9,
            },
        ],
        readerNeeds: [
            {
                question: "What makes the best SEO tool?",
                source: "people_also_ask",
                relatedUrls: ["https://morningscore.io/best-seo-tools/"],
                confidence: 0.9,
            },
        ],
        decisionCriteria: [
            {
                criterion: "JavaScript crawling",
                reason: "Needed for modern web apps",
                sourceUrls: ["https://morningscore.io/best-seo-tools/"],
                classification: "observed",
            },
        ],
        opportunities: [
            {
                id: "opp-1",
                type: "coverage_requirement",
                description: "Explain AI search citation checks alongside classic SERP ranks",
                verificationStatus: "observed",
                confidence: 0.9,
                sourceUrls: ["https://morningscore.io/best-seo-tools/"],
                supportingObservations: [
                    {
                        observation: "Ranking guides discuss AI search visibility tracking.",
                        classification: "observed",
                        confidence: 0.9,
                        sourceUrls: ["https://morningscore.io/best-seo-tools/"],
                        evidence: ["AI visibility tracking mentioned alongside rank tracking"],
                    },
                ],
                additionalValue: "Helps readers compare classic rank tracking with AI citation visibility",
            },
        ],
        recommendedFormat: "guide",
        outlineGuidance: ["Compare audit depth vs rank tracking"],
        differentiationPlan: ["Highlight AI citation tracking"],
        evidenceRequirements: ["Cite verified tool comparison sources"],
        retrieval: {
            status: "AVAILABLE",
            confidence: "high",
            organicResultsReceived: 10,
            uniqueResults: 10,
            scrapeAttempts: 5,
            analyzedPages: 5,
            scrapeFailures: [],
            coverageRatio: 0.8,
            notes: [],
        },
    };

    return {
        collectedAt,
        evidenceAvailability: "AVAILABLE",
        keyword: "choosing an seo tool",
        intent: "commercial",
        brain: {
            intent: "commercial",
            searcherMindset: "Evaluating SEO platforms",
            contentGaps: ["AI visibility tracking"],
            entities: ["Morningscore", "Semrush"],
            contrarianAngles: [],
            examplesNeeded: [],
            faqTargets: ["What makes the best SEO tool?"],
            commonMisconceptions: [],
            industryMyths: [],
            whatPeopleAvoidSaying: [],
        },
        serp: {
            competitors: [
                {
                    title: "Morningscore Best SEO Tools",
                    url: "https://morningscore.io/best-seo-tools/",
                    snippet: "Comparison of SEO tools.",
                    headings: ["Top SEO Tools"],
                    rank: 1,
                },
            ],
            paa: [{ question: "What makes the best SEO tool?" }],
            format: "guide",
        },
        sources: [
            {
                id: "source-1",
                url: "https://morningscore.io/best-seo-tools/",
                title: "Morningscore Best SEO Tools",
                publisher: "Morningscore",
                retrievedAt: collectedAt,
                claim: "Morningscore tested SEO suites across 350 hours.",
                evidence: "Morningscore tested SEO suites across 350 hours for technical audits and rank tracking.",
                sourceType: "research",
                confidence: 0.9,
            },
        ],
        entities: [{ entity: "Morningscore", reason: "SERP benchmark", sourceIds: ["source-1"] }],
        authorEvidence: {
            name: "Davion",
            experience: "Audited B2B SaaS websites across 2025–2026.",
        },
        serpCompetitiveBrief: brief,
        contentGaps: [],
        misconceptions: [],
        contrarianAngles: [],
    };
}

describe("Phase 1 truth & state integrity", () => {
    it("tags funnel CTAs, preserves brand casing, and prevents double injection", () => {
        const funnel = getFunnelForIntent(
            "informational",
            "site-1",
            "https://optiaiseo.online",
            "OptiAISEO",
        );

        expect(funnel.htmlSnippet).toContain('data-funnel-cta="true"');
        expect(funnel.htmlSnippet).toContain("OptiAISEO");
        expect(funnel.htmlSnippet).not.toContain("Optiaiseo");

        const articleWithoutCta = "<p>First paragraph.</p><p>Second paragraph.</p><p>Third paragraph.</p><p>Fourth paragraph.</p>";
        const once = injectFunnelCta(articleWithoutCta, funnel);
        expect(hasFunnelCta(once)).toBe(true);

        const twice = injectFunnelCta(once, funnel);
        expect(twice).toBe(once);
        expect(twice.match(/data-funnel-cta="true"/g)?.length).toBe(1);

        // Legacy untagged CTA detection prevents double-injecting on pre-fix articles
        const legacyHtml = '<p>Intro.</p><div><p>For more information about our services and how we can help, visit our website.</p></div>';
        expect(hasFunnelCta(legacyHtml)).toBe(true);
        expect(injectFunnelCta(legacyHtml, funnel)).toBe(legacyHtml);
    });

    it("normalizes clean arrays and recovers legacy corrupted citationCriteria objects", () => {
        const c0: CitationCriterion = {
            id: "directAnswer",
            label: "Direct Answer",
            weight: 15,
            passed: true,
            score: 15,
            fix: "Add direct answer",
        };
        const c1: CitationCriterion = {
            id: "faqSchema",
            label: "FAQ Section",
            weight: 15,
            passed: false,
            score: 0,
            fix: "Add FAQ Q&As",
        };

        expect(normalizeCitationCriteria([c0, c1])).toEqual([c0, c1]);
        expect(normalizeCitationCriteria({ criteria: [c0, c1] })).toEqual([c0, c1]);

        const corrupted = {
            "0": c0,
            "1": c1,
            missingEntities: ["Semrush"],
            enrichmentScore: 72,
            enrichmentAvailable: true,
        };
        expect(normalizeCitationCriteria(corrupted)).toEqual([c0, c1]);
        expect(normalizeCitationCriteria(null)).toEqual([]);
    });

    it("does not flag ordinary software prose as uncited factual claims while still checking real studies", () => {
        const packet = makeSampleResearchPacket();
        const proseWithSoftwareTerms = [
            "<p>Check fresh backlink data from recent press mentions before renewing any annual contract.</p>",
            "<p>Good workflows turn raw data into a short list of prioritized technical tasks.</p>",
            "<p>A backlink checker shows who links to your site and how strong those links are.</p>",
            "<p>SEOptimer generates fast, visual site audit reports for small teams.</p>",
        ].join("");

        const cleanResult = extractEvidencePacket(packet, proseWithSoftwareTerms);
        expect(cleanResult.unsupportedClaims).toEqual([]);

        const uncitedEmpiricalClaim =
            "<p>Research shows that teams migrating crawlers see faster rankings.</p>" +
            "<p>According to a recent survey, users prefer automated SEO reports.</p>";
        const flaggedResult = extractEvidencePacket(packet, uncitedEmpiricalClaim);
        expect(flaggedResult.unsupportedClaims.length).toBeGreaterThanOrEqual(2);
    });

    it("keeps Claims gate warning-free when no material claims exist", async () => {
        const packet = makeSampleResearchPacket();
        const cleanHtml = `
            <h1>Choosing an SEO Tool for Technical Audits</h1>
            <p>Choosing an SEO tool means evaluating JavaScript crawling, technical SEO audits, and clear API exports.</p>
            <h2>What Is an SEO Tool?</h2>
            <p>An SEO tool is software that helps teams monitor search visibility, inspect site structure, and prioritize fixes.</p>
            <h2>Core Capabilities</h2>
            <p>Reliable platforms check crawl depth, track AI search visibility, and highlight broken internal links clearly.</p>
        `;
        const evidencePacket = extractEvidencePacket(packet, cleanHtml);
        const decision = await evaluatePublicationGate({
            content: cleanHtml,
            title: "Choosing an SEO Tool for Technical Audits",
            metaDescription: "Learn how choosing an SEO tool improves technical audits, crawl checks, and AI search visibility for teams.",
            targetKeywords: ["choosing an seo tool"],
            evidencePacket,
            serpContext: null,
            researchPacket: packet,
            riskTier: "low",
            hasFirstPartyEvidence: true,
            skipRemoteOriginality: true,
        });

        const claimsGate = decision.gates.find((g) => g.name === "Claims");
        expect(claimsGate?.status).toBe("PASS");
        expect(claimsGate?.warnings).toEqual([]);
    });

    it("revalidates edited drafts synchronously, clearing resolved issues and keeping valid criteria arrays", async () => {
        const packet = makeSampleResearchPacket();
        const reconstructed = buildReconstructedResearchPacket({
            keyword: "choosing an seo tool",
            brief: packet.serpCompetitiveBrief,
            artifacts: [
                {
                    id: "art123",
                    url: "https://morningscore.io/best-seo-tools/",
                    title: "Morningscore Best SEO Tools",
                    publisher: "Morningscore",
                    retrievedAt: packet.collectedAt,
                    sourceType: "EXTERNAL_SOURCE",
                    snippet: "Tested SEO tools across 350 hours for technical SEO audits.",
                    confidence: 0.9,
                    authorityScore: 0.85,
                },
            ],
            author: { name: "Davion", realExperience: "10 years running audits" },
        });

        expect(reconstructed.sources).toHaveLength(1);
        expect(reconstructed.evidenceAvailability).toBe("AVAILABLE");

        const distinctParagraphs = [
            "<p>Start every software evaluation by running a live crawl across JavaScript-heavy templates, canonical headers, and paginated category routes so you verify whether the parser sees rendered DOM text rather than bare initial HTML.</p>",
            "<p>Check redirect chain reporting, XML sitemap validation, and core indexability diagnostics on staging builds before shipping structural template changes across large marketing or commerce catalogs.</p>",
            "<p>Compare rank-tracking refresh cadence across mobile and desktop viewports in key regional markets, separating tracked head terms from conversational long-tail queries that trigger generative summaries.</p>",
            "<p>Inspect link-index freshness by sampling recent press mentions and partner resource citations from the past thirty days to confirm discovery latency meets your outreach workflow requirements.</p>",
            "<p>Review team permissions, role-based audit workspaces, and CSV or JSON API export quotas to ensure engineers and content strategists share clean issue tickets without manual copy-pasting.</p>",
            "<p>Evaluate how the platform monitors brand visibility inside generative search answers, tracking whether documentation pages, comparison tables, and structured FAQ answers earn source attributions.</p>",
            "<p>Measure onboarding friction during trial week by assigning one non-technical editor to build a keyword cluster brief, diagnose three crawl errors, and publish an optimization checklist independently.</p>",
            "<p>Compare contract tiers carefully around seat pricing, historical SERP archive retention, and overage fees when project counts double during seasonal campaigns or multi-brand expansion.</p>",
            "<p>Connect technical findings directly into issue trackers so engineering sprints resolve broken hreflang tags, orphan URLs, and slow Largest Contentful Paint assets ahead of peak traffic windows.</p>",
            "<p>Verify how the tool handles multi-region SERP localization across desktop and mobile index views, especially when regional product availability alters canonical targets and rich snippet eligibility across storefront templates.</p>",
            "<p>Audit internal linking recommendations carefully to confirm suggested anchor copy reflects natural reader intent instead of repetitive exact-match keywords stuffed into navigation sidebars or footers.</p>",
            "<p>Require clear change-history logs whenever automated rank alerts fire, so growth analysts can distinguish genuine algorithm volatility from tracking parser maintenance or temporary SERP layout tests.</p>",
            "<p>Document clear escalation rules pairing crawl severity scores with revenue-impacting template owners so high-priority canonical regressions never sit unreviewed inside crowded weekly digest emails.</p>",
            "<p>Schedule quarterly stakeholder workshops to align engineering capacity, editorial velocity, and search-attribution benchmarks so every software investment translates cleanly into measurable organic visibility gains across core product landing pages.</p>",
        ].join("\n");

        const cleanedHtml = `
            <h1>Choosing an SEO Tool: Practical Framework</h1>
            <p>Choosing an SEO tool means picking software that verifies technical SEO audits, JavaScript rendering, and AI search visibility.</p>
            <h2>What Is an SEO Tool?</h2>
            <p>An SEO tool is software built to track rankings, diagnose technical crawl problems, and compare search visibility against competitors like <a href="https://morningscore.io/best-seo-tools/">Morningscore</a>.</p>
            <h2>Core Capabilities</h2>
            ${distinctParagraphs}
            <h2>Frequently Asked Questions</h2>
            <h3>How do you pick an effective SEO tool?</h3>
            <p>An effective SEO tool pairs accurate technical crawling with clean workflow prioritization and transparent API limits.</p>
            <h3>How do you test technical SEO audits?</h3>
            <p>Run a test crawl on dynamic pages and verify rendered body text before committing to an annual plan.</p>
            <h3>Should SEO tools track AI visibility?</h3>
            <p>Yes, tracking citations in generative summaries protects organic discovery alongside classic keyword rankings.</p>
            <h3>How often should teams audit large sites?</h3>
            <p>Teams shipping frequent catalog updates should run automated weekly technical checks plus release-gated crawls.</p>
        `;

        const draftState = await evaluateBlogPostState({
            title: "Choosing an SEO Tool: Practical Framework",
            content: cleanedHtml,
            metaDescription: "Framework for choosing an SEO tool across technical SEO audits, JavaScript crawling, and AI search visibility.",
            targetKeywords: ["choosing an seo tool"],
            author: { name: "Davion", realExperience: "Audited 50+ production web apps" },
            researchPacket: reconstructed,
            currentStatus: "NEEDS_REVIEW",
            hasFirstPartyEvidence: true,
        });

        expect(Array.isArray(draftState.citationCriteria)).toBe(true);
        expect(draftState.citationCriteria.length).toBeGreaterThan(0);
        expect(draftState.validationErrors).toEqual([]);
        expect(draftState.evidenceCoverage).toBe(100);
        expect(draftState.status).toBe("DRAFT");

        // Never unpublish a live PUBLISHED post during revalidation
        const publishedState = await evaluateBlogPostState({
            title: "Short",
            content: "<p>TODO replace this draft text {{placeholder}}</p>",
            metaDescription: "Short",
            targetKeywords: ["choosing an seo tool"],
            author: { name: "Davion" },
            researchPacket: reconstructed,
            currentStatus: "PUBLISHED",
            hasFirstPartyEvidence: false,
        });

        expect(publishedState.status).toBe("PUBLISHED");
        expect(publishedState.validationErrors.length).toBeGreaterThan(0);
        expect(findUnresolvedPlaceholders("<p>{{company}}</p>")).toHaveLength(1);
    });
});

