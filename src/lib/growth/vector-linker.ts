import { logger } from "@/lib/logger";

export interface BlogPillarCandidate {
    id: string;
    title: string;
    slug: string;
    content: string;
}

export interface VectorLinkResult {
    sourceBlogId: string;
    targetBlogId: string;
    anchorText: string;
    relevanceScore: number; // 0-1 scale
    targetUrl: string;
}

export function computeSimpleTextSimilarity(textA: string, textB: string): number {
    const setA = new Set(textA.toLowerCase().split(/\s+/));
    const setB = new Set(textB.toLowerCase().split(/\s+/));

    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
}

export function findBestInternalLinkMatch(
    targetBlog: BlogPillarCandidate,
    candidates: BlogPillarCandidate[],
    primaryKeyword: string
): VectorLinkResult | null {
    if (candidates.length === 0) return null;

    let bestCandidate: BlogPillarCandidate | null = null;
    let highestScore = -1;

    for (const candidate of candidates) {
        if (candidate.id === targetBlog.id) continue;

        const simTitle = computeSimpleTextSimilarity(targetBlog.title, candidate.title);
        const simKeyword = computeSimpleTextSimilarity(primaryKeyword, candidate.title);
        const totalScore = simTitle * 0.6 + simKeyword * 0.4;

        if (totalScore > highestScore) {
            highestScore = totalScore;
            bestCandidate = candidate;
        }
    }

    if (!bestCandidate) return null;

    logger.info("[VectorLinker] Found optimal internal link candidate", {
        targetBlogId: targetBlog.id,
        sourceBlogId: bestCandidate.id,
        score: highestScore,
    });

    return {
        sourceBlogId: bestCandidate.id,
        targetBlogId: targetBlog.id,
        anchorText: primaryKeyword,
        relevanceScore: Math.round(highestScore * 100) / 100,
        targetUrl: `/blog/${targetBlog.slug}`,
    };
}
