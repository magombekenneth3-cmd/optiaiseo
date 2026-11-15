import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRedisStore,
  mockPrismaSiteFindUnique,
  mockGscGroupBy,
  mockGetKeywordMetricsBatch,
  mockGetSerpData,
  mockFetchPsiShared,
  mockFetchCruxShared,
  mockValidateRobotsAndSitemap,
  mockRunSecurityAudit,
  mockProbeLlmCitation,
  mockInspectIndexability,
} = vi.hoisted(() => ({
  mockRedisStore: new Map<string, string>(),
  mockPrismaSiteFindUnique: vi.fn(),
  mockGscGroupBy: vi.fn().mockResolvedValue([]),
  mockGetKeywordMetricsBatch: vi.fn().mockResolvedValue(new Map()),
  mockGetSerpData: vi.fn().mockResolvedValue(null),
  mockFetchPsiShared: vi.fn().mockResolvedValue(null),
  mockFetchCruxShared: vi.fn().mockResolvedValue(null),
  mockValidateRobotsAndSitemap: vi.fn().mockResolvedValue({
    robotsTxtExists: true,
    sitemapReferenced: true,
    sitemapExists: true,
    details: [],
  }),
  mockRunSecurityAudit: vi.fn().mockResolvedValue([]),
  mockProbeLlmCitation: vi.fn().mockResolvedValue({
    score: 4,
    wouldCite: true,
    reasoning: "Strong citations",
    missingSignals: [],
    groundingUsed: false,
    cachedAt: new Date().toISOString(),
  }),
  mockInspectIndexability: vi.fn().mockResolvedValue({
    finalUrl: "https://acme.io/blog/post",
    status: 200,
    redirects: 0,
    blockedByHeader: false,
    xRobotsTag: "",
  }),
}));

vi.mock("dns/promises", () => ({
  resolve4: vi.fn(async () => ["93.184.216.34"]),
  resolve6: vi.fn(async () => []),
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => mockRedisStore.get(key) ?? null),
    set: vi.fn(async (key: string, val: string) => {
      mockRedisStore.set(key, val);
      return "OK";
    }),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    site: { findUnique: (...args: unknown[]) => mockPrismaSiteFindUnique(...args) },
    gscDailyPerformance: { groupBy: (...args: unknown[]) => mockGscGroupBy(...args) },
  },
}));

vi.mock("@/lib/keywords/dataforseo", () => ({
  getKeywordMetricsBatch: (...args: unknown[]) => mockGetKeywordMetricsBatch(...args),
  getSerpData: (...args: unknown[]) => mockGetSerpData(...args),
  resolveLocationCode: () => 2840,
  DATAFORSEO_LOCATION_CODES: { US: 2840 },
}));

vi.mock("@/lib/seo-audit/modules/performance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/seo-audit/modules/performance")>();
  return {
    ...actual,
    fetchPsiShared: (...args: unknown[]) => mockFetchPsiShared(...args),
    fetchCruxShared: (...args: unknown[]) => mockFetchCruxShared(...args),
  };
});

vi.mock("@/lib/onpage/validator", () => ({
  validateRobotsAndSitemap: (...args: unknown[]) => mockValidateRobotsAndSitemap(...args),
}));

vi.mock("@/lib/audit/security", () => ({
  runSecurityAudit: (...args: unknown[]) => mockRunSecurityAudit(...args),
}));

vi.mock("@/lib/seo-audit/llm-citation-probe", () => ({
  probeLlmCitation: (...args: unknown[]) => mockProbeLlmCitation(...args),
}));

vi.mock("@/lib/seo-audit/indexability-evidence", () => ({
  inspectIndexability: (...args: unknown[]) => mockInspectIndexability(...args),
}));

vi.mock("@/lib/crawler/agent", () => ({
  runCrawlerAgent: vi.fn().mockResolvedValue({
    isJavaScriptHeavy: false,
    frameworkDetected: "Next.js",
    hydrationTimeMs: 120,
    crawlerRisks: [],
  }),
}));

import { BrandEntityModule } from "@/lib/seo-audit/modules/brand-entity";
import { SchemaModule } from "@/lib/seo-audit/modules/schema";
import { KeywordsModule } from "@/lib/seo-audit/modules/keywords";
import { TechnicalModule } from "@/lib/seo-audit/modules/technical";
import { OnPageModule } from "@/lib/seo-audit/modules/onpage";
import { AccessibilityModule } from "@/lib/seo-audit/modules/accessibility";
import { AiVisibilityModule } from "@/lib/seo-audit/modules/ai-visibility";
import { isHomepageUrl, resolvePageTargetKeyword } from "@/lib/inngest/functions/page-audit";
import { runTechnicalVerification, createDefaultFetcher, type VerificationFetcher } from "@/lib/seo-audit/verification-runner";
import { analyzeInternalLinksForUrl } from "@/lib/seo-audit/internal-links";
import { extractDiagnosticFindings } from "@/lib/seo-audit/evidence-collector";
import { getAuditEngine } from "@/lib/seo-audit";

