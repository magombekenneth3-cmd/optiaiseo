import type { MetadataRoute } from "next";
import { statSync } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { NICHES, getNicheLeaderboardResult } from "@/lib/leaderboard";
import { GUIDES } from "@/data/guides";
import KEYWORDS from "@/data/keywords.json";
import AEO_PAGES from "@/data/aeo-pages.json";
import { logger, formatError } from "@/lib/logger";

// Blog posts are added within 1 hour of publish, which is fast enough for indexing.
export const revalidate = 3600;

// ── Real lastmod dates ──────────────────────────────────────────────────────
// Use actual file modification times so Google trusts our lastmod signals.
// new Date() was changing every ISR revalidation (hourly), teaching Google
// to ignore lastmod for our entire sitemap.
const safeMtime = (relativePath: string): Date => {
    try {
        return statSync(path.resolve(process.cwd(), relativePath)).mtime;
    } catch {
        return new Date("2026-09-01"); // safe fallback
    }
};

const KEYWORDS_MTIME = safeMtime("src/data/keywords.json");
const AEO_PAGES_MTIME = safeMtime("src/data/aeo-pages.json");
// Static marketing pages — update these dates when the page content actually changes.
const STATIC_PAGES_DATE = new Date("2026-09-01");
const MARKETING_PAGES_DATE = new Date("2026-09-15");

const CANONICAL_SITE_URL = "https://optiaiseo.online";
const rawSiteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL?.startsWith("http") && !process.env.NEXT_PUBLIC_SITE_URL.includes("localhost")
        ? process.env.NEXT_PUBLIC_SITE_URL
        : process.env.NEXT_PUBLIC_APP_URL?.startsWith("http") && !process.env.NEXT_PUBLIC_APP_URL.includes("localhost")
        ? process.env.NEXT_PUBLIC_APP_URL
        : CANONICAL_SITE_URL
).replace(/\/$/, "");
const SITE_URL = rawSiteUrl.includes("www.optiaiseo.online") ? CANONICAL_SITE_URL : rawSiteUrl;

