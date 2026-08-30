// =============================================================================
// INDEXATION AGENT — Determines page indexability and finds contradictions
//
// Pure function. No Prisma, no Inngest, no HTTP.
// Combines crawl data + sitemap data + robots.txt to classify each page.
// =============================================================================

import { createFindingFingerprint } from "./fingerprint";
import type { AgentExecution, AgentFinding } from "./types";
import type { CrawlSnapshot } from "./snapshots";

// ── Types ───────────────────────────────────────────────────────────────────

export type IndexabilityStatus =
  | "INDEXABLE"
  | "NOT_INDEXABLE"
  | "CONFLICTING"
  | "UNKNOWN";

export interface PageIndexability {
  url: string;
  status: IndexabilityStatus;
  inSitemap: boolean;
  blockedByRobots: boolean;
  reasons: string[];
}

export interface IndexationData {
  pages: PageIndexability[];
  indexableCount: number;
  notIndexableCount: number;
  conflictingCount: number;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function analyzeIndexation(
  siteId: string,
  snapshot: CrawlSnapshot,
): AgentExecution<IndexationData> {
  const findings: AgentFinding[] = [];
  const { crawlResult, discoveryData } = snapshot;

  // Build sets for fast lookup
  const sitemapUrls = new Set(
    discoveryData.sitemapUrls.map((u) => normalizeUrl(u)),
  );
  const blockedPaths = discoveryData.robotsTxt.disallowedPaths;

  // Get all URLs from crawl
  const crawledUrls = crawlResult.linkGraph.map((n) => n.url);
  const pages: PageIndexability[] = [];

  let indexableCount = 0;
  let notIndexableCount = 0;
  let conflictingCount = 0;

  for (const url of crawledUrls) {
    const normalizedUrl = normalizeUrl(url);
    const inSitemap = sitemapUrls.has(normalizedUrl);
    const blockedByRobots = isBlockedByRobots(url, blockedPaths);

    const reasons: string[] = [];
    let status: IndexabilityStatus = "INDEXABLE";

    if (blockedByRobots) {
      reasons.push("Blocked by robots.txt");
      status = "NOT_INDEXABLE";
    }

    // Check for contradictions
    if (inSitemap && blockedByRobots) {
      status = "CONFLICTING";
      reasons.push("In sitemap but blocked by robots.txt");

      findings.push({
        type: "INDEXATION_CONFLICT",
        severity: "HIGH",
        title: "Indexation conflict: page in sitemap but blocked by robots.txt",
        description: `${url} is listed in the XML sitemap but is blocked by robots.txt. This sends contradictory signals to search engines.`,
        evidence: [
          {
            sourceType: "SITEMAP",
            metric: "inSitemap",
            value: "true",
            observedAt: new Date().toISOString(),
          },
          {
            sourceType: "ROBOTS",
            metric: "blocked",
            value: "true",
            observedAt: new Date().toISOString(),
          },
        ],
        confidence: 1.0,
        affectedResource: { type: "PAGE", id: url },
        fingerprint: createFindingFingerprint({
          siteId,
          type: "INDEXATION_CONFLICT",
          resourceType: "PAGE",
          resourceId: url,
        }),
      });

      conflictingCount++;
    } else if (status === "INDEXABLE") {
      indexableCount++;
    } else {
      notIndexableCount++;
    }

    pages.push({ url, status, inSitemap, blockedByRobots, reasons });
  }

  // Check crawlResult.issues for indexation-related signals
  for (const issue of crawlResult.issues) {
    if (issue.type === "NOINDEX_PAGE") {
      notIndexableCount++;
      findings.push({
        type: "NOINDEX_PAGE",
        severity: "HIGH",
        title: "Page has noindex directive",
        description: `${issue.url} has a noindex directive, preventing it from being indexed by search engines.`,
        evidence: [
          {
            sourceType: "CRAWL",
            sourceId: issue.url,
            metric: "noindex",
            value: "true",
            observedAt: new Date().toISOString(),
          },
        ],
        confidence: 1.0,
        affectedResource: { type: "PAGE", id: issue.url },
        fingerprint: createFindingFingerprint({
          siteId,
          type: "NOINDEX_PAGE",
          resourceType: "PAGE",
          resourceId: issue.url,
        }),
      });
    }

    if (issue.type === "CANONICAL_MISMATCH") {
      conflictingCount++;
      findings.push({
        type: "CANONICAL_MISMATCH",
        severity: "MEDIUM",
        title: "Canonical URL mismatch",
        description: `${issue.url} has a canonical URL that doesn't match the page URL. This may cause indexation confusion.`,
        evidence: [
          {
            sourceType: "CRAWL",
            sourceId: issue.url,
            metric: "canonicalMismatch",
            value: "true",
            observedAt: new Date().toISOString(),
          },
        ],
        confidence: 1.0,
        affectedResource: { type: "PAGE", id: issue.url },
        fingerprint: createFindingFingerprint({
          siteId,
          type: "CANONICAL_MISMATCH",
          resourceType: "PAGE",
          resourceId: issue.url,
        }),
      });
    }
  }

  return {
    data: { pages, indexableCount, notIndexableCount, conflictingCount },
    findings,
    itemsProcessed: crawledUrls.length,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slash, lowercase hostname
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/$/, "");
  }
}

function isBlockedByRobots(url: string, disallowedPaths: string[]): boolean {
  try {
    const pathname = new URL(url).pathname;
    return disallowedPaths.some((blocked) => pathname.startsWith(blocked));
  } catch {
    return false;
  }
}
