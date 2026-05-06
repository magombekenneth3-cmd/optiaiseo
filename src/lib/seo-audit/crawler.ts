/**
 * src/lib/seo-audit/crawler.ts
 *
 * Discovers auditable pages for a domain, preferring data already stored in the
 * database over external HTTP requests.
 *
 * Discovery strategy (priority order):
 *
 *  1. DB  — IndexingLog.url  (every URL the site owner already submitted for indexing)
 *  2. DB  — Blog published URLs (hashnodeUrl, mediumUrl, wordPressUrl, ghostUrl)
 *           + Blog.sourceUrl  (original live page URLs from content refresh runs)
 *  3. DB  — Blog slugs composed with site domain (unpublished blogs still on the domain)
 *  4. DB  — previous PageAudit.pageUrl results (great seed for incremental runs)
 *  5. GSC — unique page URLs from Search Console searchAnalytics (real traffic, sorted
 *           by impressions desc so the highest-value pages are always audited first)
 *  6. External — sitemap.xml / sitemap_index / robots.txt Sitemap: directive
 *  7. External — homepage <a href> link crawl (last resort)
 *
 * The homepage is always included as the first entry.
 * All results are filtered to the same origin, deduped, and capped at `limit`.
 */

import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { fetchGSCKeywords, normaliseSiteUrl } from "@/lib/gsc";
import { getUserGscToken } from "@/lib/gsc/token";

const DEFAULT_LIMIT = 50;
const FETCH_TIMEOUT_MS = 10_000;

// ── DB-sourced discovery ──────────────────────────────────────────────────────

/**
 * Pull page URLs from the database for a given siteId.
 * Returns them in priority order (indexing logs first, then blogs, then past audits).
 */
