import { logger } from "@/lib/logger";
import { isSafeUrl } from "@/lib/security/safe-url";

export interface SitemapPage {
  url: string;
  /** ISO date string from <lastmod>, or null if absent */
  lastmod: string | null;
}

export interface VelocitySnapshot {
  competitorId: string;
  domain: string;
  /** Total pages found in sitemap */
  totalPages: number;
  /** URLs discovered in this snapshot (for diffing) */
  pageUrls: string[];
  snapshotAt: string;
}

export interface VelocityDiff {
  competitorId: string;
  domain: string;
  /** Pages added since last snapshot */
  newPages: string[];
  /** Pages removed since last snapshot */
  removedPages: string[];
  /** Posts/pages per week (rolling rate from last 4 snapshots) */
  publishRate: number;
  /** Most recent sitemap size */
  totalPages: number;
  /** Topic clusters: derived from URL path segments */
  topTopics: string[];
  diffedAt: string;
}

/**
 * Fetches a competitor's sitemap.xml and returns structured page list.
 * Handles sitemap indexes by following the first child sitemap.
 * SSRF-guarded — all URLs validated before fetch.
 */
export async function fetchCompetitorSitemap(
  domain: string,
): Promise<SitemapPage[]> {
  const sitemapUrl = `https://${domain}/sitemap.xml`;
  const guard = isSafeUrl(sitemapUrl);
  if (!guard.ok || !guard.url) {
    logger.warn("[Velocity] Blocked unsafe sitemap URL", { domain });
    return [];
  }

  let xml = "";
  try {
    const res = await fetch(guard.url.href, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OptiAISEO-Bot/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    xml = await res.text();
  } catch (err) {
    logger.warn("[Velocity] Sitemap fetch failed", {
      domain,
      error: (err as Error)?.message,
    });
    return [];
  }

  // Handle sitemap index — follow first child sitemap
  if (xml.includes("<sitemapindex")) {
    const childMatch = xml.match(/<loc>\s*([^<]+)\s*<\/loc>/i);
    if (childMatch) {
      const childGuard = isSafeUrl(childMatch[1].trim());
      if (childGuard.ok && childGuard.url) {
        try {
          const childRes = await fetch(childGuard.url.href, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; OptiAISEO-Bot/1.0)" },
            signal: AbortSignal.timeout(12000),
          });
          if (childRes.ok) xml = await childRes.text();
        } catch {
          // Fall through with empty result
        }
      }
    }
  }

  return parseSitemapPages(xml, domain);
}

function parseSitemapPages(xml: string, domain: string): SitemapPage[] {
  const pages: SitemapPage[] = [];
  const urlRegex = /<url>([\s\S]*?)<\/url>/gi;
  const locRegex = /<loc>\s*([^<]+)\s*<\/loc>/i;
  const lastmodRegex = /<lastmod>\s*([^<]+)\s*<\/lastmod>/i;

  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(xml)) !== null) {
    const block = match[1];
    const locMatch = locRegex.exec(block);
    if (!locMatch) continue;

    const url = locMatch[1].trim();
    // Exclude non-content URLs
    if (!/\.(xml|pdf|jpg|jpeg|png|gif|svg|webp|ico|css|js)$/i.test(url) &&
        url.includes(domain)) {
      const lastmodMatch = lastmodRegex.exec(block);
      pages.push({
        url,
        lastmod: lastmodMatch ? lastmodMatch[1].trim() : null,
      });
    }
  }

  return pages.slice(0, 2000); // cap for safety
}

/**
 * Extracts top topic clusters from URL path segments.
 * e.g. ["/blog/seo/...", "/blog/aeo/..."] → ["blog", "seo", "aeo"]
 */
export function extractTopTopics(urls: string[], topN = 5): string[] {
  const segmentCount = new Map<string, number>();

  for (const url of urls) {
    try {
      const pathname = new URL(url).pathname;
      const segments = pathname.split("/").filter(s => s.length > 2 && !/^\d+$/.test(s));
      for (const seg of segments.slice(0, 3)) {
        segmentCount.set(seg, (segmentCount.get(seg) ?? 0) + 1);
      }
    } catch {
      // Skip malformed URLs
    }
  }

  return [...segmentCount.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, topN)
    .map(([seg]) => seg);
}

/**
 * Computes the publish rate (pages/week) from historical snapshot sizes.
 * Expects snapshots ordered oldest-first.
 */
export function computePublishRate(
  historicalCounts: Array<{ totalPages: number; snapshotAt: string }>,
): number {
  if (historicalCounts.length < 2) return 0;

  const oldest = historicalCounts[0];
  const newest = historicalCounts[historicalCounts.length - 1];

  const pageDiff = newest.totalPages - oldest.totalPages;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksDiff =
    (new Date(newest.snapshotAt).getTime() - new Date(oldest.snapshotAt).getTime()) / msPerWeek;

  if (weeksDiff <= 0) return 0;
  return Math.max(0, Math.round((pageDiff / weeksDiff) * 10) / 10);
}
