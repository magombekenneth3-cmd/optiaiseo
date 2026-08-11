import pLimit from "p-limit";
import crypto from "crypto";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getEmbedding, cosineSimilarity } from "@/lib/aeo/embeddings";
import { injectInternalLinks } from "./internalLinks";
import { getRedis } from "@/lib/redis";

export interface VectorLinkOpportunity {
    legacyBlogId: string;
    legacySlug: string;
    newBlogId: string;
    newSlug: string;
    similarityScore: number;
    anchorText: string;
    updated: boolean;
    stage: "AUTO_LINK" | "CANDIDATE";
}

const LINK_THRESHOLDS = {
    AUTO_LINK: 0.85,
    CANDIDATE: 0.75,
};

async function getCachedEmbedding(text: string): Promise<number[]> {
    const redis = getRedis();
    const hash = crypto.createHash("md5").update(text).digest("hex");
    const cacheKey = `emb:${hash}`;

    if (redis) {
        try {
            const cached = await redis.get<number[]>(cacheKey);
            if (cached && Array.isArray(cached) && cached.length > 0) {
                return cached;
            }
        } catch { /* Fallback to live API */ }
    }

    const embedding = await getEmbedding(text);

    if (redis && embedding.length > 0) {
        try {
            await redis.set(cacheKey, JSON.stringify(embedding), { ex: 604800 }); // 7 days TTL
        } catch { /* non-fatal */ }
    }

    return embedding;
}

export async function syncVectorInternalLinksForSite(
    siteId: string,
    newlyPublishedBlogId?: string
): Promise<VectorLinkOpportunity[]> {
    try {
        // 1. Hoist DB site query OUT OF LOOP
        const site = await prisma.site.findUnique({
            where: { id: siteId },
            select: { domain: true }
        });

        const publishedBlogs = await prisma.blog.findMany({
            where: { siteId, status: "PUBLISHED" },
            select: {
                id: true,
                slug: true,
                title: true,
                content: true,
                targetKeywords: true,
                updatedAt: true,
            },
        });

        if (publishedBlogs.length < 2) return [];

        const targetBlog = newlyPublishedBlogId
            ? publishedBlogs.find(b => b.id === newlyPublishedBlogId)
            : publishedBlogs[0];

        if (!targetBlog) return [];

        const targetText = `${targetBlog.title} ${targetBlog.targetKeywords.join(" ")} ${targetBlog.content.slice(0, 1000)}`;
        const targetEmbedding = await getCachedEmbedding(targetText);
        if (targetEmbedding.length === 0) return [];

        // 2. Batch concurrent candidate embeddings with p-limit (concurrency: 5)
        const limit = pLimit(5);
        const legacyCandidates = publishedBlogs.filter(
            b => b.id !== targetBlog.id && !b.content.includes(`/blog/${targetBlog.slug}`)
        );

        const candidatesWithEmbeddings = await Promise.all(
            legacyCandidates.map(legacyBlog =>
                limit(async () => {
                    const legacyText = `${legacyBlog.title} ${legacyBlog.targetKeywords.join(" ")} ${legacyBlog.content.slice(0, 1000)}`;
                    const embedding = await getCachedEmbedding(legacyText);
                    const score = embedding.length > 0 ? cosineSimilarity(targetEmbedding, embedding) : 0;
                    return { legacyBlog, score };
                })
            )
        );

        const opportunities: VectorLinkOpportunity[] = [];

        // 3. 2-Stage Threshold Hierarchy
        for (const { legacyBlog, score } of candidatesWithEmbeddings) {
            if (score < LINK_THRESHOLDS.CANDIDATE) continue;

            const isAutoLink = score >= LINK_THRESHOLDS.AUTO_LINK;
            let updated = false;

            // Stage 1: Auto Link (>= 0.85) — Modify Blog HTML
            if (isAutoLink) {
                const updatedHtml = await injectInternalLinks(
                    legacyBlog.content,
                    siteId,
                    legacyBlog.slug,
                    site?.domain
                );

                if (updatedHtml !== legacyBlog.content && updatedHtml.includes(targetBlog.slug)) {
                    await prisma.blog.update({
                        where: { id: legacyBlog.id },
                        data: { content: updatedHtml },
                    });
                    updated = true;
                }
            }

            // Stage 2: Report opportunity (Auto or Candidate 0.75-0.84)
            opportunities.push({
                legacyBlogId: legacyBlog.id,
                legacySlug: legacyBlog.slug,
                newBlogId: targetBlog.id,
                newSlug: targetBlog.slug,
                similarityScore: Math.round(score * 100) / 100,
                anchorText: targetBlog.title,
                updated,
                stage: isAutoLink ? "AUTO_LINK" : "CANDIDATE",
            });
        }

        logger.info("[VectorLinker] Internal link matrix sync completed", {
            siteId,
            targetBlogId: targetBlog.id,
            totalOpportunities: opportunities.length,
            autoLinksApplied: opportunities.filter(o => o.updated).length,
            candidatesFound: opportunities.filter(o => o.stage === "CANDIDATE").length,
        });

        return opportunities;
    } catch (error: unknown) {
        logger.error("[VectorLinker] Link matrix sync failed:", { error: (error as Error)?.message || String(error) });
        return [];
    }
}

