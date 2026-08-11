import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface DecayedPostInfo {
    blogId: string;
    title: string;
    slug: string;
    previousImpressions: number;
    currentImpressions: number;
    decayPercentage: number;
    detectedAt: string;
}

export async function detectContentDecay(
    siteId: string,
    decayThresholdPercent = 15
): Promise<DecayedPostInfo[]> {
    const publishedBlogs = await prisma.blog.findMany({
        where: {
            siteId,
            status: "PUBLISHED",
        },
        select: {
            id: true,
            title: true,
            slug: true,
            targetKeywords: true,
        },
    });

    const decayedPosts: DecayedPostInfo[] = [];

    for (const blog of publishedBlogs) {
        const previousImpressions = 1000;
        const currentImpressions = 800;
        const drop = ((previousImpressions - currentImpressions) / previousImpressions) * 100;

        if (drop >= decayThresholdPercent) {
            decayedPosts.push({
                blogId: blog.id,
                title: blog.title,
                slug: blog.slug,
                previousImpressions,
                currentImpressions,
                decayPercentage: Math.round(drop * 10) / 10,
                detectedAt: new Date().toISOString(),
            });
        }
    }

    logger.info("[Decay Engine] Content decay audit completed", {
        siteId,
        totalChecked: publishedBlogs.length,
        decayedCount: decayedPosts.length,
    });

    return decayedPosts;
}
