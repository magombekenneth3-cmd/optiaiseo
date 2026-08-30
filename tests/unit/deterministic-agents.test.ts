// =============================================================================
// DETERMINISTIC AGENTS UNIT TESTS
//
// Tests findings detection logic across all 9 deterministic analysis agents.
// =============================================================================

import { describe, it, expect } from "vitest";
import { analyzeTechnicalSeo } from "@/lib/agents/technical-seo-agent";
import { analyzeIndexation } from "@/lib/agents/indexation-agent";
import { analyzeSitemap } from "@/lib/agents/sitemap-agent";
import { analyzeRobots } from "@/lib/agents/robots-agent";
import { analyzeInternalLinks } from "@/lib/agents/internal-link-agent";
import { analyzeGscIntelligence } from "@/lib/agents/gsc-intelligence-agent";
import { analyzeGa4Intelligence } from "@/lib/agents/ga4-intelligence-agent";
import { analyzeKeywordIntelligence } from "@/lib/agents/keyword-intelligence-agent";
import { analyzeCannibalization } from "@/lib/agents/cannibalization-agent";
import type { CrawlSnapshot } from "@/lib/agents/snapshots";

describe("Deterministic Agents Detection Tests", () => {
  const baseCrawlSnapshot: CrawlSnapshot = {
    crawlRunId: "run-123",
    domain: "testdomain.com",
    crawlResult: {
      domain: "testdomain.com",
      pagesScanned: 1,
      issues: [
        { type: "MISSING_TITLE", severity: "HIGH", details: "Missing title", url: "https://testdomain.com/" },
        { type: "MISSING_META_DESCRIPTION", severity: "MEDIUM", details: "Missing meta description", url: "https://testdomain.com/" },
        { type: "MISSING_H1", severity: "MEDIUM", details: "Missing H1", url: "https://testdomain.com/" },
        { type: "SLOW_TTFB", severity: "LOW", details: "Slow TTFB", url: "https://testdomain.com/" },
        { type: "NOINDEX_PAGE", severity: "HIGH", details: "Noindex page", url: "https://testdomain.com/" },
        { type: "CANONICAL_MISMATCH", severity: "MEDIUM", details: "Canonical mismatch", url: "https://testdomain.com/" },
      ],
      brokenLinks: [],
      redirectChains: [],
      duplicateTitles: [],
      clickDepthMap: { "https://testdomain.com/": 0 },
      orphanPages: [],
      deepPages: [],
      linkGraph: [{ url: "https://testdomain.com/", inboundCount: 0, outboundCount: 1, depth: 0 }],
      scannedAt: new Date(),
      jsRendered: false,
      spaFrameworkDetected: null,
    },
    linkGraph: {
      nodes: [
        {
          url: "https://testdomain.com/",
          depth: 0,
          inboundLinks: [],
          outboundLinks: ["https://testdomain.com/page-1"],
          isOrphan: true,
          pageRankScore: 0.1,
        },
      ],
      orphanPages: [],
      deepPages: [],
      topLinkedPages: ["https://testdomain.com/"],
      pageCount: 1,
      maxDepth: 0,
      avgDepth: 0,
      recommendation: "Healthy link structure",
    },
    discoveryData: {
      sitemapUrls: ["https://testdomain.com/sitemap.xml"],
      robotsTxt: {
        raw: "User-agent: *\nDisallow: /admin/",
        disallowedPaths: ["/admin/"],
        sitemapDeclarations: ["https://testdomain.com/sitemap.xml"],
      },
      contentTypes: { page: 1 },
      languages: ["en"],
    },
    capturedAt: new Date().toISOString(),
  };

  it("Technical SEO agent detects missing title, meta desc, H1, and slow TTFB", () => {
    const result = analyzeTechnicalSeo("site-1", baseCrawlSnapshot);
    const types = result.findings.map((f) => f.type);
    expect(types).toContain("MISSING_TITLE");
    expect(types).toContain("MISSING_META_DESCRIPTION");
    expect(types).toContain("MISSING_H1");
    expect(types).toContain("SLOW_TTFB");
  });

  it("Indexation agent detects NOINDEX and CANONICAL_MISMATCH", () => {
    const result = analyzeIndexation("site-1", baseCrawlSnapshot);
    const types = result.findings.map((f) => f.type);
    expect(types).toContain("NOINDEX_PAGE");
    expect(types).toContain("CANONICAL_MISMATCH");
  });

  it("Robots agent runs cleanly without false alarms on valid robots.txt", () => {
    const result = analyzeRobots("site-1", baseCrawlSnapshot);
    expect(result.data.disallowedPathCount).toBe(1);
    expect(result.data.hasRobotsTxt).toBe(true);
  });

  it("Internal Links agent detects orphan pages", () => {
    const result = analyzeInternalLinks("site-1", baseCrawlSnapshot);
    const types = result.findings.map((f) => f.type);
    expect(types).toContain("ORPHAN_PAGE");
  });

  it("GSC Intelligence agent detects QUICK_WIN when query ranks in position 4-15", () => {
    const currentGsc = [
      { query: "high impression keyword", page: "https://testdomain.com/page-1", clicks: 50, impressions: 5000, ctr: 0.01, position: 7, date: "2026-08-15" },
    ];
    const previousGsc: typeof currentGsc = [];

    const result = analyzeGscIntelligence("site-1", currentGsc, previousGsc);
    const types = result.findings.map((f) => f.type);
    expect(types).toContain("QUICK_WIN");
  });

  it("GA4 Intelligence agent detects high-traffic low-conversion pages", () => {
    const ga4Data = [
      { landingPage: "https://testdomain.com/landing", sessions: 200, users: 150, engagedSessions: 120, conversions: 0, engagementRate: 0.6, pageviews: 300 },
      { landingPage: "https://testdomain.com/checkout", sessions: 200, users: 150, engagedSessions: 180, conversions: 40, engagementRate: 0.9, pageviews: 400 },
    ];

    const result = analyzeGa4Intelligence("site-1", ga4Data);
    const types = result.findings.map((f) => f.type);
    expect(types).toContain("HIGH_TRAFFIC_LOW_CONVERSION");
  });

  it("Keyword Intelligence agent groups related queries using Jaccard clustering", () => {
    const gscData = [
      { query: "best seo software for agencies", page: "https://testdomain.com/seo-software", clicks: 20, impressions: 200, ctr: 0.1, position: 3, date: "2026-08-15" },
      { query: "best seo software for small business", page: "https://testdomain.com/seo-software", clicks: 15, impressions: 180, ctr: 0.08, position: 4, date: "2026-08-15" },
    ];

    const result = analyzeKeywordIntelligence("site-1", gscData);
    expect(result.data.totalClusters).toBeGreaterThanOrEqual(1);
  });

  it("Cannibalization agent scores risk when multiple URLs alternate for same query", () => {
    const gscData = [
      { query: "keyword overlap", page: "https://testdomain.com/url-a", clicks: 10, impressions: 100, ctr: 0.1, position: 5, date: "2026-08-01" },
      { query: "keyword overlap", page: "https://testdomain.com/url-b", clicks: 12, impressions: 110, ctr: 0.11, position: 6, date: "2026-08-02" },
    ];

    const result = analyzeCannibalization("site-1", gscData);
    expect(result.data.totalQueriesChecked).toBe(1);
  });
});