if (!SITE_URL) {
    logger.warn("[sitemap] WARNING: Canonical site URL could not be determined. Falling back to production domain.");
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const blogs = await prisma.blog
        .findMany({
            where: {
                status: "PUBLISHED",
                OR: [
                    { isEditorial: true },
                    { site: { domain: "optiaiseo.online" } },
                ],
            },
            select: { slug: true, updatedAt: true },
            orderBy: { updatedAt: "desc" },
            take: 1000,
        })
        .catch((err) => {
            logger.error("[sitemap] Failed to query published blogs from database", { error: formatError(err) });
            return [] as { slug: string; updatedAt: Date }[];
        });

    // Handle leaderboard niches with deliberate inclusion policy:
    // 1. Confirmed populated: include with real lastUpdated timestamp.
    // 2. Confirmed empty: exclude from sitemap to prevent indexing soft-404s.
    // 3. Operational error: fail-safe include so temporary DB issues don't drop URLs.
    const leaderboardEntries: MetadataRoute.Sitemap = [];
    for (const niche of NICHES) {
        try {
            const result = await getNicheLeaderboardResult(niche);
            if (result.status === "success") {
                leaderboardEntries.push({
                    url: `${SITE_URL}/leaderboard/${niche}`,
                    lastModified: new Date(result.data.lastUpdated),
                    changeFrequency: "weekly" as const,
                    priority: 0.8,
                });
            } else if (result.status === "error") {
                logger.error("[sitemap] Leaderboard query error for niche, preserving sitemap URL as fail-safe", { niche });
                leaderboardEntries.push({
                    url: `${SITE_URL}/leaderboard/${niche}`,
                    lastModified: MARKETING_PAGES_DATE,
                    changeFrequency: "weekly" as const,
                    priority: 0.8,
                });
            } else {
                // Confirmed empty: excluded from sitemap
                logger.info("[sitemap] Excluding confirmed empty leaderboard category from sitemap", { niche });
            }
        } catch (err) {
            logger.error("[sitemap] Unexpected error checking leaderboard niche, fail-safe including URL", {
                niche,
                error: formatError(err),
            });
            leaderboardEntries.push({
                url: `${SITE_URL}/leaderboard/${niche}`,
                lastModified: MARKETING_PAGES_DATE,
                changeFrequency: "weekly" as const,
                priority: 0.8,
            });
        }
    }

    const rawEntries: MetadataRoute.Sitemap = [
        { url: SITE_URL,                              lastModified: MARKETING_PAGES_DATE, changeFrequency: "weekly",  priority: 1.0 },
        { url: `${SITE_URL}/signup`,                  lastModified: STATIC_PAGES_DATE,     changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/pricing`,                 lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/terms`,                   lastModified: STATIC_PAGES_DATE,     changeFrequency: "yearly",  priority: 0.3 },
        { url: `${SITE_URL}/privacy`,                 lastModified: STATIC_PAGES_DATE,     changeFrequency: "yearly",  priority: 0.3 },
        // High-intent informational pages targeting top-of-funnel SEO/AI queries
        { url: `${SITE_URL}/seo`,                     lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/geo`,                     lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/aeo`,                     lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/aio`,                     lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/pseo`,                    lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.9 },
        // High priority — primary link-magnet page, no sign-up required
        { url: `${SITE_URL}/free/seo-checker`,        lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/free/gso-checker`,        lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.9 },
        // High buying-intent search queries ("aiseo vs semrush" etc.)
        { url: `${SITE_URL}/vs`,                      lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/vs/semrush`,              lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/vs/ahrefs`,               lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/vs/surfer-seo`,           lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/vs/moz`,                  lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/vs/clearscope`,           lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/vs/mangools`,             lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/vs/screaming-frog`,       lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/vs/yoast`,                lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/about`,                   lastModified: STATIC_PAGES_DATE,     changeFrequency: "yearly",  priority: 0.6 },
        { url: `${SITE_URL}/contact`,                 lastModified: STATIC_PAGES_DATE,     changeFrequency: "yearly",  priority: 0.5 },
        { url: `${SITE_URL}/methodology`,             lastModified: STATIC_PAGES_DATE,     changeFrequency: "yearly",  priority: 0.6 },
        { url: `${SITE_URL}/security`,                lastModified: STATIC_PAGES_DATE,     changeFrequency: "yearly",  priority: 0.5 },
        { url: `${SITE_URL}/for-agencies`,            lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/for-saas`,                lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/for-content`,             lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/for-ecommerce`,           lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/aria`,                    lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/blog`,                    lastModified: MARKETING_PAGES_DATE,  changeFrequency: "weekly",  priority: 0.8 },
        { url: `${SITE_URL}/case-studies`,            lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.7 },
        { url: `${SITE_URL}/changelog`,               lastModified: MARKETING_PAGES_DATE,  changeFrequency: "weekly",  priority: 0.5 },
        { url: `${SITE_URL}/free/reddit-seo`,         lastModified: MARKETING_PAGES_DATE,  changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/guide`,                   lastModified: MARKETING_PAGES_DATE, changeFrequency: "monthly", priority: 0.8 },
        ...Object.keys(GUIDES).map((slug) => ({
            url: `${SITE_URL}/guide/${slug}`,
            lastModified: MARKETING_PAGES_DATE,
            changeFrequency: "monthly" as const,
            priority: 0.8,
        })),
        { url: `${SITE_URL}/tools`,                   lastModified: KEYWORDS_MTIME,       changeFrequency: "weekly",  priority: 0.9 },
        ...(KEYWORDS as { slug: string }[])
            .filter((k) => k.slug !== "free-backlink-checker-usa")
            .map((k) => ({
                url: `${SITE_URL}/tools/${k.slug}`,
                lastModified: KEYWORDS_MTIME,
                changeFrequency: "monthly" as const,
                priority: 0.8,
            })),
        { url: `${SITE_URL}/leaderboard`,             lastModified: MARKETING_PAGES_DATE, changeFrequency: "weekly",  priority: 0.9 },
        ...leaderboardEntries,
        { url: `${SITE_URL}/aeo-guide`,              lastModified: AEO_PAGES_MTIME,      changeFrequency: "weekly",  priority: 0.9 },
        ...(AEO_PAGES as { slug: string }[]).map((p) => ({
            url: `${SITE_URL}/aeo-guide/${p.slug}`,
            lastModified: AEO_PAGES_MTIME,
            changeFrequency: "monthly" as const,
            priority: 0.8,
        })),
        ...blogs.map((b) => ({
            url: `${SITE_URL}/blog/${b.slug}`,
            lastModified: b.updatedAt,
            changeFrequency: "monthly" as const,
            priority: 0.7,
        })),
        // ── Dashboard routes intentionally excluded ──────────────────────────
        // They all require authentication and carry robots: noindex.
    ];

    // Final deduplication safeguard: each canonical URL appears at most once in the sitemap
    const seen = new Set<string>();
    const deduplicated: MetadataRoute.Sitemap = [];

    for (const entry of rawEntries) {
        const normalisedUrl = entry.url === `${SITE_URL}/` ? SITE_URL : entry.url.replace(/\/$/, "");
        if (!seen.has(normalisedUrl)) {
            seen.add(normalisedUrl);
            deduplicated.push({
                ...entry,
                url: normalisedUrl,
            });
        } else {
            logger.warn("[sitemap] Duplicate sitemap URL detected and deduplicated", { url: entry.url });
        }
    }

    return deduplicated;
}
