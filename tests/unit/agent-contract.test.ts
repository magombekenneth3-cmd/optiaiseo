// =============================================================================
// AGENT CONTRACT UNIT TESTS
//
// Verifies that all agent execution results adhere to the core Agent OS contract:
// 1. Findings have valid severities (INFO | LOW | MEDIUM | HIGH | CRITICAL)
// 2. Confidence scores are within [0, 1]
// 3. Every finding has a non-empty SHA-256 fingerprint
// 4. Evidence objects reference valid source types
// 5. Items processed count is >= 0
// =============================================================================

import { describe, it, expect } from "vitest";
import type { AgentExecution } from "@/lib/agents/types";
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

const VALID_SEVERITIES = new Set(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const VALID_SOURCE_TYPES = new Set(["GSC", "GA4", "CRAWL", "SITEMAP", "ROBOTS", "COMPUTED"]);

export function expectValidAgentExecution<T>(execution: AgentExecution<T>) {
  expect(execution).toBeDefined();
  expect(typeof execution.itemsProcessed).toBe("number");
  expect(execution.itemsProcessed).toBeGreaterThanOrEqual(0);

  for (const finding of execution.findings) {
    expect(VALID_SEVERITIES.has(finding.severity)).toBe(true);
    expect(finding.confidence).toBeGreaterThanOrEqual(0);
    expect(finding.confidence).toBeLessThanOrEqual(1);
    expect(finding.fingerprint).toBeDefined();
    expect(finding.fingerprint).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex string

    for (const ev of finding.evidence) {
      expect(VALID_SOURCE_TYPES.has(ev.sourceType)).toBe(true);
    }
  }
}

describe("Agent OS Contract Validation", () => {
  const mockCrawlSnapshot: CrawlSnapshot = {
    crawlRunId: "run-1",
    domain: "example.com",
    crawlResult: {
      domain: "example.com",
      pagesScanned: 1,
      issues: [],
      brokenLinks: [],
      redirectChains: [],
      duplicateTitles: [],
      clickDepthMap: { "https://example.com/": 0 },
      orphanPages: [],
      deepPages: [],
      linkGraph: [{ url: "https://example.com/", inboundCount: 0, outboundCount: 1, depth: 0 }],
      scannedAt: new Date(),
      jsRendered: false,
      spaFrameworkDetected: null,
    },
    linkGraph: {
      nodes: [
        {
          url: "https://example.com/",
          depth: 0,
          inboundLinks: [],
          outboundLinks: ["https://example.com/about"],
          isOrphan: false,
          pageRankScore: 0.5,
        },
      ],
      orphanPages: [],
      deepPages: [],
      topLinkedPages: ["https://example.com/"],
      pageCount: 1,
      maxDepth: 0,
      avgDepth: 0,
      recommendation: "Healthy link structure",
    },
    discoveryData: {
      sitemapUrls: ["https://example.com/sitemap.xml"],
      robotsTxt: { raw: "User-agent: *\nDisallow:", disallowedPaths: [], sitemapDeclarations: [] },
      contentTypes: { page: 1 },
      languages: ["en"],
    },
    capturedAt: new Date().toISOString(),
  };

  it("Technical SEO agent satisfies contract", () => {
    const result = analyzeTechnicalSeo("site-1", mockCrawlSnapshot);
    expectValidAgentExecution(result);
  });

  it("Indexation agent satisfies contract", () => {
    const result = analyzeIndexation("site-1", mockCrawlSnapshot);
    expectValidAgentExecution(result);
  });

  it("Sitemap agent satisfies contract", () => {
    const result = analyzeSitemap("site-1", mockCrawlSnapshot);
    expectValidAgentExecution(result);
  });

  it("Robots agent satisfies contract", () => {
    const result = analyzeRobots("site-1", mockCrawlSnapshot);
    expectValidAgentExecution(result);
  });

  it("Internal Links agent satisfies contract", () => {
    const result = analyzeInternalLinks("site-1", mockCrawlSnapshot);
    expectValidAgentExecution(result);
  });

  it("GSC Intelligence agent satisfies contract", () => {
    const result = analyzeGscIntelligence(
      "site-1",
      [{ query: "test", page: "https://example.com/", clicks: 10, impressions: 100, ctr: 0.1, position: 8, date: "2026-08-01" }],
      [{ query: "test", page: "https://example.com/", clicks: 20, impressions: 100, ctr: 0.2, position: 5, date: "2026-07-01" }],
    );
    expectValidAgentExecution(result);
  });

  it("GA4 Intelligence agent satisfies contract", () => {
    const result = analyzeGa4Intelligence("site-1", [
      { landingPage: "https://example.com/", sessions: 100, users: 80, engagedSessions: 60, conversions: 5, engagementRate: 0.6, pageviews: 200 },
    ]);
    expectValidAgentExecution(result);
  });

  it("Keyword Intelligence agent satisfies contract", () => {
    const result = analyzeKeywordIntelligence("site-1", [
      { query: "seo tool", page: "https://example.com/", clicks: 10, impressions: 100, ctr: 0.1, position: 5, date: "2026-08-01" },
    ]);
    expectValidAgentExecution(result);
  });

  it("Cannibalization agent satisfies contract", () => {
    const result = analyzeCannibalization("site-1", [
      { query: "seo tool", page: "https://example.com/p1", clicks: 10, impressions: 100, ctr: 0.1, position: 5, date: "2026-08-01" },
      { query: "seo tool", page: "https://example.com/p2", clicks: 10, impressions: 100, ctr: 0.1, position: 6, date: "2026-08-02" },
    ]);
    expectValidAgentExecution(result);
  });
});
