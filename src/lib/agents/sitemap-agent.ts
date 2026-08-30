
import { createFindingFingerprint } from "./fingerprint";
import type { AgentExecution, AgentFinding } from "./types";
import type { CrawlSnapshot } from "./snapshots";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SitemapAnalysisData {
  coverageScore: number; // 0–100
  totalSitemapUrls: number;
  totalCrawledUrls: number;
  inBoth: number;
  inSitemapOnly: number;
  inCrawlOnly: number;
  invalidEntries: string[];
}

// ── Public API ──────────────────────────────────────────────────────────────

export function analyzeSitemap(
  siteId: string,
  snapshot: CrawlSnapshot,
): AgentExecution<SitemapAnalysisData> {
  const findings: AgentFinding[] = [];
  const { crawlResult, discoveryData } = snapshot;

  const sitemapSet = new Set(
    discoveryData.sitemapUrls.map((u) => normalizeUrl(u)),
  );
  const crawledSet = new Set(
    crawlResult.linkGraph.map((n) => normalizeUrl(n.url)),
  );

  // Compute coverage
  const inBoth = [...crawledSet].filter((u) => sitemapSet.has(u)).length;
  const inCrawlOnly = [...crawledSet].filter((u) => !sitemapSet.has(u));
  const inSitemapOnly = [...sitemapSet].filter((u) => !crawledSet.has(u));

  const totalCrawled = crawledSet.size;
  const coverageScore =
    totalCrawled > 0 ? Math.round((inBoth / totalCrawled) * 100) : 0;

  // Find invalid sitemap entries (URLs that are in sitemap but appear as
  // broken links or redirects in the crawl)
  const brokenUrls = new Set(
    crawlResult.brokenLinks.map((b) => normalizeUrl(b.to)),
  );
  const redirectedUrls = new Set(
    crawlResult.redirectChains.map((r) => normalizeUrl(r.url)),
  );
  const invalidEntries = [...sitemapSet].filter(
    (u) => brokenUrls.has(u) || redirectedUrls.has(u),
  );

  // Low sitemap coverage
  if (totalCrawled > 5 && coverageScore < 50) {
    findings.push({
      type: "LOW_SITEMAP_COVERAGE",
      severity: "HIGH",
      title: `Low sitemap coverage: ${coverageScore}%`,
      description: `Only ${inBoth} of ${totalCrawled} crawled pages appear in the XML sitemap (${coverageScore}% coverage). Important pages may not be discovered by search engines.`,
      evidence: [
        {
          sourceType: "SITEMAP",
          metric: "coverageScore",
          value: String(coverageScore),
          metadata: { inBoth, totalCrawled, totalSitemap: sitemapSet.size },
          observedAt: new Date().toISOString(),
        },
      ],
      confidence: 1.0,
      affectedResource: { type: "SITE", id: snapshot.domain },
      fingerprint: createFindingFingerprint({
        siteId,
        type: "LOW_SITEMAP_COVERAGE",
        resourceType: "SITE",
        resourceId: snapshot.domain,
      }),
    });
  }

  // Invalid sitemap entries
  for (const invalidUrl of invalidEntries.slice(0, 20)) {
    // Cap at 20 findings
    findings.push({
      type: "INVALID_SITEMAP_ENTRY",
      severity: "MEDIUM",
      title: "Invalid URL in sitemap",
      description: `${invalidUrl} is listed in the XML sitemap but returns a 404 or redirects. Remove or fix this entry.`,
      evidence: [
        {
          sourceType: "SITEMAP",
          metric: "urlStatus",
          value: brokenUrls.has(invalidUrl) ? "404" : "redirect",
          observedAt: new Date().toISOString(),
        },
      ],
      confidence: 1.0,
      affectedResource: { type: "PAGE", id: invalidUrl },
      fingerprint: createFindingFingerprint({
        siteId,
        type: "INVALID_SITEMAP_ENTRY",
        resourceType: "PAGE",
        resourceId: invalidUrl,
      }),
    });
  }

  // Important crawled pages not in sitemap
  // "Important" = pages with high inbound link count from the crawl
  const importantMissing = inCrawlOnly
    .filter((url) => {
      const node = crawlResult.linkGraph.find(
        (n) => normalizeUrl(n.url) === url,
      );
      return node && node.inboundCount >= 3;
    })
    .slice(0, 10);

  for (const url of importantMissing) {
    findings.push({
      type: "IMPORTANT_PAGE_NOT_IN_SITEMAP",
      severity: "MEDIUM",
      title: "Well-linked page missing from sitemap",
      description: `${url} has 3+ internal links pointing to it but is not in the XML sitemap. Adding it may improve indexation.`,
      evidence: [
        {
          sourceType: "SITEMAP",
          metric: "inSitemap",
          value: "false",
          observedAt: new Date().toISOString(),
        },
      ],
      confidence: 0.8,
      affectedResource: { type: "PAGE", id: url },
      fingerprint: createFindingFingerprint({
        siteId,
        type: "IMPORTANT_PAGE_NOT_IN_SITEMAP",
        resourceType: "PAGE",
        resourceId: url,
      }),
    });
  }

  return {
    data: {
      coverageScore,
      totalSitemapUrls: sitemapSet.size,
      totalCrawledUrls: totalCrawled,
      inBoth,
      inSitemapOnly: inSitemapOnly.length,
      inCrawlOnly: inCrawlOnly.length,
      invalidEntries,
    },
    findings,
    itemsProcessed: sitemapSet.size + totalCrawled,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/$/, "");
  }
}