async function fromDatabase(siteId: string, domain: string): Promise<string[]> {
  const origin = domain.startsWith("http") ? new URL(domain).origin : `https://${domain}`;
  const urls = new Set<string>();

  try {
    // 1. IndexingLog — URLs already intentionally submitted by the site owner
    const indexingLogs = await prisma.indexingLog.findMany({
      where: { siteId, status: { in: ["SUCCESS", "PENDING"] } },
      select: { url: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    for (const { url } of indexingLogs) {
      if (url.startsWith(origin)) urls.add(url);
    }

    // 2. Published blog URLs on any syndication platform — still the canonical content
    const blogs = await prisma.blog.findMany({
      where: { siteId, status: "PUBLISHED" },
      select: {
        slug: true,
        hashnodeUrl: true,
        mediumUrl: true,
        wordPressUrl: true,
        ghostUrl: true,
        sourceUrl: true,
      },
    });
    for (const blog of blogs) {
      // Published external URLs (may be off-domain — only include same-origin)
      for (const externalUrl of [blog.hashnodeUrl, blog.mediumUrl, blog.wordPressUrl, blog.ghostUrl]) {
        if (externalUrl && externalUrl.startsWith(origin)) urls.add(externalUrl);
      }
      // sourceUrl: original on-site page URL from content refresh (always same domain)
      if (blog.sourceUrl && blog.sourceUrl.startsWith(origin)) urls.add(blog.sourceUrl);
      // Slug-composed URL: covers blogs published to the user's own domain
      if (blog.slug) {
        const composed = `${origin}/blog/${blog.slug}`;
        urls.add(composed);
      }
    }

    // 3. Previous PageAudit records — reuse URLs audited in past runs
    const previousPages = await prisma.pageAudit.findMany({
      where: { siteId },
      select: { pageUrl: true },
      orderBy: { runTimestamp: "desc" },
      distinct: ["pageUrl"],
      take: 100,
    });
    for (const { pageUrl } of previousPages) {
      if (pageUrl.startsWith(origin)) urls.add(pageUrl);
    }
  } catch (err) {
    logger.warn("[crawler] DB discovery failed (non-fatal):", {
      error: (err as Error)?.message,
    });
  }

  return Array.from(urls);
}

// ── GSC-sourced discovery ─────────────────────────────────────────────────────

/**
 * Pull page URLs from Google Search Console for a given user + domain.
 *
 * Pages are sorted by impressions descending so the highest-traffic URLs are
 * always audited first when the budget is tight.  The function is best-effort:
 * any error (token missing, 403, network) returns an empty array so the caller
 * can fall through to sitemap / homepage crawl.
 *
 * @param userId  Prisma User.id — used to resolve the GSC OAuth token.
 * @param domain  Site domain (plain or with scheme).
 * @param origin  Pre-computed origin (https://example.com) for same-origin filtering.
 */
// ── GSC property auto-detection ───────────────────────────────────────────────

/**
 * Build candidate GSC property URLs for a domain, in priority order.
 * Mirrors the same logic used in keywords.ts so behaviour is consistent
 * across every GSC call in the platform.
 */
function gscUrlCandidates(domain: string): string[] {
  const clean = domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
  return [
    `https://www.${clean}/`,
    `https://${clean}/`,
    `sc-domain:${clean}`,
  ];
}

/**
 * Ask GSC which property URL the user has actually verified that matches
 * `domain`.  Returns the matching property URL, or null if none found.
 *
 * This is required because normaliseSiteUrl() produces `https://domain/`
 * but many users register a Domain property (`sc-domain:domain`) or
 * a www-prefixed URL property — both return 403 for the wrong format.
 */
async function resolveGscProperty(
  token: string,
  domain: string,
): Promise<string | null> {
  try {
    const { fetchGSCSites } = await import("@/lib/gsc");
    const sites = await fetchGSCSites(token);
    const candidates = gscUrlCandidates(domain);

    // Exact-match first (case-insensitive)
    for (const candidate of candidates) {
      if (sites.some((s) => s.toLowerCase() === candidate.toLowerCase())) {
        return candidate;
      }
    }

    // Partial-match fallback — domain string appears anywhere in a verified property
    const bare = domain
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/$/, "");
    return sites.find((s) => s.includes(bare)) ?? null;
  } catch {
    return null;
  }
}

// ── GSC-sourced discovery ─────────────────────────────────────────────────────

/**
 * Pull page URLs from Google Search Console for a given user + domain.
 *
 * Pages are sorted by impressions descending so the highest-traffic URLs are
 * always audited first when the budget is tight.  The function is best-effort:
 * any error (token missing, network) returns an empty array so the caller
 * can fall through to sitemap / homepage crawl.
 *
 * GSC property auto-detection:
 *   normaliseSiteUrl() is tried first.  If GSC returns 403 (property URL format
 *   mismatch — e.g. sc-domain: vs https://), resolveGscProperty() lists the
 *   user's verified properties and selects the correct one, then retries.
 *
 * @param userId  Prisma User.id — used to resolve the GSC OAuth token.
 * @param domain  Site domain (plain or with scheme).
 * @param origin  Pre-computed origin (https://example.com) for same-origin filtering.
 */
async function fromGsc(
  userId: string,
  domain: string,
  origin: string,
): Promise<string[]> {
  try {
    const token = await getUserGscToken(userId);

    /** Fetch and aggregate impression-sorted page URLs for a given property URL. */
    async function fetchPages(siteUrl: string): Promise<string[]> {
      // fetchGSCKeywords is the single canonical GSC client — reuse it rather
      // than opening a second raw queryGSC call.
      const rows = await fetchGSCKeywords(token, siteUrl, 90);

      // Aggregate impressions per page URL so we can sort by traffic value.
      const impressionsByUrl = new Map<string, number>();
      for (const row of rows) {
        if (!row.url) continue;
        impressionsByUrl.set(row.url, (impressionsByUrl.get(row.url) ?? 0) + row.impressions);
      }

      // Sort highest-impression pages first, filter to same origin.
      return Array.from(impressionsByUrl.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([url]) => url)
        .filter((url) => url.startsWith(origin));
    }

    const primaryUrl = normaliseSiteUrl(domain);

    try {
      const sorted = await fetchPages(primaryUrl);
      logger.info(`[crawler:gsc] ${sorted.length} pages from GSC for ${domain} (property: ${primaryUrl})`);
      return sorted;
    } catch (firstErr: unknown) {
      const msg = (firstErr as Error)?.message ?? "";

      // 403 almost always means the property URL format doesn't match what the
      // user registered in GSC.  Auto-detect the correct property and retry once.
      if (!msg.includes("403")) throw firstErr;

      logger.warn(
        `[crawler:gsc] 403 for ${primaryUrl} — auto-detecting GSC property`,
        { domain }
      );

      const resolved = await resolveGscProperty(token, domain);

      if (!resolved || resolved === primaryUrl) {
        // Property not found in this user's GSC account — surface a clear warning.
        logger.warn(
          "[crawler:gsc] GSC property not found for domain — skipping GSC discovery",
          { domain, tried: primaryUrl }
        );
        return [];
      }

      logger.info(`[crawler:gsc] Resolved GSC property: ${resolved} — retrying`, { domain });
      const sorted = await fetchPages(resolved);
      logger.info(`[crawler:gsc] ${sorted.length} pages from GSC for ${domain} (property: ${resolved})`);
      return sorted;
    }
  } catch (err) {
    // Non-fatal — token may not be connected, or GSC may be unavailable.
    logger.warn("[crawler:gsc] GSC page discovery failed (non-fatal):", {
      error: (err as Error)?.message,
      domain,
    });
    return [];
  }
}

// ── External discovery helpers ────────────────────────────────────────────────

async function safeGet(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "AiSEO-Audit-Bot/1.0" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Normalise a URL — ensure absolute, strip fragments/trailing slashes. */
function normalise(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return null;
  }
}

/** Parse <urlset> or <sitemapindex> XML string and return hrefs. */
function parseSitemapXml(xml: string): string[] {
  const urls: string[] = [];
  const locRe = /<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = locRe.exec(xml)) !== null) urls.push(m[1].trim());
  return urls;
}

