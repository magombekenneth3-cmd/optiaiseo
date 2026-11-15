import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRedisStore,
  mockRedisSet,
  mockRedisGet,
  mockGscFindMany,
  mockAuditFindUnique,
  mockAuditUpdate,
  mockPageAuditFindMany,
  mockDiagnosticUpdateMany,
  mockPersistFindingWithEvidence,
  mockWriteMetricSnapshot,
} = vi.hoisted(() => ({
  mockRedisStore: new Map<string, string>(),
  mockRedisSet: vi.fn(),
  mockRedisGet: vi.fn(),
  mockGscFindMany: vi.fn().mockResolvedValue([]),
  mockAuditFindUnique: vi.fn(),
  mockAuditUpdate: vi.fn().mockResolvedValue({}),
  mockPageAuditFindMany: vi.fn().mockResolvedValue([]),
  mockDiagnosticUpdateMany: vi.fn().mockResolvedValue({ count: 0 }),
  mockPersistFindingWithEvidence: vi.fn().mockResolvedValue({ dbId: "f-1", fingerprint: "fp", isNew: true }),
  mockWriteMetricSnapshot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("dns/promises", () => ({
  resolve4: vi.fn(async () => ["93.184.216.34"]),
  resolve6: vi.fn(async () => []),
}));

vi.mock("@/lib/redis", () => {
  mockRedisGet.mockImplementation(async (key: string) => mockRedisStore.get(key) ?? null);
  mockRedisSet.mockImplementation(async (key: string, val: string) => {
    mockRedisStore.set(key, val);
    return "OK";
  });
  return {
    redis: {
      get: (...args: unknown[]) => mockRedisGet(...args),
      set: (...args: unknown[]) => mockRedisSet(...args),
    },
    isRedisConfigured: true,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gscDailyPerformance: {
      findMany: (...args: unknown[]) => mockGscFindMany(...args),
    },
    audit: {
      findUnique: (...args: unknown[]) => mockAuditFindUnique(...args),
      update: (...args: unknown[]) => mockAuditUpdate(...args),
    },
    pageAudit: {
      findMany: (...args: unknown[]) => mockPageAuditFindMany(...args),
    },
    diagnosticFindingRecord: {
      updateMany: (...args: unknown[]) => mockDiagnosticUpdateMany(...args),
    },
  },
}));

vi.mock("@/lib/seo-audit/diagnostic-persistence", () => ({
  persistFindingWithEvidence: (...args: unknown[]) => mockPersistFindingWithEvidence(...args),
  reconcileResolvedFindings: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/metrics/metric-snapshot", () => ({
  writeMetricSnapshot: (...args: unknown[]) => mockWriteMetricSnapshot(...args),
}));

vi.mock("@/lib/keywords/dataforseo", () => ({
  getKeywordMetricsBatch: vi.fn().mockResolvedValue(new Map()),
  getSerpData: vi.fn().mockResolvedValue(null),
  resolveLocationCode: () => 2840,
  DATAFORSEO_LOCATION_CODES: { US: 2840 },
}));

import { KeywordsModule } from "@/lib/seo-audit/modules/keywords";
import { OnPageModule } from "@/lib/seo-audit/modules/onpage";
import { AuditEngine } from "@/lib/seo-audit/engine";
import { buildSiteGraphAnalysis, extractPageGraphNode } from "@/lib/seo-audit/site-graph";
import { analyzeInternalLinksForUrl } from "@/lib/seo-audit/internal-links";
import { aggregateMultiPageAuditResults } from "@/lib/inngest/functions/page-audit";

describe("Workstream B (Tier 2): Cross-Page Graph & Live GSC Cannibalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisStore.clear();
  });

  describe("B1: KeywordsModule live GSC keyword cannibalization", () => {
    const sampleHtml = `
      <html>
        <head><title>Cloud Observability Guide</title></head>
        <body><h1>Cloud Observability Guide</h1><p>Distributed tracing and metrics telemetry.</p></body>
      </html>
    `;

    it("returns Info when siteId is omitted or GSC has no rows", async () => {
      const noSite = await KeywordsModule.run({
        url: "https://acme.io/blog/observability",
        html: sampleHtml,
        frameworkHints: [],
        auditProfile: "page",
        targetKeyword: "cloud observability",
        keywordSource: "explicit",
      });
      expect(mockGscFindMany).not.toHaveBeenCalled();
      expect(noSite.items.find((i) => i.id === "keyword-cannibalization")?.status).toBe("Info");

      mockGscFindMany.mockResolvedValueOnce([]);
      const emptyGsc = await KeywordsModule.run({
        siteId: "site-empty",
        url: "https://acme.io/blog/observability",
        html: sampleHtml,
        frameworkHints: [],
        auditProfile: "page",
        targetKeyword: "cloud observability",
        keywordSource: "explicit",
      });
      expect(emptyGsc.items.find((i) => i.id === "keyword-cannibalization")?.status).toBe("Info");
    });

    it("detects cannibalization across GSC URLs, caches site risks in Redis, and emits Pass for clean pages", async () => {
      // Two URLs competing on "cloud observability" with equal impressions + alternating days -> high risk
      mockGscFindMany.mockResolvedValueOnce([
        { keyword: "cloud observability", url: "https://acme.io/blog/observability", clicks: 12, impressions: 120, ctr: 0.1, position: 6.0, date: "2026-11-01" },
        { keyword: "cloud observability", url: "https://acme.io/product/observability", clicks: 10, impressions: 110, ctr: 0.09, position: 7.0, date: "2026-11-02" },
        { keyword: "cloud observability", url: "https://acme.io/blog/observability", clicks: 14, impressions: 100, ctr: 0.14, position: 5.5, date: "2026-11-03" },
        { keyword: "cloud observability", url: "https://acme.io/product/observability", clicks: 11, impressions: 105, ctr: 0.1, position: 6.5, date: "2026-11-04" },
        // Clean uncompeted page
        { keyword: "api changelog", url: "https://acme.io/changelog", clicks: 40, impressions: 400, ctr: 0.1, position: 3.0, date: "2026-11-01" },
      ]);

      const cannibalRes = await KeywordsModule.run({
        siteId: "site-gsc-1",
        url: "https://acme.io/blog/observability/",
        html: sampleHtml,
        frameworkHints: [],
        auditProfile: "page",
        targetKeyword: "cloud observability",
        keywordSource: "explicit",
      });

      const item = cannibalRes.items.find((i) => i.id === "keyword-cannibalization");
      expect(item).toBeDefined();
      expect(["Fail", "Warning"]).toContain(item?.status);
      expect(item?.finding).toContain("https://acme.io/product/observability");
      expect(item?.details?.gscConnected).toBe(true);
      expect(Number(item?.details?.riskScore)).toBeGreaterThanOrEqual(70);
      expect(item?.status).toBe("Fail");
      expect(mockRedisStore.has("gsc:cannibalization:site-gsc-1")).toBe(true);

      // Second sub-page hits cached gsc:cannibalization:site-gsc-1 (only 1 DB call) and gets Pass
      const cleanRes = await KeywordsModule.run({
        siteId: "site-gsc-1",
        url: "https://acme.io/changelog",
        html: `<html><head><title>API Changelog</title></head><body><h1>API Changelog</h1><p>Latest release notes.</p></body></html>`,
        frameworkHints: [],
        auditProfile: "page",
        targetKeyword: "api changelog",
        keywordSource: "explicit",
      });

      expect(mockGscFindMany).toHaveBeenCalledTimes(1);
      const cleanItem = cleanRes.items.find((i) => i.id === "keyword-cannibalization");
      expect(cleanItem?.status).toBe("Pass");
      expect(cleanItem?.finding).toContain("no competing URLs");
    });
  });

  describe("B2: Cross-page duplicate metadata, BFS click depth, orphan graph & site:crawl cache", () => {
    it("extracts pageGraph cleanly on AuditEngine / OnPageModule without breaking category shapes", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("<html><head><title>Pricing</title><meta name=\"description\" content=\"Transparent plans\"><link rel=\"canonical\" href=\"https://acme.io/pricing\"></head><body><h1>Simple Pricing</h1><a href=\"/docs\">Docs</a></body></html>", { status: 200 }),
      );

      const engine = new AuditEngine([OnPageModule], "page");
      const report = await engine.runAudit("https://acme.io/pricing");

      expect(report.pageGraph).toBeDefined();
      expect(report.pageGraph?.title).toBe("Pricing");
      expect(report.pageGraph?.metaDescription).toBe("Transparent plans");
      expect(report.pageGraph?.h1).toBe("Simple Pricing");
      expect(report.pageGraph?.outboundInternalLinks).toContain("https://acme.io/docs");
      // Stripped from category object after promotion
      expect(report.categories[0].pageGraph).toBeUndefined();

      fetchSpy.mockRestore();
    });

    it("detects duplicate metadata (excluding noindex/non-canonical), BFS clickDepth > 3, true orphans, and populates site:crawl Redis cache", async () => {
      const mkPage = (
        url: string,
        opts: { title: string; desc: string; h1: string; links: string[]; isNoindex?: boolean; canonicalUrl?: string; broken?: Array<{ to: string; status: number | null }> },
      ) => ({
        pageUrl: url,
        overallScore: 78,
        categoryScores: { "on-page": 80 },
        issueList: {
          url,
          recommendations: [],
          pageGraph: {
            url,
            title: opts.title,
            metaDescription: opts.desc,
            h1: opts.h1,
            canonicalUrl: opts.canonicalUrl ?? url,
            isNoindex: Boolean(opts.isNoindex),
            outboundInternalLinks: opts.links,
            brokenInternalLinks: opts.broken,
          },
        },
      });

      const homepageReport = {
        url: "https://acme.io/",
        overallScore: 90,
        categories: [{ id: "on-page", score: 90, items: [] }],
        recommendations: [],
        pageGraph: {
          url: "https://acme.io/",
          title: "Acme Cloud Platform",
          metaDescription: "Monitor apps effortlessly.",
          h1: "Acme Cloud",
          canonicalUrl: "https://acme.io/",
          isNoindex: false,
          outboundInternalLinks: ["https://acme.io/hub"],
        },
      };

      const pageAudits = [
        mkPage("https://acme.io/hub", {
          title: "Product Features",
          desc: "Duplicate description across pages",
          h1: "Features Overview",
          links: ["https://acme.io/category", "https://acme.io/missing-link"],
          broken: [{ to: "https://acme.io/missing-link", status: 404 }],
        }),
        mkPage("https://acme.io/category", {
          title: "Product Features", // Duplicate title with /hub
          desc: "Duplicate description across pages", // Duplicate description with /hub
          h1: "Features Overview", // Duplicate H1 with /hub
          links: ["https://acme.io/topic"],
        }),
        mkPage("https://acme.io/topic", {
          title: "Topic Overview",
          desc: "Unique topic description",
          h1: "Topic Overview",
          links: ["https://acme.io/deep-article"],
        }),
        mkPage("https://acme.io/deep-article", {
          title: "Deep Article Guide",
          desc: "Buried 4 clicks deep",
          h1: "Deep Article",
          links: [],
        }),
        // Noindex page sharing same title must NOT trigger duplicate-title false positive
        mkPage("https://acme.io/preview", {
          title: "Topic Overview",
          desc: "Unique topic description",
          h1: "Topic Overview",
          isNoindex: true,
          links: [],
        }),
      ];

      const sitemapUrls = [
        "https://acme.io/",
        "https://acme.io/hub",
        "https://acme.io/category",
        "https://acme.io/topic",
        "https://acme.io/deep-article",
        "https://acme.io/orphan-landing", // 0 inbound internal links across all crawled pages
        "https://acme.io/preview", // noindex -> ignored for orphan warnings
      ];

      const analysis = buildSiteGraphAnalysis(homepageReport, pageAudits, sitemapUrls);

      expect(analysis.summary.duplicateTitlesCount).toBe(1);
      expect(analysis.summary.duplicateTitles[0].urls).toEqual(["https://acme.io/hub", "https://acme.io/category"]);
      expect(analysis.summary.duplicateDescriptionsCount).toBe(1);
      expect(analysis.summary.duplicateH1sCount).toBe(1);

      expect(analysis.crawlCache.clickDepthMap["https://acme.io/"]).toBe(0);
      expect(analysis.crawlCache.clickDepthMap["https://acme.io/hub"]).toBe(1);
      expect(analysis.crawlCache.clickDepthMap["https://acme.io/category"]).toBe(2);
      expect(analysis.crawlCache.clickDepthMap["https://acme.io/topic"]).toBe(3);
      expect(analysis.crawlCache.clickDepthMap["https://acme.io/deep-article"]).toBe(4);
      expect(analysis.summary.maxClickDepth).toBe(4);
      expect(analysis.summary.deepPages).toEqual([{ url: "https://acme.io/deep-article", depth: 4 }]);

      expect(analysis.crawlCache.orphanPages).toEqual(["https://acme.io/orphan-landing"]);
      expect(analysis.crawlCache.brokenLinks).toEqual([
        { from: "https://acme.io/hub", to: "https://acme.io/missing-link", status: 404 },
      ]);

      // Wire through aggregateMultiPageAuditResults and verify Redis + Audit.issueList + DiagnosticFinding persistence
      mockAuditFindUnique.mockResolvedValueOnce({
        id: "audit-graph-1",
        categoryScores: { "on-page": 90 },
        issueList: homepageReport,
        lcp: 1.9,
        cls: 0.04,
        inp: 90,
      });
      mockPageAuditFindMany.mockResolvedValueOnce(pageAudits);

      await aggregateMultiPageAuditResults("audit-graph-1", "site-graph-1", { sitemapUrls });

      expect(mockAuditUpdate).toHaveBeenCalledTimes(1);
      const updated = mockAuditUpdate.mock.calls[0][0].data.issueList;
      expect(updated.siteGraphSummary.duplicateTitlesCount).toBe(1);
      expect(updated.siteGraphSummary.trueOrphanCount).toBe(1);
      expect(updated.siteGraphSummary.deepPageCount).toBe(1);
      expect(updated.recommendations.some((r: { itemId: string }) => r.itemId === "duplicate-titles")).toBe(true);
      expect(updated.recommendations.some((r: { itemId: string }) => r.itemId === "orphan-pages-site-graph")).toBe(true);

      // Verify DiagnosticFindingRecord persistence for cross-page graph findings
      expect(mockPersistFindingWithEvidence).toHaveBeenCalled();
      const persistedTypes = mockPersistFindingWithEvidence.mock.calls.map((c) => c[1].issueType);
      expect(persistedTypes).toContain("duplicate_titles");
      expect(persistedTypes).toContain("orphan_pages");
      expect(mockDiagnosticUpdateMany).toHaveBeenCalledTimes(1);

      // Verify Redis site:crawl:https://acme.io cache is readable by analyzeInternalLinksForUrl
      expect(mockRedisStore.has("site:crawl:https://acme.io")).toBe(true);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
      const internalLinkRes = await analyzeInternalLinksForUrl(
        "https://acme.io/deep-article",
        "<html><body><p>No links here</p></body></html>",
        { maxLinksToCheck: 0 },
      );
      fetchSpy.mockRestore();

      expect(internalLinkRes.stats.clickDepth).toBe(4);
      expect(internalLinkRes.orphanPages.map((o) => o.url)).toEqual(["https://acme.io/orphan-landing"]);
      expect(internalLinkRes.brokenLinks.some((b) => b.url === "https://acme.io/missing-link")).toBe(true);
    });

    it("extractPageGraphNode handles malformed/cross-domain canonicals cleanly", () => {
      const node = extractPageGraphNode(
        "https://acme.io/dup-param/",
        `<html><head><title>  Hello   World </title><link rel="canonical" href="https://acme.io/canonical-page" /></head><body><h1>Main Header</h1><a href="https://external.com">Ext</a><a href="/about/">About</a></body></html>`,
      );
      expect(node.url).toBe("https://acme.io/dup-param");
      expect(node.title).toBe("Hello World");
      expect(node.canonicalUrl).toBe("https://acme.io/canonical-page");
      expect(node.outboundInternalLinks).toEqual(["https://acme.io/about"]);
    });
  });
});

