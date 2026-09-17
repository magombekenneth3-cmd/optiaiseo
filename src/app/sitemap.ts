import type { MetadataRoute } from "next";
import { statSync } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { NICHES } from "@/lib/leaderboard";
import { GUIDES } from "./guide/[slug]/page";
import KEYWORDS from "@/data/keywords.json";
import AEO_PAGES from "@/data/aeo-pages.json";

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


// Prefer NEXT_PUBLIC_SITE_URL (set in Railway). NEXT_PUBLIC_APP_URL is the legacy alias.
// Hardcode the production domain as final fallback so sitemap URLs are never malformed.
const SITE_URL = (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://optiaiseo.online"
).replace(/\/$/, "");

if (!SITE_URL) {
    console.warn("[sitemap] WARNING: NEXT_PUBLIC_SITE_URL is not set. Sitemap URLs will be malformed.");
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
        .catch(() => [] as { slug: string; updatedAt: Date }[]);

    return [
        { url: SITE_URL,                              lastModified: MARKETING_PAGES_DATE, changeFrequency: "weekly",  priority: 1.0 },
        { url: `${SITE_URL}/signup`,                  lastModified: STATIC_PAGES_DATE,     changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/login`,                   lastModified: STATIC_PAGES_DATE,     changeFrequency: "monthly", priority: 0.5 },
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
        // Targeting the specific queries ranking #70-75 with high impressions.
        // The /vs/[competitor] pages cover "X vs OptiAISEO" intent. These
        // /tools/ pSEO pages cover "X alternative / X alternatives" intent.
        { url: `${SITE_URL}/tools/moz-alternatives`,          lastModified: KEYWORDS_MTIME, changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/tools/ahrefs-alternatives-free`,  lastModified: KEYWORDS_MTIME, changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/tools/clearscope-alternatives`,   lastModified: KEYWORDS_MTIME, changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/tools/screaming-frog-alternatives`, lastModified: KEYWORDS_MTIME, changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/tools/mangools-alternatives`,     lastModified: KEYWORDS_MTIME, changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/tools/surfer-seo-alternatives`,   lastModified: KEYWORDS_MTIME, changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/tools/semrush-alternatives-free`, lastModified: KEYWORDS_MTIME, changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/guide`,                   lastModified: MARKETING_PAGES_DATE, changeFrequency: "monthly", priority: 0.8 },
        ...Object.keys(GUIDES).map((slug) => ({
            url: `${SITE_URL}/guide/${slug}`,
            lastModified: MARKETING_PAGES_DATE,
            changeFrequency: "monthly" as const,
            priority: 0.8,
        })),
        { url: `${SITE_URL}/tools`,                   lastModified: KEYWORDS_MTIME,       changeFrequency: "weekly",  priority: 0.9 },
        ...(KEYWORDS as { slug: string }[]).map((k) => ({
            url: `${SITE_URL}/tools/${k.slug}`,
            lastModified: KEYWORDS_MTIME,
            changeFrequency: "monthly" as const,
            priority: 0.8,
        })),
        { url: `${SITE_URL}/leaderboard`,             lastModified: MARKETING_PAGES_DATE, changeFrequency: "weekly",  priority: 0.9 },
        ...NICHES.map((niche) => ({
            url: `${SITE_URL}/leaderboard/${niche}`,
            lastModified: MARKETING_PAGES_DATE,
            changeFrequency: "weekly" as const,
            priority: 0.8,
        })),
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

}
