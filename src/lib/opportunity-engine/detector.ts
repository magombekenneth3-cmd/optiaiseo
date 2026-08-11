import { prisma } from "@/lib/prisma";
import { RawOpportunitySignal, GscPageMetric } from "./types";

export function normalizeUrl(rawUrl: string, domain: string): string {
    let url = rawUrl.trim().toLowerCase();
    url = url.replace(/^https?:\/\//, "").replace(/^www\./, "");
    const domainClean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
    if (url.startsWith(domainClean)) {
        url = url.slice(domainClean.length);
    }
    url = url.split("?")[0].split("#")[0];
    if (!url.startsWith("/")) url = "/" + url;
    return url.replace(/\/$/, "") || "/";
}

export async function detectRawOpportunities(
    siteId: string,
    gscMetrics: GscPageMetric[] = [],
    options: { modifiedSince?: Date } = {}
): Promise<RawOpportunitySignal[]> {
    const rawSignals: RawOpportunitySignal[] = [];

    const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: { id: true, domain: true }
    });
    if (!site) return [];

    const whereClause: any = { siteId, status: "PUBLISHED" };
    if (options.modifiedSince) {
        whereClause.updatedAt = { gte: options.modifiedSince };
    }

    const blogs = await prisma.blog.findMany({
        where: whereClause,
        select: { id: true, slug: true, title: true, content: true, targetKeywords: true, updatedAt: true }
    });

    // 1. High-Scale O(1) Database Link Index Query (Fallback to string scan if empty)
    const inboundLinkMap = new Map<string, number>();
    try {
        const linkCounts = await (prisma as any).internalLink.groupBy({
            by: ["targetUrl"],
            where: { siteId },
            _count: { sourceBlogId: true }
        });
        for (const row of linkCounts) {
            inboundLinkMap.set(normalizeUrl(row.targetUrl, site.domain), row._count.sourceBlogId);
        }
    } catch {
        // Fallback for environment before internal links are seeded
        for (const blog of blogs) {
            for (const targetBlog of blogs) {
                if (blog.id === targetBlog.id) continue;
                if (blog.content.includes(targetBlog.slug)) {
                    const canonicalTarget = normalizeUrl(`/blog/${targetBlog.slug}`, site.domain);
                    inboundLinkMap.set(canonicalTarget, (inboundLinkMap.get(canonicalTarget) || 0) + 1);
                }
            }
        }
    }

    // 2. Map GSC metrics to canonical URLs
    const gscMap = new Map<string, GscPageMetric>();
    for (const metric of gscMetrics) {
        const canonical = normalizeUrl(metric.url, site.domain);
        gscMap.set(canonical, metric);
    }

    // 3. Process each published blog
    for (const blog of blogs) {
        const canonicalUrl = normalizeUrl(`/blog/${blog.slug}`, site.domain);
        const primaryKeyword = blog.targetKeywords[0] || blog.title;
        const inboundCount = inboundLinkMap.get(canonicalUrl) || 0;
        const gscData = gscMap.get(canonicalUrl);

        const impressions = gscData?.impressions ?? 0;
        const clicks = gscData?.clicks ?? 0;
        const position = gscData?.position ?? 0;
        const prevPosition = gscData?.previousPosition;

        // Check STALE (>180 days)
        const daysOld = (Date.now() - new Date(blog.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysOld > 180) {
            rawSignals.push({
                url: canonicalUrl,
                keyword: primaryKeyword,
                category: "STALE",
                impressions,
                clicks,
                position,
                previousPosition: prevPosition,
                lastUpdated: blog.updatedAt,
                inboundInternalLinksCount: inboundCount,
                evidenceText: `Content was last updated ${Math.round(daysOld)} days ago.`
            });
        }

        // Check ORPHANED (<2 internal links)
        if (inboundCount < 2) {
            rawSignals.push({
                url: canonicalUrl,
                keyword: primaryKeyword,
                category: "ORPHANED",
                impressions,
                clicks,
                position,
                inboundInternalLinksCount: inboundCount,
                evidenceText: `Only ${inboundCount} internal link points to this page.`
            });
        }

        // Check QUICK_WIN (Position 4-15 with impressions)
        if (position >= 4 && position <= 15 && impressions >= 50) {
            rawSignals.push({
                url: canonicalUrl,
                keyword: primaryKeyword,
                category: "QUICK_WIN",
                impressions,
                clicks,
                position,
                previousPosition: prevPosition,
                inboundInternalLinksCount: inboundCount,
                evidenceText: `Page ranks at position ${position.toFixed(1)} with ${impressions.toLocaleString()} impressions.`
            });
        }

        // Check ALMOST_RANKING (Position 11-20)
        if (position >= 11 && position <= 20 && impressions >= 30) {
            rawSignals.push({
                url: canonicalUrl,
                keyword: primaryKeyword,
                category: "ALMOST_RANKING",
                impressions,
                clicks,
                position,
                previousPosition: prevPosition,
                inboundInternalLinksCount: inboundCount,
                evidenceText: `Page ranks just off page 1 at position ${position.toFixed(1)}.`
            });
        }

        // Check DECLINING (Position drop >= 2)
        if (prevPosition && position - prevPosition >= 2) {
            rawSignals.push({
                url: canonicalUrl,
                keyword: primaryKeyword,
                category: "DECLINING",
                impressions,
                clicks,
                position,
                previousPosition: prevPosition,
                inboundInternalLinksCount: inboundCount,
                evidenceText: `Position dropped from ${prevPosition.toFixed(1)} to ${position.toFixed(1)}.`
            });
        }
    }

    return rawSignals;
}
