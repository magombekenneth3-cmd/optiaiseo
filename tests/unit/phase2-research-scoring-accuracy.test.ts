import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ─── External boundary mocks (business logic modules stay 100% real) ────────

const { mockRedisGet, mockRedisSet, mockPrisma } = vi.hoisted(() => ({
    mockRedisGet: vi.fn(),
    mockRedisSet: vi.fn(),
    mockPrisma: {
        site: {
            findUnique: vi.fn(),
            findFirst: vi.fn(),
            update: vi.fn().mockResolvedValue({}),
        },
        blog: {
            create: vi.fn(),
            findFirst: vi.fn(),
            findMany: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        },
        pageAudit: {
            findMany: vi.fn(),
        },
        gscDailyPerformance: {
            findMany: vi.fn(),
        },
        competitorKeyword: {
            findFirst: vi.fn().mockResolvedValue(null),
        },
        rankSnapshot: {
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([]),
            create: vi.fn().mockResolvedValue({}),
        },
    },
}));

vi.mock("@/lib/redis", () => ({
    redis: {
        get: (...args: unknown[]) => mockRedisGet(...args),
        set: (...args: unknown[]) => mockRedisSet(...args),
    },
    redisErrorCode: (e: unknown) => (e instanceof Error ? e.name : "REDIS_ERROR"),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: mockPrisma,
}));

vi.mock("@/lib/auth/require-user", () => ({
    requireUser: vi.fn().mockResolvedValue({
        ok: true,
        user: { id: "user-1", email: "editor@example.com", name: "Davion" },
    }),
}));

vi.mock("@/lib/auth/get-auth-user", () => ({
    getAuthUser: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "editor@example.com",
        name: "Davion",
    }),
}));

vi.mock("@/lib/rate-limit/check", () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/stripe/guards", () => ({
    getEffectiveTier: vi.fn().mockResolvedValue("PRO"),
}));

vi.mock("@/lib/credits", () => ({
    consumeCreditsIdempotent: vi.fn(),
}));

vi.mock("@/lib/blog/context", () => ({
    extractSiteContext: vi.fn().mockResolvedValue("Site context"),
}));

vi.mock("@/lib/gsc", () => ({
    fetchGSCKeywords: vi.fn().mockResolvedValue([]),
    findOpportunities: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/gsc/token", () => ({
    getUserGscToken: vi.fn().mockRejectedValue(new Error("not connected")),
}));

vi.mock("@/lib/gsc/property-resolver", () => ({
    getAuthorizedGscProperty: vi.fn().mockRejectedValue(new Error("not connected")),
}));

vi.mock("@/lib/gsc/gsc-availability", () => ({
    classifyGscError: vi.fn().mockReturnValue("NOT_CONNECTED"),
    logGscFailure: vi.fn(),
}));

vi.mock("@/lib/inngest/client", () => ({
    inngest: { send: vi.fn().mockResolvedValue({}) },
}));

vi.mock("@/lib/indexer", () => ({
    submitUrlForIndexing: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/indexnow-config", () => ({
    getIndexNowConfig: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/blog/ai-client", () => ({
    generateWithFallbackJson: vi.fn().mockResolvedValue({ isAi: false, aiProbabilityScore: 10 }),
}));

vi.mock("@/lib/gemini/client", () => ({
    callGemini: vi.fn().mockResolvedValue("[]"),
}));

vi.mock("next/cache", () => ({
    revalidatePath: vi.fn(),
}));

vi.mock("@/lib/blog/serp-gate", async (importOriginal) => {
    const real = await importOriginal<typeof import("@/lib/blog/serp-gate")>();
    return {
        ...real,
        validateSerpPreflight: vi.fn().mockResolvedValue({ valid: false }),
        storeSerpPreflight: vi.fn().mockResolvedValue("pre-1"),
    };
});

// ─── Real modules under test ──────────────────────────────────────────────────

