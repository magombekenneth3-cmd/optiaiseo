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
import { prisma } from "@/lib/prisma";
import { clusterKeywords, EnrichedKeyword } from "@/lib/keywords";
import { isSafeUrl } from '@/lib/security/safe-url';
import { redis } from "@/lib/redis";


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

    for (const cluster of clusters) {
        const pillarPage = [...cluster.keywords].sort((a, b) => (a.gscPosition || 100) - (b.gscPosition || 100))[0];

        if (!pillarPage?.gscUrl) continue;

        const supportingPages = cluster.keywords.filter(kw => kw.gscUrl && kw.gscUrl !== pillarPage.gscUrl);

        for (const support of supportingPages) {
            recommendations.push({
                sourceUrl: support.gscUrl!,
                targetUrl: pillarPage.gscUrl,
                anchorText: cluster.topic,
                reason: `Semantic support for topic pillar: ${cluster.topic}`,
                semanticScore: 0.85
            });
        }
    }

    return recommendations.slice(0, 20);
}


export interface BrokenLink {
    url: string;
    foundOn: string;
    httpStatus: number | null;
    error?: string;
}

export interface OrphanPage {
    url: string;
    reason: string;
}

export interface InternalLinkAnalysisResult {
    linkOpportunities: LinkingRecommendation[];
    brokenLinks: BrokenLink[];
    orphanPages: OrphanPage[];
    stats: {
        totalInternalLinks: number;
        uniqueInternalLinks: number;
        brokenCount: number;
        orphanCount: number;
        clickDepth?: number;
    };
}

export async function analyzeInternalLinksForUrl(
    pageUrl: string,
    html: string,
    options: { maxLinksToCheck?: number; timeout?: number } = {}
): Promise<InternalLinkAnalysisResult> {
    const { maxLinksToCheck = 40, timeout = 6000 } = options;

    const origin = (() => {
        try { return new URL(pageUrl).origin; } catch { return ''; }
    })();

    const root = parse(html);
    const allAnchorTags = root.querySelectorAll('a[href]');

    const normalise = (href: string): string | null => {
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return null;
        try {
            const u = new URL(href, origin);
            if (u.origin !== origin) return null;
            return u.href.split('#')[0];
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

    let orphanPages: OrphanPage[] = [];
    let detectedClickDepth: number | undefined = undefined;

    if (origin) {
        try {
            const cachedGraphRaw = await redis.get(`site:crawl:${origin}`);
            if (cachedGraphRaw) {
                const cachedGraph = typeof cachedGraphRaw === 'string' ? JSON.parse(cachedGraphRaw) : cachedGraphRaw;

                if (cachedGraph?.clickDepthMap && typeof cachedGraph.clickDepthMap[pageUrl] === 'number') {
                    detectedClickDepth = cachedGraph.clickDepthMap[pageUrl];
                }

                if (Array.isArray(cachedGraph?.orphanPages)) {
                    orphanPages = cachedGraph.orphanPages.map((url: string) => ({
                        url,
                        reason: 'True orphan page — detected with 0 internal inbound links during multi-depth site crawl.',
                    }));
                }

                if (Array.isArray(cachedGraph?.brokenLinks)) {
                    for (const bl of cachedGraph.brokenLinks) {
                        if (!brokenLinks.some(b => b.url === bl.to)) {
                            brokenLinks.push({
                                url: bl.to,
                                foundOn: bl.from,
                                httpStatus: bl.status > 0 ? bl.status : null,
                                error: bl.status === 0 ? 'Network Error / Timeout during site crawl' : undefined,
                            });
                        }
                    }
                }
            }
        } catch {
        }
    }

    if (orphanPages.length === 0 && origin) {
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

                const inboundUrls = new Set<string>(rawLinks.map(l => l.split('#')[0]));

                for (const sUrl of sitemapUrls) {
                    if (sUrl === pageUrl || sUrl === origin || sUrl === `${origin}/`) continue;
                    if (!inboundUrls.has(sUrl)) {
                        orphanPages.push({
                            url: sUrl,
                            reason: 'Found in sitemap.xml but no inbound internal link detected from this page.',
                        });
                    }
                }

                orphanPages = orphanPages
                    .sort((a, b) => a.url.length - b.url.length)
                    .slice(0, 20);
            }
        } catch {
        }
    }

    return {
        linkOpportunities: [],
        brokenLinks: brokenLinks.slice(0, 50),
        orphanPages,
        stats: {
            totalInternalLinks: total,
            uniqueInternalLinks: unique.length,
            brokenCount: brokenLinks.length,
            orphanCount: orphanPages.length,
            clickDepth: detectedClickDepth,
        },
    };
}
