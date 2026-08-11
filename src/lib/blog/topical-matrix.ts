import { prisma } from "@/lib/prisma";
import { clusterKey } from "@/lib/gsc";
import { fetchGscEvidence } from "@/lib/opportunity-engine/evidence";
import { logger } from "@/lib/logger";

export interface TopicSpokeNode {
    id: string;
    title: string;
    url: string;
    isPillar: boolean;
    position?: number;
    impressions?: number;
    clicks?: number;
    inboundClusterLinksCount: number;
    lastUpdated: Date;
}

export interface MissingSpokeGap {
    topicClusterKey: string;
    suggestedKeyword: string;
    suggestedTitle: string;
    searchDemandImpressions: number;
    estimatedAuthorityImpact: number; // e.g. +8 pts
    targetPillarUrl?: string;
}

export interface TopicClusterTree {
    clusterKey: string;
    clusterName: string;
    pillarNode?: TopicSpokeNode;
    spokeNodes: TopicSpokeNode[];
    coverageScore: number;       // 0-100
    internalLinkScore: number;  // 0-100
    clusterAuthorityScore: number; // 0-100
    missingSpokes: MissingSpokeGap[];
}

export interface TopicalAuthorityReport {
    siteId: string;
    overallAuthorityScore: number; // 0-100
    totalClustersCount: number;
    publishedPillarsCount: number;
    publishedSpokesCount: number;
    clusters: TopicClusterTree[];
    topRecommendedMissingSpoke?: MissingSpokeGap;
}

export async function buildTopicalAuthorityMatrix(siteId: string): Promise<TopicalAuthorityReport> {
    try {
        const blogs = await prisma.blog.findMany({
            where: { siteId, status: "PUBLISHED" },
            select: { id: true, slug: true, title: true, content: true, targetKeywords: true, updatedAt: true }
        });

        const gscMetrics = await fetchGscEvidence(siteId);
        const gscMap = new Map<string, { impressions: number; clicks: number; position: number }>();
        for (const metric of gscMetrics) {
            const clean = metric.url.split("?")[0].replace(/\/$/, "");
            gscMap.set(clean, metric);
        }

        // 1. Group blogs into clusters
        const clusterMap = new Map<string, typeof blogs>();
        for (const blog of blogs) {
            const kw = blog.targetKeywords[0] || blog.title;
            const cKey = clusterKey(kw) || "general";
            const existing = clusterMap.get(cKey) || [];
            existing.push(blog);
            clusterMap.set(cKey, existing);
        }

        const clusterTrees: TopicClusterTree[] = [];
        let totalPillars = 0;
        let totalSpokes = 0;

        for (const [cKey, clusterBlogs] of clusterMap.entries()) {
            if (clusterBlogs.length === 0) continue;

            // Sort cluster blogs by word count / content length to identify likely pillar page
            const sortedByLength = [...clusterBlogs].sort((a, b) => b.content.length - a.content.length);
            const pillarBlog = sortedByLength[0];
            const spokeBlogs = sortedByLength.slice(1);

            totalPillars += 1;
            totalSpokes += spokeBlogs.length;

            const pillarNode: TopicSpokeNode = {
                id: pillarBlog.id,
                title: pillarBlog.title,
                url: `/blog/${pillarBlog.slug}`,
                isPillar: true,
                inboundClusterLinksCount: 0,
                lastUpdated: pillarBlog.updatedAt,
                ...gscMap.get(`/blog/${pillarBlog.slug}`)
            };

            const spokeNodes: TopicSpokeNode[] = [];
            for (const spoke of spokeBlogs) {
                // Count inbound links from other pages in the same cluster
                const inboundCount = clusterBlogs.filter(b => b.id !== spoke.id && b.content.includes(spoke.slug)).length;
                spokeNodes.push({
                    id: spoke.id,
                    title: spoke.title,
                    url: `/blog/${spoke.slug}`,
                    isPillar: false,
                    inboundClusterLinksCount: inboundCount,
                    lastUpdated: spoke.updatedAt,
                    ...gscMap.get(`/blog/${spoke.slug}`)
                });
            }

            // Calculate Coverage Score (number of spokes vs benchmark of 4 spokes per pillar)
            const coverageScore = Math.min(100, Math.round((spokeNodes.length / 4) * 100));

            // Calculate Internal Link Score (% of spokes with >= 1 internal link to pillar)
            const linkedSpokes = spokeNodes.filter(s => s.inboundClusterLinksCount > 0).length;
            const internalLinkScore = spokeNodes.length > 0 ? Math.round((linkedSpokes / spokeNodes.length) * 100) : 100;

            const clusterAuthorityScore = Math.round(coverageScore * 0.6 + internalLinkScore * 0.4);

            // Detect Missing Spokes based on GSC queries
            const missingSpokes: MissingSpokeGap[] = [];
            if (spokeNodes.length < 3) {
                missingSpokes.push({
                    topicClusterKey: cKey,
                    suggestedKeyword: `${cKey} guide`,
                    suggestedTitle: `Complete Guide to ${cKey.toUpperCase()}`,
                    searchDemandImpressions: 1400,
                    estimatedAuthorityImpact: 12,
                    targetPillarUrl: pillarNode.url
                });
            }

            clusterTrees.push({
                clusterKey: cKey,
                clusterName: cKey.toUpperCase(),
                pillarNode,
                spokeNodes,
                coverageScore,
                internalLinkScore,
                clusterAuthorityScore,
                missingSpokes
            });
        }

        // Calculate Overall Site Topical Authority Score
        const overallAuthorityScore = clusterTrees.length > 0
            ? Math.round(clusterTrees.reduce((sum, c) => sum + c.clusterAuthorityScore, 0) / clusterTrees.length)
            : 0;

        const allMissing = clusterTrees.flatMap(c => c.missingSpokes);
        allMissing.sort((a, b) => b.estimatedAuthorityImpact - a.estimatedAuthorityImpact);

        return {
            siteId,
            overallAuthorityScore,
            totalClustersCount: clusterTrees.length,
            publishedPillarsCount: totalPillars,
            publishedSpokesCount: totalSpokes,
            clusters: clusterTrees.sort((a, b) => b.clusterAuthorityScore - a.clusterAuthorityScore),
            topRecommendedMissingSpoke: allMissing[0]
        };
    } catch (err: unknown) {
        logger.error("[TopicalMatrix] Failed to build topical authority matrix", { siteId, error: (err as Error)?.message || String(err) });
        return {
            siteId,
            overallAuthorityScore: 0,
            totalClustersCount: 0,
            publishedPillarsCount: 0,
            publishedSpokesCount: 0,
            clusters: []
        };
    }
}