import {
    MIN_SUBSTANTIVE_COMPETITOR_WORDS,
    buildSerpBenchmarkFromCompetitors,
    filterSubstantiveCompetitorPages,
    isChallengeOrErrorHtml,
    scoreContent,
} from "@/lib/content-scoring";
import {
    buildResearchPacket,
    isAnalyzedAttributionCandidate,
    isAnalyzedSource,
    sourceFromSerpResult,
} from "@/lib/blog/research-packet";
import { extractEvidencePacket } from "@/lib/blog/evidence-extractor";
import { findEvidenceForClaim } from "@/lib/blog/claim-verification";
import {
    buildReconstructedResearchPacket,
    evaluatePublishPreconditions,
} from "@/lib/blog/revalidate-post";
import { classifySerpFormat, classifySerpResultPageType } from "@/lib/blog/serp";
import { buildSerpCompetitiveBrief } from "@/lib/blog/serp-competitive-brief";
import {
    evaluatePageAuditCandidate,
    isInteractiveToolUrl,
    resolvePageExistence,
    resolvePageExistenceBatch,
} from "@/lib/opportunity-engine/page-existence-resolver";
import { consumeCreditsIdempotent } from "@/lib/credits";
import { generateBlog } from "@/app/actions/blog";
import { POST as publishPost } from "@/app/api/blogs/[id]/publish/route";
import type { AuthorProfile } from "@/lib/blog";
import type { ResearchPacket, SerpCompetitiveBrief } from "@/lib/blog/contracts";

const SAMPLE_AUTHOR: AuthorProfile = {
    name: "Davion",
    role: "SEO Strategist",
    bio: "Audited 200+ B2B sites.",
    realExperience: "We audited 40 enterprise SaaS migrations in 2026.",
    realNumbers: "40 enterprise audits completed",
    localContext: "US & EU SaaS search markets",
};

function longHtmlBody(wordCount: number, keyword = "seo tool"): string {
    const filler = Array.from({ length: wordCount }, (_, i) =>
        i % 40 === 0 ? keyword : `analysis${i}`,
    ).join(" ");
    return `<html><head><title>Choosing an SEO Tool Guide</title></head><body><article><h2>What to look for in an SEO tool</h2><p>${filler}</p></article></body></html>`;
}

