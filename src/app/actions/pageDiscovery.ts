// src/app/actions/pageDiscovery.ts
"use server";

import { after } from "next/server"; // Next.js 15+ — fire-and-forget background work
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserGscToken } from "@/lib/gsc/token";
import { normaliseSiteUrl } from "@/lib/gsc";
import { logger } from "@/lib/logger";

// Types

export interface DiscoveredPage {
    url: string;
    source: "gsc" | "sitemap" | "both";
    clicks?: number;
    impressions?: number;
    position?: number;
}

export interface PageDiscoveryResult {
    gscConnected: boolean;
    gscPageCount: number;
    sitemapPageCount: number;
    totalUniquePages: number;
    notInGsc: number;
    notInSitemap: number;
    gscCapped: boolean;
    sitemapFound: boolean;
    sitemapUrl: string | null;
    pages: DiscoveredPage[];
    lastScanned: string | null;
    fromCache?: boolean;
    error?: string;
}

const EMPTY_RESULT = (extra: Partial<PageDiscoveryResult> = {}): PageDiscoveryResult => ({
    gscConnected: false,
    gscPageCount: 0,
    sitemapPageCount: 0,
    totalUniquePages: 0,
    notInGsc: 0,
    notInSitemap: 0,
    gscCapped: false,
    sitemapFound: false,
    sitemapUrl: null,
    pages: [],
    lastScanned: null,
    ...extra,
});

// FIX 1: In-process cache (swap `discoveryCache` calls for Redis in production)
//
//   await redis.set(key, JSON.stringify(result), "EX", CACHE_TTL_SECS);
//   const hit = await redis.get(key);
//   if (hit) return JSON.parse(hit);

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const discoveryCache = new Map<string, { data: PageDiscoveryResult; expiresAt: number }>();

function getCached(siteId: string): PageDiscoveryResult | null {
    const entry = discoveryCache.get(siteId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        discoveryCache.delete(siteId);
        return null;
    }
    return entry.data;
}

function setCache(siteId: string, data: PageDiscoveryResult): void {
    discoveryCache.set(siteId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// FIX 3: SSRF protection — validate every URL before fetching

function isSafeUrl(url: string): boolean {
    try {
        const u = new URL(url);
        if (!["http:", "https:"].includes(u.protocol)) return false;

        const host = u.hostname.toLowerCase();

        // Block loopback, private ranges, and cloud metadata endpoints
        if (
            host === "localhost" ||
            host === "169.254.169.254" ||     // AWS/GCP instance metadata
            host === "metadata.google.internal" ||
            host.endsWith(".internal") ||
            host.endsWith(".local") ||
            /^127\./.test(host) ||
            /^10\./.test(host) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
            /^192\.168\./.test(host)
        ) return false;

        return true;
    } catch {
        return false;
    }
}

// FIX 4: Concurrency limiter — avoids slamming external servers
//         (drop-in replacement for p-limit, no new dependency)

function createLimiter(concurrency: number) {
    let active = 0;
    const queue: (() => void)[] = [];

    return function limit<T>(fn: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            const run = async () => {
                active++;
                try {
                    resolve(await fn());
                } catch (err) {
                    reject(err);
                } finally {
                    active--;
                    if (queue.length > 0) queue.shift()!();
                }
            };
            if (active < concurrency) run();
            else queue.push(run);
        });
    };
}

// Sitemap fetcher (Fix 3 + Fix 4 applied)

