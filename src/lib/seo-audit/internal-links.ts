/**
 * src/lib/seo-audit/internal-links.ts
 *
 * FIX #5 — Full internal link analysis module.
 *
 * Expanded from the original keyword-clustering stub into a three-part analysis:
 *   1. Semantic link opportunity recommendations (keyword cluster → pillar page)
 *   2. Broken internal link detection (sampled in-page links → HEAD requests)
 *   3. Orphan page detection via sitemap vs inbound link cross-reference
 */

import { parse } from 'node-html-parser';
import prisma from "@/lib/prisma";
import { clusterKeywords, EnrichedKeyword } from "@/lib/keywords";
import { isSafeUrl } from '@/lib/security/safe-url';

// ── Existing export (preserved for backward compat) ───────────────────────────

export interface LinkingRecommendation {
    sourceUrl: string;
    targetUrl: string;
    anchorText: string;
    reason: string;
    semanticScore: number;
}

export async function analyzeInternalLinking(siteId: string): Promise<LinkingRecommendation[]> {
    const site = await prisma.site.findUnique({
        where: { id: siteId },
        include: { rankSnapshots: true }
    });

    if (!site || site.rankSnapshots.length === 0) return [];

    // 1. Cluster the keywords to find topic pillars
    const enrichedKeywords: EnrichedKeyword[] = site.rankSnapshots.map(rs => ({
        keyword: rs.keyword,
        searchVolume: 0,
        difficulty: 0,
        gscPosition: rs.position,
        gscUrl: rs.url || "",
        intent: rs.intent || "Informational",
        opportunityScore: 0,
        recommendation: ""
    }));

    const clusters = await clusterKeywords(enrichedKeywords);

    const recommendations: LinkingRecommendation[] = [];

    // 2. For each cluster, find the "Pillar" page
    for (const cluster of clusters) {
        const pillarPage = [...cluster.keywords].sort((a, b) => (a.gscPosition || 100) - (b.gscPosition || 100))[0];

        if (!pillarPage?.gscUrl) continue;

        // 3. Find other pages in the same cluster that should link to this pillar
        const supportingPages = cluster.keywords.filter(kw => kw.gscUrl && kw.gscUrl !== pillarPage.gscUrl);

        for (const support of supportingPages) {
            recommendations.push({
                sourceUrl: support.gscUrl!,
                targetUrl: pillarPage.gscUrl,
                anchorText: cluster.topic, // Use cluster topic as semantic anchor
                reason: `Semantic support for topic pillar: ${cluster.topic}`,
                semanticScore: 0.85
            });
        }
    }

    return recommendations.slice(0, 20); // Return top 20 semantic link opportunities
}

// ── FIX #5: Full Internal Link Analysis ──────────────────────────────────────

export interface BrokenLink {
    url: string;
    foundOn: string;
    httpStatus: number | null;   // null = network timeout
    error?: string;
}

export interface OrphanPage {
    url: string;
    reason: string;
}

export interface InternalLinkAnalysisResult {
    /** Semantic pillar-page link opportunities (max 20) */
    linkOpportunities: LinkingRecommendation[];
    /** Internal links that returned 4xx/5xx or timed out (sampled, max 50) */
    brokenLinks: BrokenLink[];
    /** Pages in the sitemap with zero inbound internal links */
    orphanPages: OrphanPage[];
    /** Aggregated stats */
    stats: {
        totalInternalLinks: number;
        uniqueInternalLinks: number;
        brokenCount: number;
        orphanCount: number;
    };
}

/**
 * Performs a full three-part internal link analysis for a given URL.
 *
 * - Broken links: samples up to `maxLinksToCheck` in-page hrefs with HEAD requests
 * - Orphan pages: discovers pages via sitemap and cross-references inbound link data
 *
 * All network calls are wrapped in try/catch so a single timeout cannot fail
 * the entire analysis.
 */
