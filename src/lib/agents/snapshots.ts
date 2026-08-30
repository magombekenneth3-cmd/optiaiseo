// =============================================================================
// SNAPSHOT TYPES — Typed inputs for agent functions
//
// Each agent receives a typed snapshot of the data it needs, ensuring:
// 1. Explicit data dependencies (no implicit DB reads inside agents)
// 2. Reproducibility (snapshot metadata recorded on AgentRun)
// 3. Testability (mock the snapshot, test the agent)
// =============================================================================

import type { CrawlResult } from "@/lib/crawler";
import type { LinkGraphResult } from "@/lib/crawler/link-graph";

// ── Discovery Output ────────────────────────────────────────────────────────

export interface DiscoveryData {
  /** All URLs found across all sitemaps */
  sitemapUrls: string[];

  /** Parsed robots.txt */
  robotsTxt: {
    raw: string;
    disallowedPaths: string[];
    sitemapDeclarations: string[];
  };

  /** Content types by URL pattern, e.g. { blog: 210, product: 80 } */
  contentTypes: Record<string, number>;

  /** Detected language(s) */
  languages: string[];
}

// ── Crawl Snapshot ──────────────────────────────────────────────────────────

/**
 * Output of Discovery + Crawl agents, consumed by all crawl-derived
 * analysis agents (technical SEO, indexation, sitemap, robots, links).
 */
export interface CrawlSnapshot {
  /** ID of the AgentRun that produced this crawl */
  crawlRunId: string;

  /** Domain that was crawled */
  domain: string;

  /** Full crawl result from the existing crawler */
  crawlResult: CrawlResult;

  /** Full link graph from the existing link graph builder */
  linkGraph: LinkGraphResult;

  /** Discovery data (robots, sitemaps) from the discovery agent */
  discoveryData: DiscoveryData;

  /** ISO timestamp of when the crawl completed */
  capturedAt: string;

  /** Provenance metadata */
  crawlerVersion?: string;
  pagesCrawled?: number;
  maxDepthReached?: number;
}

// ── Search Snapshot ─────────────────────────────────────────────────────────

/**
 * GSC + GA4 data context, consumed by search intelligence agents
 * (GSC intelligence, GA4 intelligence, keyword clustering, cannibalization).
 */
export interface SearchSnapshot {
  siteId: string;

  /** Date range of GSC data used */
  gscDateRange: { start: string; end: string };

  /** Date range of GA4 data used */
  ga4DateRange: { start: string; end: string };

  /** ISO timestamp of when this snapshot was assembled */
  capturedAt: string;

  /** Provenance metadata */
  gscPropertyUrl?: string;
  totalQueries?: number;
}

