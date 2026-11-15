import { describe, it, expect, vi, beforeEach } from "vitest";

const {
    mockRequireUser,
    mockRequireTiers,
    mockGuardErrorToResult,
    mockConsumeCredits,
    mockConsumeCreditsIdempotent,
    mockRefundCredits,
    mockRefundCreditsIdempotent,
    mockAssertSafeAuditUrl,
    mockSafeAuditFetch,
    mockGetSerpContextForKeyword,
    mockProposeSingleBlogRefresh,
    mockBuildPost,
    mockEvaluateDraftForPublication,
    mockGenerateContent,
    mockCallGeminiJson,
    mockGenerateBlogAction,
    mockPrisma,
} = vi.hoisted(() => ({
    mockRequireUser: vi.fn(),
    mockRequireTiers: vi.fn(),
    mockGuardErrorToResult: vi.fn((err: unknown) => ({
        success: false,
        error: err instanceof Error ? err.message : "Upgrade required",
        code: "tier_restricted",
    })),
    mockConsumeCredits: vi.fn(),
    mockConsumeCreditsIdempotent: vi.fn(),
    mockRefundCredits: vi.fn(),
    mockRefundCreditsIdempotent: vi.fn(),
    mockAssertSafeAuditUrl: vi.fn(),
    mockSafeAuditFetch: vi.fn(),
    mockGetSerpContextForKeyword: vi.fn(),
    mockProposeSingleBlogRefresh: vi.fn(),
    mockBuildPost: vi.fn(),
    mockEvaluateDraftForPublication: vi.fn(),
    mockGenerateContent: vi.fn(),
    mockCallGeminiJson: vi.fn(),
    mockGenerateBlogAction: vi.fn(),
    mockPrisma: {
        site: { findUnique: vi.fn() },
        blog: { findFirst: vi.fn(), create: vi.fn() },
    },
}));

vi.mock("next/cache", () => ({
    revalidatePath: vi.fn(),
}));