describe("Workstream A (Tier 1) Fixes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisStore.clear();
  });

  describe("A1 & A2: BrandEntityModule + SchemaModule SearchAction retirement", () => {
    it("matches customer homepage logo anchors dynamically without hardcoded optiaiseo.online branding", async () => {
      const html = `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta property="og:site_name" content="Acme Cloud" />
            <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
            <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@graph": [
                  {
                    "@type": "Organization",
                    "name": "Acme Cloud",
                    "url": "https://acme.io",
                    "logo": { "@type": "ImageObject", "url": "https://acme.io/logo.png", "width": 200, "height": 50 },
                    "sameAs": ["https://twitter.com/acme", "https://linkedin.com/company/acme"]
                  },
                  {
                    "@type": "WebSite",
                    "name": "Acme Cloud",
                    "url": "https://acme.io",
                    "description": "Cloud observability platform"
                  }
                ]
              }
            </script>
          </head>
          <body>
            <header>
              <a href="https://acme.io/" aria-label="Acme Cloud homepage">
                <img src="/logo.png" alt="Go" />
              </a>
            </header>
            <main><p>Acme Cloud helps teams monitor cloud apps. Acme works everywhere.</p></main>
          </body>
        </html>
      `;

      const brandRes = await BrandEntityModule.run({
        url: "https://acme.io/features/alerts",
        html,
        frameworkHints: [],
        auditProfile: "page",
      });

      const homeAnchor = brandRes.items.find((i) => i.id === "brand-logo-home-anchor");
      const logoAlt = brandRes.items.find((i) => i.id === "brand-logo-alt");
      const websiteSchema = brandRes.items.find((i) => i.id === "brand-website-schema");

      expect(homeAnchor?.status).toBe("Pass");
      expect(websiteSchema?.status).toBe("Pass");
      expect(logoAlt?.recommendation?.text).toContain("Acme Cloud");
      expect(JSON.stringify(brandRes.items).toLowerCase()).not.toContain("optiaiseo");

      const schemaRes = await SchemaModule.run({
        url: "https://acme.io",
        html,
        frameworkHints: [],
        auditProfile: "full",
      });
      const websiteTypeItem = schemaRes.items.find((i) => i.id === "schema-type-website");
      expect(websiteTypeItem?.status).toBe("Pass");
    });

    it("does not fail sub-pages in page profile for missing site-level Organization/WebSite JSON-LD", async () => {
      const html = `<html><body><header><a href="/" aria-label="Acme Home"><img src="/logo.png" alt="Acme Analytics Platform"></a></header><main><p>Acme insights and Acme telemetry.</p></main></body></html>`;
      const res = await BrandEntityModule.run({
        url: "https://acme.io/blog/metrics",
        html,
        frameworkHints: [],
        auditProfile: "page",
      });

      expect(res.items.find((i) => i.id === "brand-org-schema")?.status).toBe("Info");
      expect(res.items.find((i) => i.id === "brand-website-schema")?.status).toBe("Info");
    });
  });

  describe("A3: Sub-page keyword scoping & domain probe caching", () => {
    it("resolves homepage keyword only on root URL and uses GSC page query on sub-pages", async () => {
      expect(isHomepageUrl("https://www.acme.io/", "acme.io")).toBe(true);
      expect(isHomepageUrl("https://acme.io/blog/post", "acme.io")).toBe(false);

      const homeKw = await resolvePageTargetKeyword({
        siteId: "site-1",
        pageUrl: "https://acme.io/",
        siteDomain: "acme.io",
        siteTargetKeyword: "cloud observability",
      });
      expect(homeKw).toEqual({ targetKeyword: "cloud observability", keywordSource: "explicit" });

      mockGscGroupBy.mockResolvedValueOnce([{ keyword: "kubernetes alerts", _sum: { impressions: 420 } }]);
      const gscSubpageKw = await resolvePageTargetKeyword({
        siteId: "site-1",
        pageUrl: "https://acme.io/blog/k8s-alerts",
        siteDomain: "acme.io",
        siteTargetKeyword: "cloud observability",
      });
      expect(gscSubpageKw).toEqual({ targetKeyword: "kubernetes alerts", keywordSource: "gsc_page" });

      mockGscGroupBy.mockResolvedValueOnce([]);
      const unmappedSubpageKw = await resolvePageTargetKeyword({
        siteId: "site-1",
        pageUrl: "https://acme.io/pricing",
        siteDomain: "acme.io",
        siteTargetKeyword: "cloud observability",
      });
      expect(unmappedSubpageKw).toEqual({ targetKeyword: undefined, keywordSource: "inferred" });
    });

    it("strips brand suffix in KeywordsModule and skips DataForSEO / harsh penalties for unmapped sub-pages", async () => {
      const html = `
        <html>
          <head>
            <title>Enterprise Kubernetes Alerts | Acme Corp</title>
            <meta name="description" content="Configure thresholds and monitor pods efficiently.">
          </head>
          <body>
            <h1>Kubernetes Alerting</h1>
            <h2>Cluster Setup</h2>
            <p>${"cluster pod monitoring metrics alerts ".repeat(35)}</p>
            <img src="/diagram.png" alt="Architecture diagram" />
          </body>
        </html>
      `;

      const res = await KeywordsModule.run({
        url: "https://acme.io/docs/alerts",
        html,
        frameworkHints: [],
        auditProfile: "page",
        keywordSource: "inferred",
      });

      expect(mockGetKeywordMetricsBatch).not.toHaveBeenCalled();
      expect(mockGetSerpData).not.toHaveBeenCalled();

      const metricsItem = res.items.find((i) => i.id === "keyword-market-metrics");
      expect(metricsItem?.status).toBe("Info");

      const subheadings = res.items.find((i) => i.id === "keyword-in-subheadings");
      expect(subheadings?.status).toBe("Info");
      expect(subheadings?.details?.primaryKeyword).toBe("enterprise kubernetes");

      const kwAlt = res.items.find((i) => i.id === "keyword-in-image-alt");
      expect(kwAlt?.status).toBe("Info");
    });

    it("skips PSI/CrUX/Security on TechnicalModule and Gemini/Wikidata topic fan-out on AiVisibilityModule in page profile while caching origin files", async () => {
      const html = `<html><head><title>Pricing | Acme</title></head><body><h1>Pricing Plans</h1><p>Affordable plans for teams.</p></body></html>`;

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (urlStr.endsWith("/robots.txt")) {
          return new Response("User-agent: *\nAllow: /\n", { status: 200 });
        }
        if (urlStr.endsWith("/llms.txt")) {
          return new Response("", { status: 404 });
        }
        return new Response("{}", { status: 200 });
      });

      const tech1 = await TechnicalModule.run({
        url: "https://acme.io/pricing",
        html,
        headers: { "content-encoding": "br" },
        frameworkHints: [],
        auditProfile: "page",
      });
      const tech2 = await TechnicalModule.run({
        url: "https://acme.io/about",
        html,
        headers: { "content-encoding": "br" },
        frameworkHints: [],
        auditProfile: "page",
      });

      expect(mockFetchPsiShared).not.toHaveBeenCalled();
      expect(mockFetchCruxShared).not.toHaveBeenCalled();
      expect(mockRunSecurityAudit).not.toHaveBeenCalled();
      expect(mockValidateRobotsAndSitemap).toHaveBeenCalledTimes(1); // Origin-cached across sub-pages
      expect(tech1.items.find((i) => i.id === "core-web-vitals-info")?.status).toBe("Info");
      expect(tech2.items.find((i) => i.id === "security-headers")?.status).toBe("Info");

      process.env.GEMINI_API_KEY = "test-key";
      const ai1 = await AiVisibilityModule.run({
        url: "https://acme.io/pricing",
        html,
        frameworkHints: [],
        auditProfile: "page",
      });
      const ai2 = await AiVisibilityModule.run({
        url: "https://acme.io/about",
        html,
        frameworkHints: [],
        auditProfile: "page",
      });

      expect(mockProbeLlmCitation).not.toHaveBeenCalled();
      expect(ai1.items.find((i) => i.id === "aeo-llm-citation-probe")?.status).toBe("Info");
      expect(ai2.items.find((i) => i.id === "aeo-kg-entity")?.status).toBe("Info");

      // Origin probes cached in Redis: only 1 llms.txt + 1 robots.txt + 1 wikidata brand lookup across 2 pages
      const llmsCalls = fetchSpy.mock.calls.filter(([u]) => String(u).includes("/llms.txt"));
      const robotsCalls = fetchSpy.mock.calls.filter(([u]) => String(u).includes("/robots.txt"));
      expect(llmsCalls).toHaveLength(1);
      expect(robotsCalls).toHaveLength(1);

      fetchSpy.mockRestore();
      delete process.env.GEMINI_API_KEY;
    });
  });

  describe("A4: SSRF protection & RFC-9309 robots evaluation", () => {
    it("evaluates Allow override over shorter Disallow in verifyFix ROBOTS_ALLOWED", async () => {
      const fetcher: VerificationFetcher = {
        fetchHtml: vi.fn(async (url: string) => {
          if (url.endsWith("/robots.txt")) {
            return "User-agent: *\nDisallow: /\nAllow: /blog/\n";
          }
          return "<html></html>";
        }),
        fetchHeaders: vi.fn(async () => ({})),
        getStatus: vi.fn(async () => 200),
      };

      const blogRes = await runTechnicalVerification(
        "https://acme.io/blog/my-post",
        [{ type: "ROBOTS_ALLOWED", url: "/blog/my-post", expected: true }],
        fetcher,
      );
      expect(blogRes.outcome).toBe("TECHNICALLY_VERIFIED");

      const privateRes = await runTechnicalVerification(
        "https://acme.io/admin",
        [{ type: "ROBOTS_ALLOWED", url: "/admin", expected: false }],
        fetcher,
      );
      expect(privateRes.outcome).toBe("TECHNICALLY_VERIFIED");
    });

    it("blocks SSRF redirects in createDefaultFetcher and analyzeInternalLinksForUrl", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        }),
      );

      const defaultFetcher = createDefaultFetcher();
      expect(await defaultFetcher.getStatus("https://example.com/ok")).toBe(0);
      expect(await defaultFetcher.fetchHeaders("https://example.com/ok")).toEqual({});

      const html = `<html><body><a href="https://example.com/redirect-hop">Internal link</a></body></html>`;
      const linkAnalysis = await analyzeInternalLinksForUrl("https://example.com/", html, { maxLinksToCheck: 5 });
      expect(linkAnalysis.brokenLinks).toHaveLength(0);

      // Should have stopped at first hop and never fetched 169.254.169.254
      expect(fetchSpy.mock.calls.every(([u]) => !String(u).includes("169.254.169.254"))).toBe(true);
      fetchSpy.mockRestore();
    });
  });

  describe("A5: Canonical signal ownership across profiles", () => {
    it("defers overlapping checks to canonical modules in full profile while keeping free profile active", async () => {
      const html = `
        <html>
          <head><title>Home</title></head>
          <body>
            <h1>Main Topic</h1>
            <img src="/hero.jpg" />
            <p class="hidden">Mobile navigation drawer links here</p>
          </body>
        </html>
      `;

      const [onPageFull, onPageFree, techFull, techFree, a11yFull, schemaFull] = await Promise.all([
        OnPageModule.run({ url: "https://acme.io/", html, frameworkHints: [], auditProfile: "full" }),
        OnPageModule.run({ url: "https://acme.io/", html, frameworkHints: [], auditProfile: "free" }),
        TechnicalModule.run({ url: "https://acme.io/", html, headers: { "content-encoding": "br" }, frameworkHints: [], auditProfile: "full" }),
        TechnicalModule.run({ url: "https://acme.io/", html, headers: { "content-encoding": "br" }, frameworkHints: [], auditProfile: "free" }),
        AccessibilityModule.run({ url: "https://acme.io/", html, frameworkHints: [], auditProfile: "full" }),
        SchemaModule.run({ url: "https://acme.io/", html, frameworkHints: [], auditProfile: "full" }),
      ]);

      expect(onPageFull.items.find((i) => i.id === "image-alts")?.status).toBe("Info");
      expect(onPageFull.items.find((i) => i.id === "favicon")?.status).toBe("Info");
      expect(onPageFull.items.find((i) => i.id === "json-ld-schema")?.status).toBe("Info");

      expect(onPageFree.items.find((i) => i.id === "image-alts")?.status).toBe("Fail");
      expect(onPageFree.items.find((i) => i.id === "favicon")?.status).toBe("Warning");
      expect(onPageFree.items.find((i) => i.id === "json-ld-schema")?.status).toBe("Fail");

      expect(techFull.items.find((i) => i.id === "technical.schema-quick-check")?.status).toBe("Info");
      expect(techFull.items.find((i) => i.id === "invisible-text-cloaking")?.status).toBe("Info");
      expect(techFree.items.find((i) => i.id === "technical.schema-quick-check")?.status).toBe("Warning");
      expect(mockFetchPsiShared).toHaveBeenCalled(); // free profile still checks PSI in TechnicalModule

      expect(a11yFull.items.find((i) => i.id === "a11y-image-alt")?.status).toBe("Info");
      expect(a11yFull.items.find((i) => i.id === "a11y-heading-structure")?.status).toBe("Info");

      expect(schemaFull.items.find((i) => i.id === "schema-missing-org")?.status).toBe("Info");
      // Evidence collector & root cause engine still extract schema_missing from schema-missing-org Info item
      const { findings } = extractDiagnosticFindings("site-1", "https://acme.io/", [schemaFull]);
      expect(findings.some((f) => f.issueType === "schema_missing")).toBe(true);

      // Engine propagates auditProfile from getAuditEngine factory
      expect(getAuditEngine("page")).toBeDefined();
    });
  });
});