async function fromSitemap(origin: string): Promise<string[]> {
  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap/`,
  ];
  for (const sitemapUrl of candidates) {
    const xml = await safeGet(sitemapUrl);
    if (!xml) continue;
    const entries = parseSitemapXml(xml);
    if (entries.length === 0) continue;
    const isSitemapIndex = xml.includes("<sitemapindex") || xml.includes("<sitemap>");
    if (isSitemapIndex) {
      const childUrls: string[] = [];
      const childSitemaps = entries.filter((u) => u.endsWith(".xml")).slice(0, 5);
      await Promise.all(
        childSitemaps.map(async (childUrl) => {
          const childXml = await safeGet(childUrl);
          if (childXml) childUrls.push(...parseSitemapXml(childXml));
        })
      );
      if (childUrls.length > 0) return childUrls;
    }
    return entries;
  }
  return [];
}

async function sitemapFromRobots(origin: string): Promise<string | null> {
  const txt = await safeGet(`${origin}/robots.txt`);
  if (!txt) return null;
  const match = txt.match(/^Sitemap:\s*(https?:\/\/.+)$/im);
  return match ? match[1].trim() : null;
}

async function fromHomepageCrawl(origin: string): Promise<string[]> {
  const html = await safeGet(origin);
  if (!html) return [];
  const urls = new Set<string>();
  const hrefRe = /href=["']([^"'#?]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const abs = normalise(m[1], origin);
    if (abs && abs.startsWith(origin)) urls.add(abs);
  }
  return Array.from(urls);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Discover all auditable pages for a domain.
 *
 * DB data (IndexingLog + Blog URLs + past PageAudit records) is consulted first
 * because it is already verified and same-site.  GSC data is consulted next when
 * a userId is supplied — it surfaces real traffic pages that may not be in the DB
 * yet, sorted by impressions so the highest-value pages are always within budget.
 * External HTTP discovery only runs when DB + GSC yield fewer than `limit` pages.
 *
 * @param domain   Plain domain or full URL (e.g. "example.com" or "https://example.com")
 * @param limit    Max pages to return (default 50)
 * @param siteId   Prisma Site.id — used for DB-first discovery
 * @param userId   Prisma User.id — used for GSC token resolution (optional but recommended)
 * @returns        Deduplicated, absolute page URLs with homepage first
 */
export async function discoverPages(
  domain: string,
  limit: number = DEFAULT_LIMIT,
  siteId?: string,
  userId?: string,
): Promise<string[]> {
  const origin = domain.startsWith("http") ? new URL(domain).origin : `https://${domain}`;
  const homepage = origin + "/";

  const allUrls = new Set<string>();
  allUrls.add(homepage);

  // ── Step 1: DB-first (fast, no external HTTP) ─────────────────────────────
  if (siteId) {
    const dbUrls = await fromDatabase(siteId, origin);
    for (const u of dbUrls) allUrls.add(u);
    logger.info(`[crawler:db] ${dbUrls.length} URLs from DB for site ${siteId}`);
  }

  // ── Step 2: GSC (real traffic pages, sorted by impressions) ───────────────
  // Runs even when DB already has some pages — GSC may know about pages that
  // haven't been manually indexed or previously audited.
  if (userId) {
    const gscUrls = await fromGsc(userId, domain, origin);
    for (const u of gscUrls) allUrls.add(u);
  }

  // ── Step 3: External discovery (only if DB+GSC didn't fill the budget) ────
  if (allUrls.size < limit) {
    let external: string[] = [];

    // Try sitemap.xml first
    external = await fromSitemap(origin);

    // robots.txt → Sitemap directive fallback
    if (external.length === 0) {
      const robotsSitemapUrl = await sitemapFromRobots(origin);
      if (robotsSitemapUrl) {
        const xml = await safeGet(robotsSitemapUrl);
        if (xml) external = parseSitemapXml(xml);
      }
    }

    // Last resort: homepage crawl
    if (external.length === 0) {
      logger.warn(`[crawler] No sitemap for ${origin} — falling back to homepage crawl`);
      external = await fromHomepageCrawl(origin);
    }

    // Add external results that are same-origin
    for (const raw of external) {
      const normalised = normalise(raw, origin);
      if (normalised && normalised.startsWith(origin)) allUrls.add(normalised);
    }

    logger.info(`[crawler:external] ${external.length} URLs from external sources for ${origin}`);
  }

  // ── Finalise: homepage first, capped at limit ─────────────────────────────
  const withoutHomepage = Array.from(allUrls).filter((u) => u !== homepage);
  const result = [homepage, ...withoutHomepage].slice(0, limit);

  logger.info(
    `[crawler] Total ${result.length} pages discovered for ${origin} ` +
    `(DB+GSC+external, limit=${limit})`
  );
  return result;
}