vi.mock("sonner", () => ({
    toast: {
        loading: vi.fn(() => "toast-1"),
        dismiss: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock("@/lib/ui/action-errors", () => ({
    showActionError: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock("@/lib/prisma", () => ({
    prisma: mockPrisma,
}));

vi.mock("@/lib/auth/require-user", () => ({
    requireUser: mockRequireUser,
}));

vi.mock("@/lib/stripe/guards", () => ({
    requireTiers: mockRequireTiers,
    guardErrorToResult: mockGuardErrorToResult,
}));

vi.mock("@/lib/credits", () => ({
    CREDIT_COSTS: { blog_generation: 10 },
    consumeCredits: mockConsumeCredits,
    consumeCreditsIdempotent: mockConsumeCreditsIdempotent,
    refundCredits: mockRefundCredits,
    refundCreditsIdempotent: mockRefundCreditsIdempotent,
}));

vi.mock("@/lib/seo-audit/utils/fetch-html", () => ({
    assertSafeAuditUrl: mockAssertSafeAuditUrl,
    safeAuditFetch: mockSafeAuditFetch,
}));

vi.mock("@/lib/blog/serp", () => ({
    getSerpContextForKeyword: mockGetSerpContextForKeyword,
    classifySerpFormat: vi.fn(() => null),
    formatToPromptHint: vi.fn(() => ""),
    computeContentGaps: vi.fn(() => ({
        commonTopics: ["on-page basics"],
        gapTopics: ["local citation workflow"],
    })),
}));

vi.mock("@/lib/content/decay-to-mutation", () => ({
    proposeSingleBlogRefresh: mockProposeSingleBlogRefresh,
}));

vi.mock("@/lib/blog", () => ({
    getAiClient: vi.fn(() => ({
        models: {
            generateContent: mockGenerateContent,
        },
    })),
    buildBlogResponseSchema: vi.fn(() => ({})),
    buildPost: mockBuildPost,
    evaluateDraftForPublication: mockEvaluateDraftForPublication,
}));

vi.mock("@/lib/blog/ai-client", () => ({
    hasConfiguredAiProvider: vi.fn(() => true),
}));

vi.mock("@/lib/gemini/client", () => ({
    callGeminiJson: mockCallGeminiJson,
}));

vi.mock("@/app/actions/blog", () => ({
    generateBlog: mockGenerateBlogAction,
}));

import {
    buildSelectedTopicContext,
    buildSurgicalRefreshPrompt,
    computeSurgicalRefreshSummary,
    derivePreservedSlug,
    isTargetUrlOnSiteDomain,
    normalizeHostname,
} from "@/lib/content/surgical-refresh";
import {
    dispatchTopicAction,
    isSurgicalRefreshSelection,
    type AuthorSubmissionPayload,
} from "@/lib/blog/topic-submission";
import {
    refreshDecayingContent,
    refreshExistingPageFromGap,
} from "@/app/actions/contentDecay";

const SAMPLE_HTML = `
<html>
  <body>
    <main>
      <h1>Local SEO Tools for Small Businesses</h1>
      <p>Choosing the right local search stack helps service businesses show up in map packs.</p>
      <h2>Best Local Listing Platforms</h2>
      <p>Managing Google Business Profile citations keeps NAP records consistent.</p>
      <h2>Pricing Comparison</h2>
      <p>Entry tiers start with manual audits before automating citations.</p>
    </main>
  </body>
</html>
`;

describe("Workstream D2: Surgical Content Refresh & Topic Routing", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mockRequireUser.mockResolvedValue({ ok: true, user: { id: "user-1" } });
        mockRequireTiers.mockResolvedValue(undefined);
        mockAssertSafeAuditUrl.mockResolvedValue(undefined);
        mockConsumeCredits.mockResolvedValue({ allowed: true, remaining: 90, cost: 10 });
        mockConsumeCreditsIdempotent.mockResolvedValue({ allowed: true, remaining: 90, cost: 10 });
        mockRefundCredits.mockResolvedValue(undefined);
        mockRefundCreditsIdempotent.mockResolvedValue({ success: true, refunded: true });
        mockProposeSingleBlogRefresh.mockResolvedValue({ proposed: true });

        mockPrisma.site.findUnique.mockResolvedValue({
            id: "site-1",
            userId: "user-1",
            domain: "optiaiseo.online",
        });
        mockPrisma.blog.findFirst.mockResolvedValue(null);
        mockPrisma.blog.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
            id: "blog-refresh-1",
            ...data,
        }));

        mockSafeAuditFetch.mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => SAMPLE_HTML,
        });

        mockGetSerpContextForKeyword.mockResolvedValue({
            keyword: "local seo tools",
            results: [{ url: "https://competitor.com/local-seo", title: "Local SEO", snippet: "..." }],
            formattedContext: "Top SERP results emphasize pricing calculators and GMB checklists.",
        });

        mockGenerateContent.mockResolvedValue({
            text: JSON.stringify({
                title: "Local SEO Tools for Small Businesses (2026 Update)",
                slug: "hallucinated-new-slug",
                content:
                    "## Best Local Listing Platforms\nUpdated guidance.\n\n## Free vs Paid Local Audit Checklists\nComparing local seo pricing tiers and google business profile audit workflow for teams.\n\n## Pricing Comparison\nUpdated plans.",
                excerpt: "Short summary",
                metaDescription: "Updated comparison of local SEO tools and Google Business Profile checklists.",
                targetKeywords: ["local seo tools"],
                faqs: [],
                sections: [],
                quickAnswer: "Direct answer.",
                comparisonTable: [],
            }),
        });

        mockBuildPost.mockImplementation(async (parsed: { title: string; slug: string; content: string; metaDescription: string; targetKeywords: string[] }) => ({
            title: parsed.title,
            slug: parsed.slug,
            content: `<div>${parsed.content}</div>`,
            contentMarkdown: parsed.content,
            excerpt: "Short summary",
            metaDescription: parsed.metaDescription,
            targetKeywords: parsed.targetKeywords,
            validationErrors: [],
            validationWarnings: [],
            validationScore: 92,
            researchPacket: { status: "READY", sources: [] },
            evidencePacket: { claims: [], unsourcedStatistics: [] },
            evidenceCoverage: 100,
            missingEvidence: [],
            riskTier: "low",
            hasFirstPartyEvidence: true,
        }));

        mockEvaluateDraftForPublication.mockResolvedValue({
            evidencePacket: { claims: [], unsourcedStatistics: [] },
            publicationGate: { status: "DRAFT", blockingIssues: [], warnings: [] },
        });
    });

    describe("pure domain, slug, context & diff helpers", () => {
        it("validates site domain ownership and blocks external/unsafe URLs", () => {
            expect(normalizeHostname("https://www.OptiAISEO.online/tools")).toBe("optiaiseo.online");
            expect(isTargetUrlOnSiteDomain("https://optiaiseo.online/tools/seo-tools", "optiaiseo.online")).toBe(true);
            expect(isTargetUrlOnSiteDomain("https://www.optiaiseo.online/tools/seo-tools", "https://optiaiseo.online")).toBe(true);
            expect(isTargetUrlOnSiteDomain("https://docs.optiaiseo.online/guide", "optiaiseo.online")).toBe(true);

            // External, lookalike, credentials, and non-HTTP schemes rejected
            expect(isTargetUrlOnSiteDomain("https://evil.com/tools/seo-tools", "optiaiseo.online")).toBe(false);
            expect(isTargetUrlOnSiteDomain("https://notoptiaiseo.online/tools", "optiaiseo.online")).toBe(false);
            expect(isTargetUrlOnSiteDomain("https://user:pass@optiaiseo.online/tools", "optiaiseo.online")).toBe(false);
            expect(isTargetUrlOnSiteDomain("http://127.0.0.1/latest", "optiaiseo.online")).toBe(false);
            expect(isTargetUrlOnSiteDomain("file:///etc/passwd", "optiaiseo.online")).toBe(false);
        });

        it("preserves canonical slug from existing blog or URL path", () => {
            expect(
                derivePreservedSlug("https://optiaiseo.online/tools/seo-tools-local-business", "custom-db-slug")
            ).toBe("custom-db-slug");
            expect(
                derivePreservedSlug("https://optiaiseo.online/tools/seo-tools-local-business/")
            ).toBe("seo-tools-local-business");
            expect(
                derivePreservedSlug("https://optiaiseo.online/blog/aeo-guide.html")
            ).toBe("aeo-guide");
            expect(derivePreservedSlug("https://optiaiseo.online/")).toBe("home");
        });

        it("computes section-level diff summary and newly covered cluster queries", () => {
            const summary = computeSurgicalRefreshSummary({
                targetUrl: "https://optiaiseo.online/tools/local-seo",
                preservedSlug: "local-seo",
                originalContent: [
                    "# Local SEO Guide",
                    "## Best Listing Platforms",
                    "Consistent citations help rankings.",
                ].join("\n"),
                refreshedContent: [
                    "# Local SEO Guide (2026)",
                    "## Best Listing Platforms",
                    "Consistent citations help rankings with automated checks.",
                    "## Google Business Profile Audit Checklist",
                    "Step-by-step local seo pricing tiers breakdown for small teams.",
                ].join("\n"),
                clusterQueries: [
                    "local seo pricing tiers",
                    "google business profile audit checklist",
                    "consistent citations",
                    "multi-location schema",
                ],
                recommendedAction: "IMPROVE_SEARCH_INTENT",
            });

            expect(summary.preservedSlug).toBe("local-seo");
            expect(summary.targetPath).toBe("/tools/local-seo");
            expect(summary.retainedHeadings).toContain("Best Listing Platforms");
            expect(summary.addedHeadings).toContain("Google Business Profile Audit Checklist");
            expect(summary.wordCountDelta).toBeGreaterThan(0);
            expect(summary.clusterQueriesMissingBefore).toEqual([
                "local seo pricing tiers",
                "google business profile audit checklist",
                "multi-location schema",
            ]);
            expect(summary.clusterQueriesAdded).toEqual([
                "local seo pricing tiers",
                "google business profile audit checklist",
            ]);
            expect(summary.clusterQueriesCovered).toContain("consistent citations");
        });

        it("defaults UPDATE_PAGE topic selection to surgical refresh and preserves metadata", () => {
            const updateSuggestion = {
                keyword: "local seo tools",
                actionType: "UPDATE_PAGE" as const,
                existingPageUrl: "https://optiaiseo.online/tools/seo-tools-local-business",
                recommendedAction: "IMPROVE_SEARCH_INTENT",
                clusterQueries: ["local seo software", "local seo pricing"],
                intent: "Commercial",
                position: 14,
                gscImpressions90d: 420,
            };

            const defaultCtx = buildSelectedTopicContext("local seo tools", updateSuggestion);
            expect(defaultCtx).toMatchObject({
                keyword: "local seo tools",
                actionType: "UPDATE_PAGE",
                existingPageUrl: "https://optiaiseo.online/tools/seo-tools-local-business",
                recommendedAction: "IMPROVE_SEARCH_INTENT",
                clusterQueries: ["local seo software", "local seo pricing"],
                executionMode: "refresh",
            });

            const explicitOverrideCtx = buildSelectedTopicContext(
                "local seo tools",
                updateSuggestion,
                "new_article"
            );
            expect(explicitOverrideCtx?.executionMode).toBe("new_article");

            const createCtx = buildSelectedTopicContext("brand new query", {
                keyword: "brand new query",
                actionType: "CREATE_PAGE",
            });
            expect(createCtx?.executionMode).toBe("new_article");
            expect(buildSelectedTopicContext("custom", null)).toBeUndefined();
        });

        it("builds surgical refresh prompt with canonical slug, recommended action, and cluster queries", () => {
            const prompt = buildSurgicalRefreshPrompt({
                keyword: "local seo tools",
                targetUrl: "https://optiaiseo.online/tools/local-seo",
                preservedSlug: "local-seo",
                siteDomain: "optiaiseo.online",
                recommendedAction: "IMPROVE_SEARCH_INTENT",
                clusterQueries: ["gmb audit checklist", "local citation software"],
                extractedOriginal: "# Local SEO Tools\nExisting copy.",
                serpContextSummary: "SERP summary",
                author: {
                    name: "Kenneth",
                    role: "SEO Architect",
                    realExperience: "Audited 200 local business listings",
                },
                currentYear: 2026,
            });

            expect(prompt).toContain("https://optiaiseo.online/tools/local-seo");
            expect(prompt).toContain('PRESERVED SLUG (MUST REMAIN IDENTICAL): local-seo');
            expect(prompt).toContain("IMPROVE_SEARCH_INTENT");
            expect(prompt).toContain("gmb audit checklist");
            expect(prompt).toContain("local citation software");
            expect(prompt).toContain("Audited 200 local business listings");
        });
    });

    describe("topic submission routing (dispatchTopicAction)", () => {
        const baseAuthor: AuthorSubmissionPayload = {
            authorName: "Kenneth",
            authorRole: "Lead Architect",
            authorBio: "SEO Engineer",
            realExperience: "Built 40+ local audit workflows",
            realNumbers: "3x organic impressions",
            localContext: "US & EMEA",
            keyword: "local seo tools",
            topicContext: {
                keyword: "local seo tools",
                actionType: "UPDATE_PAGE",
                existingPageUrl: "https://optiaiseo.online/tools/local-seo",
                recommendedAction: "IMPROVE_SEARCH_INTENT",
                clusterQueries: ["gmb checklist", "local rank tracker"],
                executionMode: "refresh",
            },
        };

        it("routes UPDATE_PAGE + refresh mode to refreshExistingPageFromGap and never calls generateBlog", async () => {
            const mockRefresh = vi.fn().mockResolvedValue({
                success: true,
                mode: "CONTENT_REFRESH",
            });

            const outcome = await dispatchTopicAction(
                undefined,
                "site-1",
                baseAuthor,
                { requestId: "req-refresh-1" },
                { generateBlogFn: mockGenerateBlogAction, refreshPageFn: mockRefresh }
            );

            expect(outcome.routedMode).toBe("refresh");
            expect(mockRefresh).toHaveBeenCalledTimes(1);
            expect(mockRefresh).toHaveBeenCalledWith(
                expect.objectContaining({
                    siteId: "site-1",
                    targetUrl: "https://optiaiseo.online/tools/local-seo",
                    keyword: "local seo tools",
                    clusterQueries: ["gmb checklist", "local rank tracker"],
                    recommendedAction: "IMPROVE_SEARCH_INTENT",
                    requestId: "req-refresh-1",
                })
            );
            expect(mockGenerateBlogAction).not.toHaveBeenCalled();
        });

        it("routes explicit new_article override to generateBlog and never calls refreshExistingPageFromGap", async () => {
            const mockRefresh = vi.fn();
            mockGenerateBlogAction.mockResolvedValue({ success: true, blogId: "blog-new-1" });

            const overrideAuthor: AuthorSubmissionPayload = {
                ...baseAuthor,
                topicContext: {
                    ...baseAuthor.topicContext!,
                    executionMode: "new_article",
                },
            };

            expect(isSurgicalRefreshSelection(overrideAuthor)).toBe(false);

            const outcome = await dispatchTopicAction(
                "DATA_REPORT",
                "site-1",
                overrideAuthor,
                { preflightId: "pre-1", requestId: "req-new-1" },
                { generateBlogFn: mockGenerateBlogAction, refreshPageFn: mockRefresh }
            );

            expect(outcome.routedMode).toBe("new_article");
            expect(mockRefresh).not.toHaveBeenCalled();
            expect(mockGenerateBlogAction).toHaveBeenCalledTimes(1);
            const passedAuthor = mockGenerateBlogAction.mock.calls[0][2];
            expect(passedAuthor).not.toHaveProperty("topicContext");
        });
    });

    describe("server actions: refreshExistingPageFromGap & refreshDecayingContent", () => {
        it("rejects cross-domain targetUrl before touching credits or fetching", async () => {
            const res = await refreshExistingPageFromGap({
                siteId: "site-1",
                targetUrl: "https://attacker.com/steal-page",
                keyword: "local seo tools",
                requestId: "req-cross-domain",
            });

            expect(res.success).toBe(false);
            expect(res.code).toBe("invalid_target_url");
            expect(mockConsumeCreditsIdempotent).not.toHaveBeenCalled();
            expect(mockConsumeCredits).not.toHaveBeenCalled();
            expect(mockSafeAuditFetch).not.toHaveBeenCalled();
        });

        it("blocks private/SSRF targets via assertSafeAuditUrl before spending credits", async () => {
            mockPrisma.site.findUnique.mockResolvedValueOnce({
                id: "site-1",
                userId: "user-1",
                domain: "127.0.0.1",
            });
            mockAssertSafeAuditUrl.mockRejectedValueOnce(
                new Error("Blocked: loopback address 127.0.0.1 is restricted")
            );

            const res = await refreshExistingPageFromGap({
                siteId: "site-1",
                targetUrl: "http://127.0.0.1/internal-admin",
                keyword: "admin panel",
                requestId: "req-ssrf-1",
            });

            expect(res.success).toBe(false);
            expect(res.code).toBe("ssrf_blocked");
            expect(mockConsumeCreditsIdempotent).not.toHaveBeenCalled();
            expect(mockSafeAuditFetch).not.toHaveBeenCalled();
        });

        it("uses safeAuditFetch in refreshDecayingContent and blocks redirect SSRF errors cleanly", async () => {
            mockSafeAuditFetch.mockRejectedValueOnce(
                new Error("Blocked redirect to private IP 10.0.0.5")
            );

            const res = await refreshDecayingContent(
                "site-1",
                "https://optiaiseo.online/tools/local-seo",
                ["local seo"]
            );

            expect(mockSafeAuditFetch).toHaveBeenCalledWith(
                "https://optiaiseo.online/tools/local-seo",
                expect.objectContaining({
                    headers: { "User-Agent": "SEOTool-Bot/1.0" },
                })
            );
            expect(res.success).toBe(false);
            expect(res.code).toBe("ssrf_blocked");
            expect(mockRefundCredits).toHaveBeenCalledWith("user-1", "blog_generation");
        });

        it("performs surgical refresh via safeAuditFetch, preserves slug, weaves clusterQueries & stores refreshSummary", async () => {
            const res = await refreshExistingPageFromGap({
                siteId: "site-1",
                targetUrl: "https://optiaiseo.online/tools/seo-tools-local-business",
                keyword: "local seo tools",
                clusterQueries: [
                    "local seo pricing tiers",
                    "google business profile audit checklist",
                ],
                recommendedAction: "IMPROVE_SEARCH_INTENT",
                author: {
                    authorName: "Magombe Kenneth",
                    authorRole: "Founder",
                    realExperience: "Rebuilt 120 local pages across 14 markets",
                    realNumbers: "38% higher map pack visibility",
                },
                requestId: "req-gap-refresh-1",
            });

            expect(res.success).toBe(true);
            expect(res.mode).toBe("CONTENT_REFRESH");
            expect(mockSafeAuditFetch).toHaveBeenCalledTimes(1);
            expect(mockConsumeCreditsIdempotent).toHaveBeenCalledWith(
                "user-1",
                "blog_generation",
                "refresh:site-1:req-gap-refresh-1"
            );

            // Prompt must contain target URL, preserved slug, recommended action, cluster queries & author evidence
            const generatedPrompt = mockGenerateContent.mock.calls[0][0].contents as string;
            expect(generatedPrompt).toContain("https://optiaiseo.online/tools/seo-tools-local-business");
            expect(generatedPrompt).toContain("seo-tools-local-business");
            expect(generatedPrompt).toContain("IMPROVE_SEARCH_INTENT");
            expect(generatedPrompt).toContain("local seo pricing tiers");
            expect(generatedPrompt).toContain("google business profile audit checklist");
            expect(generatedPrompt).toContain("Rebuilt 120 local pages across 14 markets");

            // Even though mocked LLM output tried `slug: "hallucinated-new-slug"`, persisted blog preserves canonical path slug
            expect(mockPrisma.blog.create).toHaveBeenCalledTimes(1);
            const createArgs = mockPrisma.blog.create.mock.calls[0][0].data;
            expect(createArgs.pipelineType).toBe("CONTENT_REFRESH");
            expect(createArgs.sourceUrl).toBe("https://optiaiseo.online/tools/seo-tools-local-business");
            expect(createArgs.slug).toBe("seo-tools-local-business");
            expect(createArgs.generationRequestId).toBe("req-gap-refresh-1");
            expect(createArgs.targetKeywords).toEqual(
                expect.arrayContaining([
                    "local seo tools",
                    "local seo pricing tiers",
                    "google business profile audit checklist",
                ])
            );

            // Structured change summary highlights retained vs added sections and newly integrated cluster queries
            expect(res.refreshSummary).toMatchObject({
                preservedSlug: "seo-tools-local-business",
                targetPath: "/tools/seo-tools-local-business",
            });
            expect(res.refreshSummary?.retainedHeadings).toContain("Best Local Listing Platforms");
            expect(res.refreshSummary?.addedHeadings).toContain("Free vs Paid Local Audit Checklists");
            expect(res.refreshSummary?.clusterQueriesAdded).toEqual([
                "local seo pricing tiers",
                "google business profile audit checklist",
            ]);
        });

        it("triggers proposeSingleBlogRefresh and avoids P2002 slug collision when matching PUBLISHED Blog exists", async () => {
            mockPrisma.blog.findFirst
                .mockResolvedValueOnce(null) // generationRequestId lookup
                .mockResolvedValueOnce({
                    id: "existing-blog-99",
                    slug: "seo-tools-local-business",
                    status: "PUBLISHED",
                });

            const res = await refreshExistingPageFromGap({
                siteId: "site-1",
                targetUrl: "https://optiaiseo.online/tools/seo-tools-local-business",
                keyword: "local seo tools",
                clusterQueries: ["local seo pricing tiers"],
                recommendedAction: "REFRESH_CONTENT",
                requestId: "req-existing-blog-1",
            });

            expect(res.success).toBe(true);
            expect(mockProposeSingleBlogRefresh).toHaveBeenCalledWith("existing-blog-99", "user-1");

            const createData = mockPrisma.blog.create.mock.calls[0][0].data;
            expect(createData.sourceUrl).toBe("https://optiaiseo.online/tools/seo-tools-local-business");
            expect(createData.slug).toMatch(/^seo-tools-local-business-refresh-/);
            expect(createData.generationInput.preservedSlug).toBe("seo-tools-local-business");
        });

        it("returns idempotently when generationRequestId already exists without double-charging", async () => {
            const cachedSummary = {
                targetUrl: "https://optiaiseo.online/tools/seo-tools-local-business",
                targetPath: "/tools/seo-tools-local-business",
                preservedSlug: "seo-tools-local-business",
                originalWordCount: 120,
                refreshedWordCount: 450,
                wordCountDelta: 330,
                originalHeadings: [],
                refreshedHeadings: [],
                retainedHeadings: [],
                addedHeadings: [],
                removedHeadings: [],
                clusterQueriesRequested: [],
                clusterQueriesCovered: [],
                clusterQueriesMissingBefore: [],
                clusterQueriesAdded: [],
            };
            mockPrisma.blog.findFirst.mockResolvedValueOnce({
                id: "cached-refresh-1",
                status: "DRAFT",
                pipelineType: "CONTENT_REFRESH",
                generationInput: { mode: "CONTENT_REFRESH", refreshSummary: cachedSummary },
            });

            const res = await refreshExistingPageFromGap({
                siteId: "site-1",
                targetUrl: "https://optiaiseo.online/tools/seo-tools-local-business",
                keyword: "local seo tools",
                requestId: "req-dup-1",
            });

            expect(res.success).toBe(true);
            expect((res.blog as { id: string }).id).toBe("cached-refresh-1");
            expect(mockConsumeCreditsIdempotent).not.toHaveBeenCalled();
            expect(mockGenerateContent).not.toHaveBeenCalled();
        });

        it("refunds idempotent credits when live target page fetch fails with 500", async () => {
            mockSafeAuditFetch.mockResolvedValue({
                ok: false,
                status: 500,
                text: async () => "Internal Server Error",
            });

            const res = await refreshExistingPageFromGap({
                siteId: "site-1",
                targetUrl: "https://optiaiseo.online/tools/seo-tools-local-business",
                keyword: "local seo tools",
                requestId: "req-500-fail",
            });

            expect(res.success).toBe(false);
            expect(res.code).toBe("scrape_failed");
            expect(mockRefundCreditsIdempotent).toHaveBeenCalledWith(
                "user-1",
                10,
                "refund:refresh:site-1:req-500-fail",
                "Target page returned HTTP 500"
            );
        });
    });
});

