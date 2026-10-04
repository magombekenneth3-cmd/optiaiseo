import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolvePageExistence,
  normalizeUrl,
  areUrlsEquivalent,
} from "@/lib/opportunity-engine/page-existence-resolver";
import { generateProposal } from "@/lib/proposals/generator";

// Mock Prisma
vi.mock("@/lib/prisma", () => {
  const mockPrisma = {
    gscDailyPerformance: {
      findMany: vi.fn(),
    },
    blog: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    pageAudit: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    growthDecision: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    actionProposal: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    site: {
      findUnique: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

import { prisma } from "@/lib/prisma";

describe("Page Existence Resolver Hardening — 18 Acceptance Criteria Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Exact existing page -> no creation
  it("1. Exact existing page does not trigger page creation", async () => {
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValue([
      {
        url: "https://example.com/blog/seo-guide",
        keyword: "seo guide",
        clicks: 50,
        impressions: 1000,
        position: 5,
        fetchedAt: new Date(),
      },
    ]);
    (prisma.blog.findMany as any).mockResolvedValue([]);
    (prisma.pageAudit.findMany as any).mockResolvedValue([]);

    const result = await resolvePageExistence("site-1", "seo guide", ["seo guide"]);
    expect(result.verdict).not.toBe("MISSING");
    expect(result.recommendedAction).not.toBe("CREATE_NEW_CONTENT");
    expect(result.existingPage?.url).toContain("seo-guide");
  });

  // Test 2: Existing page with trailing-slash variation -> same page
  it("2. Existing page with trailing-slash variation resolves to same page identity", () => {
    expect(areUrlsEquivalent("https://example.com/seo-audit/", "https://example.com/seo-audit")).toBe(true);
    expect(normalizeUrl("https://example.com/seo-audit/")).toBe(normalizeUrl("https://example.com/seo-audit"));
  });

  // Test 3: Existing page with query parameters -> same page
  it("3. Existing page with query parameters resolves to same page identity", () => {
    expect(areUrlsEquivalent("/seo-audit?utm_source=twitter", "/seo-audit")).toBe(true);
    expect(normalizeUrl("/seo-audit?utm_source=twitter")).toBe(normalizeUrl("/seo-audit"));
  });

  // Test 4: Existing page found in sitemap/blog but absent from GSC -> existing
  it("4. Existing page found in Blog record but absent from GSC is treated as existing", async () => {
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValue([]);
    (prisma.blog.findMany as any).mockResolvedValue([
      {
        id: "blog-1",
        title: "Technical SEO Guide",
        slug: "technical-seo-guide",
        status: "PUBLISHED",
        sourceUrl: "/blog/technical-seo-guide",
        targetKeywords: ["technical seo guide"],
        publishedAt: new Date(),
        needsRefresh: false,
        validationScore: 85,
      },
    ]);
    (prisma.pageAudit.findMany as any).mockResolvedValue([]);

    const result = await resolvePageExistence("site-1", "technical seo guide", []);
    expect(result.verdict).not.toBe("MISSING");
    expect(result.existingPage).not.toBeNull();
    expect(result.existingPage?.matchSource).toBe("BLOG_RECORD");
  });

  // Test 5: Existing page found by crawl but absent from GSC -> existing
  it("5. Existing page found by crawl (PageAudit) but absent from GSC is treated as existing", async () => {
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValue([]);
    (prisma.blog.findMany as any).mockResolvedValue([]);
    (prisma.pageAudit.findMany as any).mockResolvedValue([
      {
        pageUrl: "https://example.com/services/seo-audit",
        overallScore: 80,
        issueList: [],
      },
    ]);

    const result = await resolvePageExistence("site-1", "seo audit", []);
    expect(result.verdict).not.toBe("MISSING");
    expect(result.existingPage?.url).toBe("https://example.com/services/seo-audit");
  });

  // Test 6: GSC ranking URL exists -> existing
  it("6. GSC ranking URL exists -> existing page confirmed", async () => {
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValue([
      {
        url: "https://example.com/link-building",
        keyword: "link building guide",
        clicks: 10,
        impressions: 500,
        position: 12,
        fetchedAt: new Date(),
      },
    ]);
    (prisma.blog.findMany as any).mockResolvedValue([]);
    (prisma.pageAudit.findMany as any).mockResolvedValue([]);

    const result = await resolvePageExistence("site-1", "link building guide", []);
    expect(result.verdict).not.toBe("MISSING");
    expect(result.existingPage?.matchSource).toBe("GSC_RANKING_URL");
  });

  // Test 7: Existing page with poor ranking -> fix existing
  it("7. Existing page with poor ranking -> EXISTING_NEEDS_FIX", async () => {
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValue([
      {
        url: "https://example.com/keyword-research",
        keyword: "keyword research",
        clicks: 2,
        impressions: 400,
        position: 35,
        fetchedAt: new Date(),
      },
    ]);
    (prisma.blog.findMany as any).mockResolvedValue([]);
    (prisma.pageAudit.findMany as any).mockResolvedValue([]);

    const result = await resolvePageExistence("site-1", "keyword research", []);
    expect(result.verdict).toBe("EXISTING_NEEDS_FIX");
    expect(result.recommendedAction).toBe("OPTIMIZE_CONTENT_DEPTH");
  });

  // Test 8: High impressions + poor CTR -> title/meta optimization
  it("8. High impressions + poor CTR -> OPTIMIZE_TITLE", async () => {
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValue([
      {
        url: "https://example.com/rank-checker",
        keyword: "rank checker",
        clicks: 1,
        impressions: 2000,
        position: 4,
        fetchedAt: new Date(),
      },
    ]);
    (prisma.blog.findMany as any).mockResolvedValue([]);
    (prisma.pageAudit.findMany as any).mockResolvedValue([]);

    const result = await resolvePageExistence("site-1", "rank checker", []);
    expect(result.verdict).toBe("EXISTING_NEEDS_FIX");
    expect(result.recommendedAction).toBe("OPTIMIZE_TITLE");
  });

  // Test 9: Noindex existing page -> indexation fix (MODIFY_ROBOTS_META)
  it("9. Noindex existing page -> MODIFY_ROBOTS_META", async () => {
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValue([]);
    (prisma.blog.findMany as any).mockResolvedValue([]);
    (prisma.pageAudit.findMany as any).mockResolvedValue([
      {
        pageUrl: "https://example.com/noindex-guide",
        overallScore: 60,
        issueList: ["noindex tag present"],
      },
    ]);

    const result = await resolvePageExistence("site-1", "noindex guide", []);
    expect(result.verdict).toBe("EXISTING_NEEDS_FIX");
    expect(result.recommendedAction).toBe("MODIFY_ROBOTS_META");
  });

  // Test 10: Incorrect canonical -> CHANGE_CANONICAL
  it("10. Incorrect canonical -> CHANGE_CANONICAL", async () => {
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValue([]);
    (prisma.blog.findMany as any).mockResolvedValue([]);
    (prisma.pageAudit.findMany as any).mockResolvedValue([
      {
        pageUrl: "https://example.com/canonical-test",
        overallScore: 65,
        issueList: ["canonical mismatch detected"],
      },
    ]);

    const result = await resolvePageExistence("site-1", "canonical test", []);
    expect(result.verdict).toBe("EXISTING_NEEDS_FIX");
    expect(result.recommendedAction).toBe("CHANGE_CANONICAL");
  });

  // Test 11: Two URLs same intent -> cannibalization
  it("11. Two URLs with same intent ranking for same query -> EXISTING_CANNIBALIZED", async () => {
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValue([
      {
        url: "https://example.com/blog/best-seo-tools",
        keyword: "best seo tools",
        clicks: 20,
        impressions: 500,
        position: 8,
        fetchedAt: new Date(),
      },
      {
        url: "https://example.com/blog/top-seo-tools",
        keyword: "best seo tools",
        clicks: 15,
        impressions: 450,
        position: 11,
        fetchedAt: new Date(),
      },
    ]);
    (prisma.blog.findMany as any).mockResolvedValue([]);
    (prisma.pageAudit.findMany as any).mockResolvedValue([]);

    const result = await resolvePageExistence("site-1", "best seo tools", []);
    expect(result.verdict).toBe("EXISTING_CANNIBALIZED");
    expect(result.recommendedAction).toBe("CONSOLIDATE_CONTENT");
  });

  // Test 12: Two URLs different intent -> do not consolidate
  it("12. Two URLs with different intent -> do not consolidate", async () => {
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValue([
      {
        url: "https://example.com/tools/seo-checker",
        keyword: "seo software",
        clicks: 30,
        impressions: 800,
        position: 6,
        fetchedAt: new Date(),
      },
      {
        url: "https://example.com/blog/how-to-choose-software",
        keyword: "seo software",
        clicks: 5,
        impressions: 200,
        position: 18,
        fetchedAt: new Date(),
      },
    ]);
    (prisma.blog.findMany as any).mockResolvedValue([]);
    (prisma.pageAudit.findMany as any).mockResolvedValue([]);

    const result = await resolvePageExistence("site-1", "seo software", []);
    expect(result.verdict).not.toBe("EXISTING_CANNIBALIZED");
  });

  // Test 13: Low-confidence match -> NEEDS_REVIEW
  it("13. Low-confidence match -> NEEDS_REVIEW (never auto-create)", async () => {
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValue([]);
    (prisma.blog.findMany as any).mockResolvedValue([]);
    (prisma.pageAudit.findMany as any).mockResolvedValue([
      {
        pageUrl: "https://example.com/general-schema-guide",
        overallScore: 70,
        issueList: [],
      },
    ]);

    const result = await resolvePageExistence("site-1", "specific advanced schema markup", []);
    expect(result.verdict).toBe("NEEDS_REVIEW");
    expect(result.recommendedAction).toBe("NEEDS_REVIEW");
  });

  // Test 14: No suitable page + GSC demand -> create
  it("14. No suitable page found -> MISSING -> CREATE_NEW_CONTENT", async () => {
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValue([]);
    (prisma.blog.findMany as any).mockResolvedValue([]);
    (prisma.pageAudit.findMany as any).mockResolvedValue([]);

    const result = await resolvePageExistence("site-1", "uncovered enterprise topic", []);
    expect(result.verdict).toBe("MISSING");
    expect(result.recommendedAction).toBe("CREATE_NEW_CONTENT");
  });

  // Test 15: No suitable page + TOPIC_OPPORTUNITY -> create
  it("15. Completely absent topic -> MISSING verdict with full candidate count metadata", async () => {
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValue([]);
    (prisma.blog.findMany as any).mockResolvedValue([]);
    (prisma.pageAudit.findMany as any).mockResolvedValue([]);

    const result = await resolvePageExistence("site-1", "brand new niche topic", []);
    expect(result.verdict).toBe("MISSING");
    expect(result.allCandidates.length).toBe(0);
    expect(result.existingPage).toBeNull();
  });

  // Test 16: GSC URL exists but crawl missed it -> existing candidate + evidence preserved
  it("16. GSC URL exists but crawl missed it -> existing candidate preserved", async () => {
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValue([
      {
        url: "https://example.com/landing/uncrawled-page",
        keyword: "uncrawled keyword",
        clicks: 5,
        impressions: 150,
        position: 14,
        fetchedAt: new Date(),
      },
    ]);
    (prisma.blog.findMany as any).mockResolvedValue([]);
    (prisma.pageAudit.findMany as any).mockResolvedValue([]);

    const result = await resolvePageExistence("site-1", "uncrawled keyword", []);
    expect(result.verdict).not.toBe("MISSING");
    expect(result.existingPage?.url).toContain("uncrawled-page");
  });

  // Test 17: EXISTING_HEALTHY -> MONITOR -> generateProposal() returns SKIPPED
  it("17. EXISTING_HEALTHY -> MONITOR -> generateProposal returns SKIPPED with zero mutations", async () => {
    (prisma.growthDecision.findUnique as any).mockResolvedValue({
      id: "dec-1",
      siteId: "site-1",
      url: "https://example.com/healthy-page",
      primaryKeyword: "healthy keyword",
      action: "MONITOR",
      opportunityStatus: "OPEN",
      whyNow: { pageExistence: { verdict: "EXISTING_HEALTHY" } },
      sourceFindings: [],
    });

    const res = await generateProposal({ decisionId: "dec-1" });
    expect(res.status).toBe("SKIPPED");
    expect(res.proposalId).toBeNull();
    expect(res.reason).toContain("Non-mutating action");
    expect(prisma.actionProposal.create).not.toHaveBeenCalled();
  });

  // Test 18: MISSING -> GENERATE_CONTENT_BRIEF -> valid creation proposal
  it("18. MISSING -> GENERATE_CONTENT_BRIEF -> valid creation proposal produced", async () => {
    (prisma.growthDecision.findUnique as any).mockResolvedValue({
      id: "dec-2",
      siteId: "site-1",
      url: "https://example.com/suggested-new-page",
      primaryKeyword: "new target keyword",
      action: "CREATE_NEW_CONTENT",
      opportunityStatus: "OPEN",
      impact: { trafficPotential: { expected: 100, confidence: 0.8 } },
      whyNow: { pageExistence: { verdict: "MISSING", candidateCount: 0 } },
      sourceFindings: [],
    });
    (prisma.actionProposal.findUnique as any).mockResolvedValue(null);
    (prisma.blog.findFirst as any).mockResolvedValue(null);
    (prisma.pageAudit.findFirst as any).mockResolvedValue(null);
    (prisma.site.findUnique as any).mockResolvedValue({ domain: "example.com" });
    (prisma.actionProposal.create as any).mockImplementation(({ data }: any) => ({
      id: "prop-new-content",
      ...data,
    }));

    const res = await generateProposal({ decisionId: "dec-2" });
    expect(res.status).toBe("CREATED");
    expect(res.actionType).toBe("GENERATE_CONTENT_BRIEF");
    expect(res.proposalId).toBe("prop-new-content");
    expect(prisma.actionProposal.create).toHaveBeenCalled();
  });

  // Test 19: Real GSC integration scenario
  it("19. Realistic GSC persisted data -> EXISTING_NEEDS_FIX targeting /seo-audit", async () => {
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValue([
      {
        url: "/seo-audit",
        keyword: "seo audit tool",
        clicks: 10,
        impressions: 3200,
        position: 14.2,
        fetchedAt: new Date(),
      },
    ]);
    (prisma.blog.findMany as any).mockResolvedValue([]);
    (prisma.pageAudit.findMany as any).mockResolvedValue([]);

    const result = await resolvePageExistence("site-1", "seo audit tool", ["seo audit tool"]);
    expect(result.verdict).toBe("EXISTING_NEEDS_FIX");
    expect(result.existingPage?.url).toBe("/seo-audit");
    expect(result.recommendedAction).toBe("OPTIMIZE_TITLE");
    expect(result.recommendedAction).not.toBe("CREATE_NEW_CONTENT");
    expect(result.existingPage?.currentImpressions).toBe(3200);
    expect(result.existingPage?.currentPosition).toBe(14.2);
  });

  // Test 20: Verify stale/no-GSC published page protects newly created pages
  it("20. Stale / zero-GSC published page in PageAudit protects page from being recreated", async () => {
    (prisma.gscDailyPerformance.findMany as any).mockResolvedValue([]);
    (prisma.blog.findMany as any).mockResolvedValue([]);
    (prisma.pageAudit.findMany as any).mockResolvedValue([
      {
        pageUrl: "/newly-published-seo-guide",
        overallScore: 88,
        issueList: [],
      },
    ]);

    const result = await resolvePageExistence("site-1", "newly published seo guide", []);
    expect(result.verdict).not.toBe("MISSING");
    expect(result.recommendedAction).not.toBe("CREATE_NEW_CONTENT");
    expect(result.existingPage?.url).toBe("/newly-published-seo-guide");
  });

  // Test 21: Complete proposal target path verification
  it("21. Complete proposal path preserves /services/seo-audit targetUrl and resolves PageAudit model", async () => {
    (prisma.growthDecision.findUnique as any).mockResolvedValue({
      id: "dec-services-audit",
      siteId: "site-1",
      url: "/services/seo-audit",
      primaryKeyword: "enterprise seo audit",
      action: "REFRESH_CONTENT",
      opportunityStatus: "OPEN",
      whyNow: { pageExistence: { verdict: "EXISTING_NEEDS_FIX", existingUrl: "/services/seo-audit" } },
      sourceFindings: [],
    });
    (prisma.actionProposal.findUnique as any).mockResolvedValue(null);
    (prisma.blog.findFirst as any).mockResolvedValue(null);
    (prisma.pageAudit.findFirst as any).mockResolvedValue({
      id: "page-audit-id-999",
      pageUrl: "/services/seo-audit",
      siteId: "site-1",
    });
    (prisma.site.findUnique as any).mockResolvedValue({ domain: "example.com" });
    (prisma.actionProposal.create as any).mockImplementation(({ data }: any) => ({
      id: "prop-services-audit",
      ...data,
    }));

    const res = await generateProposal({ decisionId: "dec-services-audit" });
    expect(res.status).toBe("CREATED");
    expect(res.actionType).toBe("REFRESH_CONTENT");
    expect(prisma.actionProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetUrl: "/services/seo-audit",
          targetModel: "PageAudit",
          targetId: "page-audit-id-999",
        }),
      })
    );
  });
});
