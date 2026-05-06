import type { MetadataRoute } from "next";
import prisma from "@/lib/prisma";
import { NICHES } from "@/lib/leaderboard";
import { GUIDES } from "./guide/[slug]/page";
import KEYWORDS from "@/data/keywords.json";
import AEO_PAGES from "@/data/aeo-pages.json";

// Revalidate every hour — prevents Prisma cold queries on every Googlebot hit.
// Blog posts are added within 1 hour of publish, which is fast enough for indexing.
export const revalidate = 3600;



// Prefer NEXT_PUBLIC_SITE_URL (set in Railway). NEXT_PUBLIC_APP_URL is the legacy alias.
// Hardcode the production domain as final fallback so sitemap URLs are never malformed.
const SITE_URL = (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://www.optiaiseo.online"
).replace(/\/$/, "");

if (!SITE_URL) {
    console.warn("[sitemap] WARNING: NEXT_PUBLIC_SITE_URL is not set. Sitemap URLs will be malformed.");
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    // ── Published blog posts ──────────────────────────────────────────────────
    const blogs = await prisma.blog
        .findMany({
            where: { status: "PUBLISHED" },
            select: { slug: true, updatedAt: true },
            orderBy: { updatedAt: "desc" },
            take: 1000,
        })
        .catch(() => [] as { slug: string; updatedAt: Date }[]);

    return [
        // ── Public marketing pages ───────────────────────────────────────────
        { url: SITE_URL,                              lastModified: new Date(), changeFrequency: "weekly",  priority: 1.0 },
        { url: `${SITE_URL}/signup`,                  lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/login`,                   lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
        { url: `${SITE_URL}/pricing`,                 lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/terms`,                   lastModified: new Date(), changeFrequency: "yearly",  priority: 0.3 },
        { url: `${SITE_URL}/privacy`,                 lastModified: new Date(), changeFrequency: "yearly",  priority: 0.3 },
        // ── SEO Pillar Pages ─────────────────────────────────────────────────
        // High-intent informational pages targeting top-of-funnel SEO/AI queries
        { url: `${SITE_URL}/seo`,                     lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/geo`,                     lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/aeo`,                     lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/aio`,                     lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/pseo`,                    lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
        // ── Free tools ───────────────────────────────────────────────────────
        // High priority — primary link-magnet page, no sign-up required
        { url: `${SITE_URL}/free/seo-checker`,        lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/free/gso-checker`,        lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
        // ── Competitor comparison pages ──────────────────────────────────────
        // High buying-intent search queries ("aiseo vs semrush" etc.)
        { url: `${SITE_URL}/vs`,                      lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/vs/semrush`,              lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/vs/ahrefs`,               lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/vs/surfer-seo`,           lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/vs/moz`,                  lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/vs/clearscope`,           lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/vs/mangools`,             lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/vs/screaming-frog`,       lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/vs/yoast`,                lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        // ── Trust / E-E-A-T pages ────────────────────────────────────────────
        { url: `${SITE_URL}/about`,                   lastModified: new Date(), changeFrequency: "yearly",  priority: 0.6 },
        { url: `${SITE_URL}/contact`,                 lastModified: new Date(), changeFrequency: "yearly",  priority: 0.5 },
        { url: `${SITE_URL}/methodology`,             lastModified: new Date(), changeFrequency: "yearly",  priority: 0.6 },
        { url: `${SITE_URL}/security`,                lastModified: new Date(), changeFrequency: "yearly",  priority: 0.5 },
        // ── Use-case landing pages ───────────────────────────────────────────
        { url: `${SITE_URL}/for-agencies`,            lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/for-saas`,                lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/for-content`,             lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        { url: `${SITE_URL}/for-ecommerce`,           lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        // ── Feature & growth pages ───────────────────────────────────────────
        { url: `${SITE_URL}/aria`,                    lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/blog`,                    lastModified: new Date(), changeFrequency: "weekly",  priority: 0.8 },
        { url: `${SITE_URL}/case-studies`,            lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
        { url: `${SITE_URL}/changelog`,               lastModified: new Date(), changeFrequency: "weekly",  priority: 0.5 },
        { url: `${SITE_URL}/free/reddit-seo`,         lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        // ── High-value keyword-opportunity pages ─────────────────────────────
        // Targeting the specific queries ranking #70-75 with high impressions.
        // The /vs/[competitor] pages cover "X vs OptiAISEO" intent. These
        // /tools/ pSEO pages cover "X alternative / X alternatives" intent.
        { url: `${SITE_URL}/tools/moz-alternatives`,          lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/tools/ahrefs-alternatives-free`,  lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/tools/clearscope-alternatives`,   lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/tools/screaming-frog-alternatives`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/tools/mangools-alternatives`,     lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/tools/surfer-seo-alternatives`,   lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/tools/semrush-alternatives-free`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
        // ── Long-tail guide pages (low-competition, high topical authority) ──
        { url: `${SITE_URL}/guide`,                   lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
        ...Object.keys(GUIDES).map((slug) => ({
            url: `${SITE_URL}/guide/${slug}`,
            lastModified: new Date(),
            changeFrequency: "monthly" as const,
            priority: 0.8,
        })),
        // ── Programmatic SEO tool pages (100 keyword-targeted pages) ────────
        { url: `${SITE_URL}/tools`,                   lastModified: new Date(), changeFrequency: "weekly",  priority: 0.9 },
        ...(KEYWORDS as { slug: string }[]).map((k) => ({
            url: `${SITE_URL}/tools/${k.slug}`,
            lastModified: new Date(),
            changeFrequency: "monthly" as const,
            priority: 0.8,
        })),
        { url: `${SITE_URL}/leaderboard`,             lastModified: new Date(), changeFrequency: "weekly",  priority: 0.9 },
        ...NICHES.map((niche) => ({
            url: `${SITE_URL}/leaderboard/${niche}`,
            lastModified: new Date(),
            changeFrequency: "weekly" as const,
            priority: 0.8,
        })),
        // ── Programmatic AEO guide pages (60 intent-targeted pages) ───────────
        { url: `${SITE_URL}/aeo-guide`,              lastModified: new Date(), changeFrequency: "weekly",  priority: 0.9 },
        ...(AEO_PAGES as { slug: string }[]).map((p) => ({
            url: `${SITE_URL}/aeo-guide/${p.slug}`,
            lastModified: new Date(),
            changeFrequency: "monthly" as const,
            priority: 0.8,
        })),
        // ── Published blog posts ─────────────────────────────────────────────
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
