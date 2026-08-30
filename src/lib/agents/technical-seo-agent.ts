// =============================================================================
// TECHNICAL SEO AGENT — Deterministic page-level SEO analysis
//
// Pure function. No Prisma, no Inngest, no HTTP.
// Consumes CrawlSnapshot and produces findings for common on-page SEO issues.
// All findings have confidence = 1.0 (deterministic checks).
// =============================================================================

import { createFindingFingerprint } from "./fingerprint";
import type { AgentExecution, AgentFinding } from "./types";
import type { CrawlSnapshot } from "./snapshots";

// ── Types ───────────────────────────────────────────────────────────────────

export interface TechnicalSeoData {
  pagesAnalyzed: number;
  issuesByType: Record<string, number>;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function analyzeTechnicalSeo(
  siteId: string,
  snapshot: CrawlSnapshot,
): AgentExecution<TechnicalSeoData> {
  const findings: AgentFinding[] = [];
  const issuesByType: Record<string, number> = {};

  const { crawlResult } = snapshot;
  const pages = crawlResult.linkGraph; // Array of { url, inboundCount, outboundCount, depth }

  // Check each page's issues from the crawl result
  for (const issue of crawlResult.issues) {
    const mapping = ISSUE_TYPE_MAP[issue.type];
    if (!mapping) continue;

    issuesByType[mapping.findingType] = (issuesByType[mapping.findingType] ?? 0) + 1;

    // Create findings for each crawl issue
    addFinding(findings, siteId, {
      type: mapping.findingType,
      severity: mapping.severity,
      title: mapping.title,
      description: issue.details ?? `${mapping.title} on ${issue.url}`,
      url: issue.url,
      metric: "issueType",
      value: issue.type,
    });
  }

  // Additional checks: orphan pages
  for (const orphanUrl of crawlResult.orphanPages) {
    addFinding(findings, siteId, {
      type: "ORPHAN_PAGE",
      severity: "MEDIUM",
      title: "Orphan page — no internal links pointing here",
      description: `${orphanUrl} has no internal inbound links. It may be difficult for search engines to discover and index this page.`,
      url: orphanUrl,
      metric: "inboundLinks",
      value: "0",
    });
    issuesByType["ORPHAN_PAGE"] = (issuesByType["ORPHAN_PAGE"] ?? 0) + 1;
  }

  // Additional checks: deep pages (depth > 3)
  for (const deepUrl of crawlResult.deepPages) {
    const depth = crawlResult.clickDepthMap[deepUrl] ?? 4;
    addFinding(findings, siteId, {
      type: "DEEP_PAGE",
      severity: "LOW",
      title: "Page too deep in site structure",
      description: `${deepUrl} is at click depth ${depth} (> 3). Important pages should be reachable within 3 clicks from the homepage.`,
      url: deepUrl,
      metric: "clickDepth",
      value: String(depth),
    });
    issuesByType["DEEP_PAGE"] = (issuesByType["DEEP_PAGE"] ?? 0) + 1;
  }

  // Check for redirect chains
  for (const chain of crawlResult.redirectChains) {
    if (chain.chain.length > 2) {
      addFinding(findings, siteId, {
        type: "LONG_REDIRECT_CHAIN",
        severity: "HIGH",
        title: "Long redirect chain detected",
        description: `${chain.url} has a redirect chain of ${chain.chain.length} hops: ${chain.chain.join(" → ")}. This wastes crawl budget and link equity.`,
        url: chain.url,
        metric: "redirectHops",
        value: String(chain.chain.length),
        metadata: { chain: chain.chain },
      });
      issuesByType["LONG_REDIRECT_CHAIN"] =
        (issuesByType["LONG_REDIRECT_CHAIN"] ?? 0) + 1;
    }
  }

  // Check for duplicate titles
  for (const dup of crawlResult.duplicateTitles) {
    if (dup.urls.length > 1) {
      for (const url of dup.urls) {
        addFinding(findings, siteId, {
          type: "DUPLICATE_TITLE",
          severity: "MEDIUM",
          title: "Duplicate page title",
          description: `"${dup.title}" is used on ${dup.urls.length} pages: ${dup.urls.join(", ")}. Each page should have a unique, descriptive title.`,
          url,
          metric: "duplicateCount",
          value: String(dup.urls.length),
          metadata: { title: dup.title, urls: dup.urls },
        });
      }
      issuesByType["DUPLICATE_TITLE"] =
        (issuesByType["DUPLICATE_TITLE"] ?? 0) + dup.urls.length;
    }
  }

  // Check for broken links
  for (const broken of crawlResult.brokenLinks) {
    addFinding(findings, siteId, {
      type: "BROKEN_INTERNAL_LINK",
      severity: "HIGH",
      title: "Broken internal link",
      description: `Link from ${broken.from} to ${broken.to} returns HTTP ${broken.status}. Fix or remove this link.`,
      url: broken.to,
      metric: "httpStatus",
      value: String(broken.status),
      metadata: { from: broken.from, to: broken.to },
    });
    issuesByType["BROKEN_INTERNAL_LINK"] =
      (issuesByType["BROKEN_INTERNAL_LINK"] ?? 0) + 1;
  }

  return {
    data: {
      pagesAnalyzed: pages.length,
      issuesByType,
    },
    findings,
    itemsProcessed: pages.length,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const ISSUE_TYPE_MAP: Record<string, { findingType: string; severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; title: string }> = {
  broken_link: { findingType: "BROKEN_LINK", severity: "HIGH", title: "Broken internal link detected" },
  redirect_chain: { findingType: "REDIRECT_CHAIN", severity: "MEDIUM", title: "Redirect chain detected" },
  duplicate_title: { findingType: "DUPLICATE_TITLE", severity: "MEDIUM", title: "Duplicate page title" },
  missing_canonical: { findingType: "MISSING_CANONICAL", severity: "MEDIUM", title: "Missing canonical tag" },
  thin_content: { findingType: "THIN_CONTENT", severity: "LOW", title: "Thin content page" },
  slow_page: { findingType: "SLOW_PAGE", severity: "MEDIUM", title: "Slow page response time" },
  deep_click_depth: { findingType: "DEEP_CLICK_DEPTH", severity: "LOW", title: "Page too deep in site structure" },
  orphan_page: { findingType: "ORPHAN_PAGE", severity: "MEDIUM", title: "Orphan page (no internal links)" },
  // Additional issue types from crawler issue reporting
  MISSING_TITLE: { findingType: "MISSING_TITLE", severity: "HIGH", title: "Missing page title" },
  MISSING_META_DESCRIPTION: { findingType: "MISSING_META_DESCRIPTION", severity: "MEDIUM", title: "Missing meta description" },
  MISSING_H1: { findingType: "MISSING_H1", severity: "MEDIUM", title: "Missing H1 heading" },
  SLOW_TTFB: { findingType: "SLOW_TTFB", severity: "LOW", title: "Slow time to first byte" },
  NOINDEX_PAGE: { findingType: "NOINDEX_PAGE", severity: "HIGH", title: "Page set to noindex" },
  CANONICAL_MISMATCH: { findingType: "CANONICAL_MISMATCH", severity: "MEDIUM", title: "Canonical URL mismatch" },
};

interface AddFindingParams {
  type: string;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  description: string;
  url: string;
  metric: string;
  value: string;
  metadata?: Record<string, unknown>;
}

function addFinding(
  findings: AgentFinding[],
  siteId: string,
  params: AddFindingParams,
): void {
  findings.push({
    type: params.type,
    severity: params.severity,
    title: params.title,
    description: params.description,
    evidence: [
      {
        sourceType: "CRAWL",
        sourceId: params.url,
        metric: params.metric,
        value: params.value,
        metadata: params.metadata,
        observedAt: new Date().toISOString(),
      },
    ],
    confidence: 1.0,
    affectedResource: { type: "PAGE", id: params.url },
    fingerprint: createFindingFingerprint({
      siteId,
      type: params.type,
      resourceType: "PAGE",
      resourceId: params.url,
    }),
  });
}