export async function analyzeInternalLinksForUrl(
    pageUrl: string,
    html: string,
    options: { maxLinksToCheck?: number; timeout?: number } = {}
): Promise<InternalLinkAnalysisResult> {
    const { maxLinksToCheck = 40, timeout = 6000 } = options;

    const origin = (() => {
        try { return new URL(pageUrl).origin; } catch { return ''; }
    })();

    // ── Parse in-page internal links ─────────────────────────────────────────
    const root = parse(html);
    const allAnchorTags = root.querySelectorAll('a[href]');

    const normalise = (href: string): string | null => {
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return null;
        try {
            const u = new URL(href, origin);
            if (u.origin !== origin) return null; // external
            return u.href.split('#')[0]; // strip fragment
        } catch {
            return null;
        }
    };

    const rawLinks: string[] = [];
    allAnchorTags.forEach(a => {
        const href = a.getAttribute('href') || '';
        const resolved = normalise(href);
        if (resolved) rawLinks.push(resolved);
    });

    const total = rawLinks.length;
    const unique = [...new Set(rawLinks)];

    // ── Broken link detection (HEAD-sampled) ──────────────────────────────────
    const toCheck = unique.slice(0, maxLinksToCheck);
    const brokenLinks: BrokenLink[] = [];

    await Promise.allSettled(
        toCheck.map(async (url) => {
            try {
                const res = await fetch(url, {
                    method: 'HEAD',
                    redirect: 'follow',
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OptiAISEO-LinkBot/1.0)' },
                    signal: AbortSignal.timeout(timeout),
                });
                const guard = isSafeUrl(res.url);
                if (!guard.ok) return;
                if (res.status >= 400) {
                    brokenLinks.push({ url, foundOn: pageUrl, httpStatus: res.status });
                }
            } catch (err: unknown) {
                const isDns = (err as Error)?.message?.includes('ENOTFOUND');
                brokenLinks.push({
                    url,
                    foundOn: pageUrl,
                    httpStatus: null,
                    error: isDns ? 'DNS resolution failed' : 'Request timeout / connection error',
                });
            }
        })
    );

    // ── Orphan page detection (sitemap cross-reference) ───────────────────────
    let orphanPages: OrphanPage[] = [];

    try {
        const sitemapRes = await fetch(`${origin}/sitemap.xml`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OptiAISEO-LinkBot/1.0)' },
            signal: AbortSignal.timeout(8000),
        });

        if (sitemapRes.ok) {
            const sitemapXml = await sitemapRes.text();
            const locRegex = /<loc>\s*([^<]+)\s*<\/loc>/gi;
            const sitemapUrls = new Set<string>();
            let m: RegExpExecArray | null;
            while ((m = locRegex.exec(sitemapXml)) !== null) {
                const u = m[1].trim().split('#')[0];
                if (u.startsWith(origin)) sitemapUrls.add(u);
            }

            // Build an inbound-link set from our sampled page
            const inboundUrls = new Set<string>(rawLinks.map(l => l.split('#')[0]));

            // Orphan = in sitemap, not linked from the current page (approximation;
            // a full crawl would check all pages, but we surface what we can here)
            for (const sUrl of sitemapUrls) {
                if (sUrl === pageUrl || sUrl === origin || sUrl === `${origin}/`) continue;
                if (!inboundUrls.has(sUrl)) {
                    orphanPages.push({
                        url: sUrl,
                        reason: 'Found in sitemap.xml but no inbound internal link detected from this page.',
                    });
                }
            }

            // Cap at 20 orphans (most impactful shown first — shorter URLs = top-level pages)
            orphanPages = orphanPages
                .sort((a, b) => a.url.length - b.url.length)
                .slice(0, 20);
        }
    } catch {
        // Sitemap fetch failed — skip orphan detection gracefully
    }

    return {
        linkOpportunities: [], // populated by analyzeInternalLinking() which needs siteId
        brokenLinks: brokenLinks.slice(0, 50),
        orphanPages,
        stats: {
            totalInternalLinks: total,
            uniqueInternalLinks: unique.length,
            brokenCount: brokenLinks.length,
            orphanCount: orphanPages.length,
        },
    };
}
