// =============================================================================
// CRAWL AGENT — Wraps the existing crawler into the agent contract
//
// Pure function (aside from the underlying crawler's HTTP requests).
// Takes discovery data as input, runs the existing crawlSite + buildLinkGraph,
// and transforms their outputs into AgentExecution<CrawlAgentData>.
//
// The underlying crawler and link-graph builder are NOT modified.
// =============================================================================

import { crawlSite, type CrawlResult, type CrawlIssue } from "@/lib/crawler";
import { buildLinkGraph, type LinkGraphResult } from "@/lib/crawler/link-graph";
import { createFindingFingerprint } from "./fingerprint";
import type {
  AgentExecution,
  AgentFinding,
  AgentError,
  FindingSeverity,
} from "./types";
import type { DiscoveryData } from "./snapshots";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CrawlAgentData {
  crawlResult: CrawlResult;
  linkGraph: LinkGraphResult;
}

// ── Severity Mapping ────────────────────────────────────────────────────────

const ISSUE_TYPE_TO_FINDING: Partial<Record<
  CrawlIssue["type"],
  { findingType: string; severity: FindingSeverity; title: string }
>> = {
  broken_link: {
    findingType: "BROKEN_LINK",
    severity: "HIGH",
    title: "Broken internal link detected",
  },
  redirect_chain: {
    findingType: "REDIRECT_CHAIN",
    severity: "MEDIUM",
    title: "Redirect chain detected",
  },
  duplicate_title: {
    findingType: "DUPLICATE_TITLE",
    severity: "MEDIUM",
    title: "Duplicate page title",
  },
  missing_canonical: {
    findingType: "MISSING_CANONICAL",
    severity: "MEDIUM",
    title: "Missing canonical tag",
  },
  thin_content: {
    findingType: "THIN_CONTENT",
    severity: "LOW",
    title: "Thin content page",
  },
  slow_page: {
    findingType: "SLOW_PAGE",
    severity: "MEDIUM",
    title: "Slow page response time",
  },
  deep_click_depth: {
    findingType: "DEEP_CLICK_DEPTH",
    severity: "LOW",
    title: "Page too deep in site structure",
  },
  orphan_page: {
    findingType: "ORPHAN_PAGE",
    severity: "MEDIUM",
    title: "Orphan page (no internal links)",
  },
};

// ── Public API ──────────────────────────────────────────────────────────────

export async function analyzeCrawl(
  siteId: string,
  domain: string,
  discoveryData: DiscoveryData,
  options?: { maxPages?: number; maxDepth?: number },
): Promise<AgentExecution<CrawlAgentData>> {
  const findings: AgentFinding[] = [];
  const errors: AgentError[] = [];

  const origin = domain.startsWith("http") ? domain : `https://${domain}`;

  // 1. Run the existing crawler
  let crawlResult: CrawlResult;
  try {
    crawlResult = await crawlSite(origin, {
      maxPages: options?.maxPages ?? 50,
      maxDepth: options?.maxDepth ?? 4,
      jsRendering: "auto",
    });
  } catch (err: unknown) {
    return {
      data: {
        crawlResult: {
          domain: origin,
          pagesScanned: 0,
          issues: [],
          brokenLinks: [],
          redirectChains: [],
          duplicateTitles: [],
          clickDepthMap: {},
          orphanPages: [],
          deepPages: [],
          linkGraph: [],
          scannedAt: new Date(),
          jsRendered: false,
          spaFrameworkDetected: null,
        },
        linkGraph: {
          nodes: [],
          orphanPages: [],
          deepPages: [],
          topLinkedPages: [],
          pageCount: 0,
          maxDepth: 0,
          avgDepth: 0,
          recommendation: "",
        },
      },
      findings: [],
      errors: [
        {
          code: "CRAWL_FAILED",
          message: (err as Error)?.message ?? String(err),
          recoverable: false,
        },
      ],
      itemsProcessed: 0,
    };
  }

  // 2. Run the link graph builder
  let linkGraph: LinkGraphResult;
  try {
    linkGraph = await buildLinkGraph(origin, options?.maxPages ?? 50);
  } catch (err: unknown) {
    errors.push({
      code: "LINK_GRAPH_FAILED",
      message: (err as Error)?.message ?? String(err),
      recoverable: true,
    });
    linkGraph = {
      nodes: [],
      orphanPages: [],
      deepPages: [],
      topLinkedPages: [],
      pageCount: 0,
      maxDepth: 0,
      avgDepth: 0,
      recommendation: "",
    };
  }

  // 3. Convert CrawlIssue[] → AgentFinding[]
  for (const issue of crawlResult.issues) {
    const mapping = ISSUE_TYPE_TO_FINDING[issue.type];
    if (!mapping) continue;

    findings.push({
      type: mapping.findingType,
      severity: mapping.severity,
      title: mapping.title,
      description: issue.details,
      evidence: [
        {
          sourceType: "CRAWL",
          sourceId: issue.url,
          metric: "issueType",
          value: issue.type,
          metadata: { severity: issue.severity },
          observedAt: crawlResult.scannedAt.toISOString(),
        },
      ],
      confidence: 1.0,
      affectedResource: { type: "PAGE", id: issue.url },
      fingerprint: createFindingFingerprint({
        siteId,
        type: mapping.findingType,
        resourceType: "PAGE",
        resourceId: issue.url,
      }),
    });
  }

  return {
    data: { crawlResult, linkGraph },
    findings,
    errors: errors.length > 0 ? errors : undefined,
    itemsProcessed: crawlResult.pagesScanned,
  };
}