async function fetchPagesFromSitemap(
    domain: string
): Promise<{ urls: string[]; sitemapUrl: string | null }> {
    const base = domain.startsWith("http") ? domain.replace(/\/+$/, "") : `https://${domain}`;
    const urls: string[] = [];
    let foundSitemapUrl: string | null = null;

    const tryFetch = async (url: string): Promise<string> => {
        // FIX 3: Reject unsafe URLs before any network call
        if (!isSafeUrl(url)) throw new Error(`Blocked unsafe URL: ${url}`);

        const res = await fetch(url, {
            headers: { "User-Agent": "SEOTool-Bot/1.0 (read-only page discovery)" },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
    };

    // FIX 4: 5 concurrent child-sitemap fetches max
    const limit = createLimiter(5);

    const parseSitemap = async (xml: string, depth = 0): Promise<void> => {
        if (depth > 3) return;

        // FIX 3: Hard cap to prevent memory blowup
        if (urls.length >= 10_000) return;

        const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());

        if (xml.includes("<sitemapindex")) {
            // FIX 4: Fetch child sitemaps concurrently, capped at 20
            await Promise.all(
                matches.slice(0, 20).map(childUrl =>
                    limit(async () => {
                        try {
                            const child = await tryFetch(childUrl);
                            await parseSitemap(child, depth + 1);
                        } catch (err) {
                            // FIX (error handling): log failures instead of silently swallowing
                            logger.warn("[Sitemap] child fetch failed", {
                                url: childUrl,
                                error: (err as Error)?.message,
                            });
                        }
                    })
                )
            );
        } else {
            // FIX 3: Only push URLs that pass the SSRF check
            urls.push(...matches.filter(u => isSafeUrl(u)));
        }
    };

    const candidates: string[] = [];
    try {
        const robots = await tryFetch(`${base}/robots.txt`);
        const fromRobots = [...robots.matchAll(/^Sitemap:\s*(.+)$/gim)].map(m => m[1].trim());
        candidates.push(...fromRobots);
    } catch { /* robots.txt is optional */ }

    candidates.push(
        `${base}/sitemap.xml`,
        `${base}/sitemap_index.xml`,
        `${base}/sitemap-index.xml`
    );

    for (const candidate of candidates) {
        // FIX 3: Validate candidate URLs too
        if (!isSafeUrl(candidate)) continue;
        try {
            const xml = await tryFetch(candidate);
            await parseSitemap(xml);
            if (urls.length > 0) {
                foundSitemapUrl = candidate;
                break;
            }
        } catch { /* try next candidate */ }
    }

    return { urls: [...new Set(urls)], sitemapUrl: foundSitemapUrl };
}

// GSC page fetcher — FIX 2: dynamic row limit instead of hardcoded 5000

async function fetchGSCPages(
    accessToken: string,
    siteUrl: string,
    maxRows = 1000 // FIX 2: default 1000; pass a higher value only for full exports
): Promise<{ pages: { url: string; clicks: number; impressions: number; position: number }[]; capped: boolean }> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 90);
    const fmt = (d: Date) => d.toISOString().split("T")[0];

    const PAGE_SIZE = 25_000;
    const allRows: { url: string; clicks: number; impressions: number; position: number }[] = [];
    let startRow = 0;
    let capped = false;

    while (allRows.length < maxRows) {
        const res = await fetch(
            `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    startDate: fmt(startDate),
                    endDate: fmt(endDate),
                    dimensions: ["page"],
                    rowLimit: Math.min(PAGE_SIZE, maxRows - allRows.length),
                    startRow,
                    dataState: "final",
                }),
            }
        );

        if (!res.ok) {
            const err = await res.text();
            logger.error("[PageDiscovery] GSC fetch failed", { status: res.status, err });
            break;
        }

        const data = await res.json();
        const rows: unknown[] = data.rows ?? [];
        if (rows.length === 0) break;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        allRows.push(...rows.map((r: any) => ({
            url: r.keys[0],
            clicks: r.clicks,
            impressions: r.impressions,
            position: parseFloat(r.position.toFixed(1)),
        })));

        startRow += rows.length;
        if (rows.length < PAGE_SIZE) break;
    }

    if (allRows.length >= maxRows) capped = true;

    return { pages: allRows, capped };
}

// FIX 5: Core discovery logic extracted into its own function so it can be
//         called from a background job (BullMQ, Inngest, cron, etc.) without
//         coupling to the HTTP request lifecycle.
//
//   Usage from a queue worker:
//     import { runDiscovery } from "@/app/actions/pageDiscovery";
//     await runDiscovery(siteId, userId, { fullExport: true });

export async function runDiscovery(
    siteId: string,
    userId: string,
    opts: { fullExport?: boolean } = {}
): Promise<PageDiscoveryResult> {
    const site = await prisma.site.findFirst({ where: { id: siteId, userId } });
    if (!site) return EMPTY_RESULT({ error: "Site not found" });

    let gscPages: { url: string; clicks: number; impressions: number; position: number }[] = [];
    let gscCapped = false;
    let gscConnected = false;

    // FIX 2: Only fetch full dataset when explicitly requested
    const gscMaxRows = opts.fullExport ? 5_000 : 1_000;

    const [gscResult, sitemapResult] = await Promise.allSettled([
        (async () => {
            const token = await getUserGscToken(userId);
            if (!token) return null;
            gscConnected = true;
            return fetchGSCPages(token, normaliseSiteUrl(site.domain), gscMaxRows);
        })(),
        fetchPagesFromSitemap(site.domain),
    ]);

    if (gscResult.status === "fulfilled" && gscResult.value) {
        gscPages = gscResult.value.pages;
        gscCapped = gscResult.value.capped;
        gscConnected = true;
    } else if (gscResult.status === "rejected") {
        logger.error("[PageDiscovery] GSC fetch rejected", { error: gscResult.reason });
    }

    const sitemapUrls: string[] =
        sitemapResult.status === "fulfilled" ? sitemapResult.value.urls : [];
    const sitemapUrl: string | null =
        sitemapResult.status === "fulfilled" ? sitemapResult.value.sitemapUrl : null;

    if (sitemapResult.status === "rejected") {
        logger.warn("[PageDiscovery] Sitemap fetch rejected", { error: sitemapResult.reason });
    }

    const sitemapSet = new Set(sitemapUrls);
    const pageMap = new Map<string, DiscoveredPage>();

    for (const p of gscPages) {
        pageMap.set(p.url, {
            url: p.url,
            source: sitemapSet.has(p.url) ? "both" : "gsc",
            clicks: p.clicks,
            impressions: p.impressions,
            position: p.position,
        });
    }

    for (const url of sitemapUrls) {
        if (!pageMap.has(url)) {
            pageMap.set(url, { url, source: "sitemap" });
        }
    }

    const pages = [...pageMap.values()];

    const result: PageDiscoveryResult = {
        gscConnected,
        gscPageCount: gscPages.length,
        sitemapPageCount: sitemapUrls.length,
        totalUniquePages: pages.length,
        notInGsc: pages.filter(p => p.source === "sitemap").length,
        notInSitemap: pages.filter(p => p.source === "gsc").length,
        gscCapped,
        sitemapFound: sitemapUrls.length > 0,
        sitemapUrl,
        // Sort once here, before caching — not on every read
        pages: pages.sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0)),
        lastScanned: new Date().toISOString(),
    };

    // FIX 1: Store in cache after a successful run
    setCache(siteId, result);

    return result;
}


export async function getPageDiscovery(
    siteId: string,
    opts: { fullExport?: boolean } = {}
): Promise<PageDiscoveryResult> {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) return EMPTY_RESULT({ error: "Not authenticated" });

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return EMPTY_RESULT({ error: "User not found" });

        const site = await prisma.site.findFirst({ where: { id: siteId, userId: user.id } });
        if (!site) return EMPTY_RESULT({ error: "Site not found" });

        
        const cached = getCached(siteId);
        if (cached) {
            return { ...cached, fromCache: true };
        }
        return await runDiscovery(siteId, user.id, opts);

    } catch (error: unknown) {
        logger.error("[PageDiscovery] getPageDiscovery failed", {
            error: (error as Error)?.message,
        });
        return EMPTY_RESULT({ error: "Failed to fetch page data" });
    }
}