describe("Phase 2 — Research & Scoring Accuracy", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        delete process.env.SERPER_API_KEY;
        mockRedisGet.mockResolvedValue(null);
        mockRedisSet.mockResolvedValue("OK");
        mockPrisma.site.findUnique.mockResolvedValue({
            id: "site-1",
            userId: "user-1",
            domain: "optiaiseo.online",
            authorName: "Davion",
            authorRole: null,
            authorBio: null,
            realExperience: null,
            realNumbers: null,
            localContext: null,
        });
        mockPrisma.blog.findFirst.mockResolvedValue(null);
        mockPrisma.blog.findMany.mockResolvedValue([]);
        mockPrisma.gscDailyPerformance.findMany.mockResolvedValue([]);
        mockPrisma.pageAudit.findMany.mockResolvedValue([]);
    });

    // ─── 1. Competitor Benchmark Scrape Filtering ─────────────────────────────

    describe("1. SERP Competitor Benchmark Hygiene", () => {
        it("rejects HTTP 403/5xx, non-HTML, Cloudflare challenges, and <300-word thin scrapes", () => {
            const pages = filterSubstantiveCompetitorPages([
                {
                    url: "https://blocked-vendor.example/seo-tools",
                    html: longHtmlBody(900),
                    status: 403,
                    contentType: "text/html",
                },
                {
                    url: "https://api-json.example/data",
                    html: JSON.stringify({ data: longHtmlBody(600) }),
                    status: 200,
                    contentType: "application/json",
                },
                {
                    url: "https://cloudflare-challenge.example/",
                    html: "<html><head><title>Just a moment...</title></head><body><div id='cf-wrapper'>Checking your browser before accessing this site. Enable JavaScript and cookies to continue.</div></body></html>",
                    status: 200,
                    contentType: "text/html",
                },
                {
                    url: "https://snippet-only.example/",
                    html: `<html><body><p>${Array.from({ length: 81 }, (_, i) => `word${i}`).join(" ")}</p></body></html>`,
                    status: 200,
                    contentType: "text/html",
                },
                {
                    url: "https://substantive-guide.example/seo-tools",
                    html: longHtmlBody(950, "seo tool"),
                    status: 200,
                    contentType: "text/html; charset=utf-8",
                },
            ], "seo tool");

            expect(pages).toHaveLength(1);
            expect(pages[0]?.url).toBe("https://substantive-guide.example/seo-tools");
            expect(pages[0]?.wordCount).toBeGreaterThanOrEqual(MIN_SUBSTANTIVE_COMPETITOR_WORDS);

            const benchmark = buildSerpBenchmarkFromCompetitors(pages);
            expect(benchmark._isFallback).toBeUndefined();
            expect(benchmark.p25WC).toBeGreaterThanOrEqual(MIN_SUBSTANTIVE_COMPETITOR_WORDS);
        });

        it("returns fallback editorial benchmark and never collapses p25WC when all scrapes fail or are thin", () => {
            const thinPages = filterSubstantiveCompetitorPages([
                {
                    url: "https://thin.example/1",
                    html: "<html><body><p>Only 81 words of cookie notice and forbidden message.</p></body></html>",
                    status: 200,
                    contentType: "text/html",
                },
            ], "seo tool");

            expect(thinPages).toHaveLength(0);
            const benchmark = buildSerpBenchmarkFromCompetitors(thinPages);
            expect(benchmark._isFallback).toBe(true);
            expect(benchmark.p25WC).toBe(800);
            expect(benchmark.p75WC).toBe(2200);
        });

        it("detects Cloudflare challenge HTML even with padded boilerplate", () => {
            const challengeHtml = `<html><head><title>Attention Required! | Cloudflare</title></head><body>Please turn JavaScript on and reload the page. Verify you are human. ${"token ".repeat(120)}</body></html>`;
            expect(isChallengeOrErrorHtml(challengeHtml, challengeHtml, 130)).toBe(true);
        });

        it("guards scoreContent against poisoned legacy Redis cache entries (<300 words)", async () => {
            mockRedisGet.mockResolvedValueOnce(
                JSON.stringify({
                    p25WC: 81,
                    p75WC: 140,
                    medianKW: 1,
                    top15Headings: [],
                    top20Entities: [],
                    p25Images: 1,
                    p75Images: 2,
                    competitors: [{ url: "https://blocked.example", wordCount: 81 }],
                }),
            );
            process.env.SERPER_API_KEY = "test-key";
            vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
                const url = String(input);
                if (url.includes("google.serper.dev")) {
                    return new Response(
                        JSON.stringify({
                            organic: [{ link: "https://www.seoptimer.com/" }, { link: "https://cf-site.example/" }],
                        }),
                        { status: 200, headers: { "content-type": "application/json" } },
                    );
                }
                if (url.includes("seoptimer.com")) {
                    return new Response("403 Forbidden", { status: 403, headers: { "content-type": "text/html" } });
                }
                return new Response(
                    "<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing.</body></html>",
                    { status: 200, headers: { "content-type": "text/html" } },
                );
            }));

            const article = `<article><h2>Choosing an SEO tool</h2><p>${"seo tool workflow audit ".repeat(350)}</p></article>`;
            const score = await scoreContent(article, ["seo tool"]);

            // Must ignore poisoned 81-word benchmark and use fallback editorial targets
            expect(score.subScores.wordCount.targetMin).toBeGreaterThanOrEqual(800);
            expect(score.subScores.wordCount.targetMax).toBeGreaterThanOrEqual(2000);
            expect(score.benchmarkWarning).toBeTruthy();
            expect(mockRedisSet).not.toHaveBeenCalled();
        });
    });

    // ─── 2. Attribution Source Hygiene (ANALYZED only) ────────────────────────

    describe("2. Attribution Source Hygiene (scrapeStatus === ANALYZED only)", () => {
        it("excludes FAILED, UNSCRAPPABLE, and SNIPPET_ONLY URLs from ResearchPacket.sources", async () => {
            expect(
                isAnalyzedAttributionCandidate({
                    link: "https://www.seoptimer.com/",
                    scrapeStatus: "FAILED",
                    scrapedContent: "",
                }),
            ).toBe(false);
            expect(
                isAnalyzedAttributionCandidate({
                    link: "https://example.com/tool",
                    scrapeStatus: "UNSCRAPPABLE",
                    scrapedContent: "Interactive app",
                }),
            ).toBe(false);
            expect(
                isAnalyzedAttributionCandidate({
                    link: "https://zapier.com/blog/best-seo-tools/",
                    scrapeStatus: "SNIPPET_ONLY",
                    scrapedContent: "Short snippet only",
                }),
            ).toBe(false);
            expect(
                sourceFromSerpResult(
                    {
                        title: "SEOptimer SEO Audit",
                        link: "https://www.seoptimer.com/",
                        snippet: "Platforms like SEOptimer check AI citations.",
                        scrapeStatus: "FAILED",
                    },
                    "serp-1",
                ),
            ).toBeNull();

            const packet = await buildResearchPacket({
                keyword: "choosing an seo tool",
                brain: {
                    intent: "commercial",
                    searcherMindset: "Comparing SEO platforms",
                    contentGaps: [],
                    entities: ["Semrush", "Ahrefs"],
                    contrarianAngles: [],
                    examplesNeeded: [],
                    faqTargets: [],
                    commonMisconceptions: [],
                    industryMyths: [],
                    whatPeopleAvoidSaying: [],
                },
            serpContext: {
                keyword: "choosing an seo tool",
                featuredSnippet: null,
                formattedContext: "",
                opportunityAnalysis: {
                    unansweredQuestions: [],
                    tableStakes: [],
                    opportunities: [],
                },
                peopleAlsoAsk: [],
                relatedSearches: [],
                results: [
                        {
                            title: "SEOptimer AI Citations",
                            link: "https://www.seoptimer.com/",
                            snippet: "SEOptimer checks whether AI engines cite your content.",
                            scrapeStatus: "FAILED",
                            scrapeFailureReason: "HTTP 403 Forbidden",
                        },
                        {
                            title: "Zapier Best SEO Tools",
                            link: "https://zapier.com/blog/best-seo-tools/",
                            snippet: "Compare classic rank trackers and AI visibility tools.",
                            scrapeStatus: "SNIPPET_ONLY",
                        },
                        {
                            title: "Morningscore Best SEO Tools",
                            link: "https://morningscore.io/best-seo-tools/",
                            snippet: "Karsten Madsen tested SEO tools across 350 hours.",
                            scrapedContent: "In testing across 350 hours, Karsten Madsen evaluated Semrush and Ahrefs across technical crawls, backlinks, and API pricing limits. ".repeat(4),
                            scrapeStatus: "ANALYZED",
                        },
                    ],
                },
                author: SAMPLE_AUTHOR,
            });

            expect(packet.sources.map((s) => s.url)).toEqual(["https://morningscore.io/best-seo-tools/"]);
        });

        it("refuses to credit FAILED/SNIPPET_ONLY URLs as valid citations in extractEvidencePacket or claim-verification", () => {
            const legacyPacket: ResearchPacket = {
                keyword: "choosing an seo tool",
                intent: "commercial",
                collectedAt: "2026-10-15T10:00:00.000Z",
                evidenceAvailability: "AVAILABLE",
                brain: {
                    intent: "commercial",
                    searcherMindset: "Comparing SEO platforms",
                    contentGaps: [],
                    entities: [],
                    contrarianAngles: [],
                    examplesNeeded: [],
                    faqTargets: [],
                    commonMisconceptions: [],
                    industryMyths: [],
                    whatPeopleAvoidSaying: [],
                },
                serp: {
                    format: "listicle",
                    paa: [],
                    competitors: [
                        {
                            title: "SEOptimer",
                            url: "https://www.seoptimer.com/",
                            snippet: "SEOptimer checks AI citations.",
                            headings: [],
                            rank: 1,
                            scrapeStatus: "FAILED",
                        },
                    ],
                },
                sources: [
                    {
                        id: "serp-1",
                        url: "https://www.seoptimer.com/",
                        title: "SEOptimer",
                        retrievedAt: "2026-10-15T10:00:00.000Z",
                        claim: "SEOptimer checks 65% of AI citations.",
                        evidence: "SEOptimer checks 65% of AI citations.",
                        sourceType: "other",
                        confidence: 0.75,
                    },
                    {
                        id: "serp-2",
                        url: "https://zapier.com/blog/best-seo-tools/",
                        title: "Zapier",
                        retrievedAt: "2026-10-15T10:00:00.000Z",
                        claim: "Zapier compared 12 tools.",
                        evidence: "Zapier compared 12 tools.",
                        sourceType: "other",
                        confidence: 0.75,
                        scrapeStatus: "SNIPPET_ONLY",
                    },
                ],
                contentGaps: [],
                misconceptions: [],
                contrarianAngles: [],
                entities: [],
                authorEvidence: { name: "Davion" },
            };

            expect(isAnalyzedSource(legacyPacket.sources[0]!, legacyPacket)).toBe(false);
            expect(isAnalyzedSource(legacyPacket.sources[1]!, legacyPacket)).toBe(false);

            const html = `<p>Research shows that platforms track 65% of AI citations <a href="https://www.seoptimer.com/">SEOptimer</a> and evaluate 12 tools <a href="https://zapier.com/blog/best-seo-tools/">Zapier</a>.</p>`;
            const evidencePacket = extractEvidencePacket(legacyPacket, html);

            expect(evidencePacket.sources).toHaveLength(0);
            expect(evidencePacket.availability).toBe("EMPTY");
            expect(evidencePacket.claimSourceMap[0]?.matchMethod).toBe("unsupported");
            expect(evidencePacket.unsupportedClaims.length).toBeGreaterThan(0);

            const claimMatches = findEvidenceForClaim(
                {
                    id: "c-1",
                    text: "SEOptimer checks 65% of AI citations across platforms.",
                    type: "STATISTIC",
                    sectionHint: null,
                    sentenceIndex: 0,
                },
                legacyPacket,
                null,
            );
            expect(claimMatches).toHaveLength(0);
        });

        it("excludes blocked/snippet-only brief pages & artifacts in buildReconstructedResearchPacket", () => {
            const brief: SerpCompetitiveBrief = {
                version: 1,
                keyword: "choosing an seo tool",
                researchedAt: "2026-10-15T10:00:00.000Z",
                intent: { label: "commercial", confidence: 0.9, rationale: "Compare options", signals: [] },
                dominantFormats: [{ format: "guide", count: 2, share: 1 }],
                serpFeatures: [],
                pages: [
                    {
                        rank: 1,
                        title: "SEOptimer",
                        url: "https://www.seoptimer.com/",
                        snippet: "Free SEO Audit Tool",
                        pageType: "interactive_tool",
                        dominantFormat: "tool",
                        headings: [],
                        schemaTypes: [],
                        scrapeStatus: "FAILED",
                    },
                    {
                        rank: 2,
                        title: "Morningscore Best SEO Tools",
                        url: "https://morningscore.io/best-seo-tools/",
                        snippet: "350 hours testing SEO platforms",
                        pageType: "listicle",
                        dominantFormat: "listicle",
                        headings: ["Semrush", "Ahrefs"],
                        schemaTypes: ["Article"],
                        scrapeStatus: "ANALYZED",
                    },
                ],
                requiredCoverage: [],
                readerNeeds: [],
                decisionCriteria: [],
                opportunities: [],
                recommendedFormat: "guide",
                outlineGuidance: [],
                differentiationPlan: [],
                evidenceRequirements: [],
                retrieval: {
                    status: "AVAILABLE",
                    confidence: "medium",
                    organicResultsReceived: 2,
                    uniqueResults: 2,
                    scrapeAttempts: 2,
                    analyzedPages: 1,
                    scrapeFailures: [],
                    coverageRatio: 0.5,
                    notes: [],
                },
                siteFit: {
                    recommendedAction: "CREATE_PILLAR",
                    rationale: "No overlap",
                    relatedLibraryPageUrls: [],
                    humanReviewRequired: false,
                },
            };

            const reconstructed = buildReconstructedResearchPacket({
                keyword: "choosing an seo tool",
                brief,
                artifacts: [
                    {
                        id: "art-blocked",
                        url: "https://www.seoptimer.com/",
                        title: "SEOptimer",
                        publisher: "seoptimer.com",
                        retrievedAt: "2026-10-15T10:00:00.000Z",
                        sourceType: "SERP_OBSERVATION",
                        snippet: "403 blocked",
                        confidence: 0.8,
                        authorityScore: 0.7,
                    },
                    {
                        id: "art-ok",
                        url: "https://morningscore.io/best-seo-tools/",
                        title: "Morningscore",
                        publisher: "morningscore.io",
                        retrievedAt: "2026-10-15T10:00:00.000Z",
                        sourceType: "SERP_OBSERVATION",
                        snippet: "350 hours of SEO tool testing",
                        confidence: 0.85,
                        authorityScore: 0.8,
                    },
                ],
                author: SAMPLE_AUTHOR,
            });

            expect(reconstructed.sources.map((s) => s.url)).toEqual(["https://morningscore.io/best-seo-tools/"]);

            // Fallback path when artifacts list is empty must also only keep ANALYZED pages
            const reconstructedFallback = buildReconstructedResearchPacket({
                keyword: "choosing an seo tool",
                brief,
                artifacts: [],
                author: SAMPLE_AUTHOR,
            });
            expect(reconstructedFallback.sources.map((s) => s.url)).toEqual([
                "https://morningscore.io/best-seo-tools/",
            ]);
        });
    });

    // ─── 3. Tool vs. Article Classification & PageAudit Matching ──────────────

    describe("3. Tool vs. Editorial Classification & PageAudit Intent Matching", () => {
        it("does not misclassify editorial roundups/guides mentioning 'checker' or 'generator' as interactive tools", () => {
            const roundup = {
                title: "The 10 best SEO tools in 2026",
                link: "https://zapier.com/blog/best-seo-tools/",
                snippet: "Every SEO tool reviewed includes a backlink checker, keyword generator, and technical site audit.",
            };
            const buyerGuide = {
                title: "Choosing an SEO tool: A Complete Buyer Guide",
                link: "https://morningscore.io/guides/choosing-seo-tool/",
                snippet: "Learn how to compare rank trackers, backlink checkers, and pricing limits.",
            };
            const actualTool = {
                title: "Free Backlink Checker — Check Backlinks to Any Site",
                link: "https://ahrefs.com/backlink-checker",
                snippet: "Try our free backlink checker tool to inspect live backlinks for any domain.",
            };

            expect(classifySerpResultPageType(roundup)).toBe("listicle");
            expect(classifySerpResultPageType(buyerGuide)).toBe("tutorial");
            expect(classifySerpResultPageType(actualTool)).toBe("interactive_tool");

            const signal = classifySerpFormat([roundup, buyerGuide]);
            expect(signal.format).not.toBe("tool");

            const brief = buildSerpCompetitiveBrief({
                keyword: "choosing an seo tool",
                siteContentLibrary: {
                    retrievalStatus: "AVAILABLE",
                    capturedAt: "2026-10-15T10:00:00.000Z",
                    consideredCount: 0,
                    relatedPages: [],
                    warnings: [],
                },
                existingSite: {
                    verdict: "MISSING",
                    existingPage: null,
                    allCandidates: [],
                    recommendedAction: "CREATE_NEW_CONTENT",
                    recommendedCategory: "ALMOST_RANKING",
                    reasoning: "No matching page exists.",
                },
                serpContext: {
                    keyword: "choosing an seo tool",
                    featuredSnippet: null,
                    formattedContext: "",
                    opportunityAnalysis: {
                        unansweredQuestions: [],
                        tableStakes: [],
                        opportunities: [],
                    },
                    peopleAlsoAsk: [],
                    relatedSearches: [],
                    results: [
                        { ...roundup, scrapeStatus: "ANALYZED", scrapedContent: "Long review content. ".repeat(25) },
                        { ...buyerGuide, scrapeStatus: "ANALYZED", scrapedContent: "Buyer framework guide. ".repeat(25) },
                    ],
                },
            });
            expect(brief.recommendedFormat).not.toBe("tool");
            expect(brief.siteFit?.recommendedAction).toBe("CREATE_PILLAR");
        });

        it("prevents /tools/free-seo-audit-tool-online from matching editorial/broad queries as UPDATE_EXISTING", async () => {
            expect(isInteractiveToolUrl("https://optiaiseo.online/tools/free-seo-audit-tool-online")).toBe(true);
            expect(isInteractiveToolUrl("https://optiaiseo.online/blog/choosing-an-seo-tool")).toBe(false);

            const toolAudit = {
                pageUrl: "https://optiaiseo.online/tools/free-seo-audit-tool-online",
                overallScore: 42,
                issueList: ["THIN_CONTENT"],
            };

            // Editorial and broad queries must NOT collide with a /tools/* utility page
            expect(
                evaluatePageAuditCandidate(toolAudit, "choosing an seo tool", ["choosing", "seo", "tool"]),
            ).toBeNull();
            expect(evaluatePageAuditCandidate(toolAudit, "seo tool", ["seo", "tool"])).toBeNull();
            expect(evaluatePageAuditCandidate(toolAudit, "best seo tools", ["best", "seo", "tools"])).toBeNull();

            // Exact utility-tool intent query still matches
            expect(
                evaluatePageAuditCandidate(toolAudit, "free seo audit tool", ["free", "seo", "audit", "tool"]),
            ).not.toBeNull();

            // Verify end-to-end across both single and batch resolvers
            mockPrisma.pageAudit.findMany.mockResolvedValue([toolAudit]);

            const single = await resolvePageExistence("site-1", "choosing an seo tool");
            expect(single.verdict).toBe("MISSING");
            expect(single.recommendedAction).toBe("CREATE_NEW_CONTENT");

            const batch = await resolvePageExistenceBatch("site-1", [
                { keyword: "choosing an seo tool", clusterQueries: ["seo tool"] },
                { keyword: "free seo audit tool", clusterQueries: [] },
            ]);
            expect(batch.get("choosing an seo tool")?.verdict).toBe("MISSING");
            expect(batch.get("free seo audit tool")?.verdict).toBe("EXISTING_NEEDS_FIX");
        });
    });

    // ─── 4. UPDATE_EXISTING & Publish Gate Enforcement ────────────────────────

    describe("4. UPDATE_EXISTING & Publish Route Enforcement", () => {
        it("blocks duplicate blog generation and skips credit consumption when resolvePageExistence recommends updating an existing page", async () => {
            mockPrisma.blog.findMany.mockResolvedValue([
                {
                    id: "blog-existing",
                    title: "Choosing an SEO Tool in 2026",
                    slug: "choosing-an-seo-tool",
                    sourceUrl: "/blog/choosing-an-seo-tool",
                    status: "PUBLISHED",
                    targetKeywords: ["choosing an seo tool"],
                    publishedAt: new Date(Date.now() - 220 * 86_400_000),
                    updatedAt: new Date(),
                    needsRefresh: true,
                    validationScore: 72,
                },
            ]);

            const res = await generateBlog("USER_KEYWORD", "site-1", {
                authorName: "Davion",
                keyword: "choosing an seo tool",
            });

            expect(res.success).toBe(false);
            expect((res as { code?: string }).code).toBe("EXISTING_PAGE_CONFLICT");
            expect((res as { existingUrl?: string }).existingUrl).toBe("/blog/choosing-an-seo-tool");
            expect((res as { recommendedAction?: string }).recommendedAction).toBe("UPDATE_EXISTING");
            expect(mockPrisma.blog.create).not.toHaveBeenCalled();
            expect(consumeCreditsIdempotent).not.toHaveBeenCalled();
        });

        it("blocks publishing EVIDENCE_REVIEW drafts, unresolved placeholders, validationErrors, and un-refreshed UPDATE_EXISTING conflicts", async () => {
            expect(
                evaluatePublishPreconditions({
                    content: "<p>Draft copy {{COMPANY_NAME}}</p>",
                    status: "READY",
                }).ok,
            ).toBe(false);

            expect(
                evaluatePublishPreconditions({
                    content: "<p>Clean article body without placeholders.</p>",
                    status: "EVIDENCE_REVIEW",
                    validationErrors: ["Unsupported statistic on row 4"],
                }).ok,
            ).toBe(false);

            expect(
                evaluatePublishPreconditions({
                    content: "<p>Clean article body.</p>",
                    status: "DRAFT",
                    validationErrors: ["Missing verifiable claim source"],
                }).ok,
            ).toBe(false);

            const overlapBlock = evaluatePublishPreconditions({
                content: "<p>Clean article body.</p>",
                status: "READY",
                pipelineType: "USER_KEYWORD",
                sourceUrl: null,
                serpCompetitiveBrief: {
                    siteFit: {
                        recommendedAction: "UPDATE_EXISTING",
                        overlappingUrls: ["https://optiaiseo.online/blog/seo-guide"],
                    },
                },
            });
            expect(overlapBlock.ok).toBe(false);
            expect(overlapBlock.error).toContain("updating existing page");

            // Surgical CONTENT_REFRESH draft updating the existing page IS allowed when clean
            expect(
                evaluatePublishPreconditions({
                    content: "<p>Refreshed clean article body.</p>",
                    status: "READY",
                    pipelineType: "CONTENT_REFRESH",
                    sourceUrl: "https://optiaiseo.online/blog/seo-guide",
                    serpCompetitiveBrief: {
                        siteFit: {
                            recommendedAction: "UPDATE_EXISTING",
                            overlappingUrls: ["https://optiaiseo.online/blog/seo-guide"],
                        },
                    },
                }).ok,
            ).toBe(true);

            // End-to-end POST /api/blogs/[id]/publish rejects EVIDENCE_REVIEW draft with 409
            mockPrisma.blog.findFirst.mockResolvedValueOnce({
                id: "blog-held",
                siteId: "site-1",
                pipelineType: "USER_KEYWORD",
                title: "Choosing an SEO Tool",
                slug: "choosing-an-seo-tool",
                content: "<p>Clean copy</p>",
                status: "EVIDENCE_REVIEW",
                sourceUrl: null,
                validationErrors: ["Blocked source URL cited"],
                publicationGates: [],
                serpCompetitiveBrief: null,
                site: { id: "site-1", userId: "user-1", domain: "optiaiseo.online" },
            });

            const req = new NextRequest("http://localhost/api/blogs/blog-held/publish", { method: "POST" });
            const response = await publishPost(req, { params: Promise.resolve({ id: "blog-held" }) });
            expect(response.status).toBe(409);
            expect(mockPrisma.blog.update).not.toHaveBeenCalled();
        });
    });
});

