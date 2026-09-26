import pLimit from "p-limit";
import crypto from "crypto";
import { logger, formatError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getEmbedding, cosineSimilarity } from "@/lib/aeo/embeddings";
import { injectSpecificInternalLink } from "./internalLinks";
import { getRedis } from "@/lib/redis";

export interface VectorLinkOpportunity {
    legacyBlogId: string;
    legacySlug: string;
    newBlogId: string;
    newSlug: string;
    similarityScore: number;
    keywordOverlapScore: number;
    combinedScore: number;
    anchorText: string;
    reason: string;
    updated: boolean;
    stage: "AUTO_LINK" | "CANDIDATE";
    signals: LinkSignal[];
}

export interface LinkSignal {
    type: "vector_similarity" | "keyword_overlap" | "title_mention" | "entity_overlap";
    score: number;
    detail: string;
}

const LINK_THRESHOLDS = {
    AUTO_LINK: 0.80,
    CANDIDATE: 0.60,
};

const SIGNAL_WEIGHTS = {
    vector_similarity: 0.4,
    keyword_overlap: 0.3,
    title_mention: 0.15,
    entity_overlap: 0.15,
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
        } catch { }
    }

    const embedding = await getEmbedding(text);

    if (redis && embedding.length > 0) {
        try {
            await redis.set(cacheKey, JSON.stringify(embedding), { ex: 604800 });
        } catch { }
    }

    return embedding;
}

function computeKeywordOverlap(keywordsA: string[], keywordsB: string[]): number {
    if (keywordsA.length === 0 || keywordsB.length === 0) return 0;
    const setA = new Set(keywordsA.map(k => k.toLowerCase()));
    const setB = new Set(keywordsB.map(k => k.toLowerCase()));
    let overlap = 0;
    for (const kw of setA) {
        if (setB.has(kw)) overlap++;
    }
    const union = new Set([...setA, ...setB]).size;
    return union > 0 ? overlap / union : 0;
}

function checkTitleMention(title: string, content: string): number {
    const titleLower = title.toLowerCase();
    const contentLower = content.toLowerCase();
    if (contentLower.includes(titleLower)) return 1.0;
    const titleWords = titleLower.split(/\s+/).filter(w => w.length >= 4);
    if (titleWords.length === 0) return 0;
    const matchCount = titleWords.filter(w => contentLower.includes(w)).length;
    return matchCount / titleWords.length;
}

function computeEntityOverlap(contentA: string, contentB: string): number {
    const extractCapitalized = (text: string): Set<string> => {
        const plain = text.replace(/<[^>]+>/g, " ");
        const matches = plain.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || [];
        const stopWords = new Set(["The", "This", "That", "These", "Those", "When", "What", "How", "Why", "Where", "Which", "Who"]);
        return new Set(matches.filter(m => !stopWords.has(m)).map(m => m.toLowerCase()));
    };
    const setA = extractCapitalized(contentA);
    const setB = extractCapitalized(contentB);
    if (setA.size === 0 || setB.size === 0) return 0;
    let overlap = 0;
    for (const entity of setA) {
        if (setB.has(entity)) overlap++;
    }
    const union = new Set([...setA, ...setB]).size;
    return union > 0 ? overlap / union : 0;
}

function computeCombinedScore(signals: LinkSignal[]): number {
    let total = 0;
    let weightSum = 0;
    for (const signal of signals) {
        const weight = SIGNAL_WEIGHTS[signal.type] ?? 0;
        total += signal.score * weight;
        weightSum += weight;
    }
    return weightSum > 0 ? total / weightSum : 0;
}

function buildLinkReason(signals: LinkSignal[]): string {
    const meaningful = signals.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
    if (meaningful.length === 0) return "No meaningful similarity signals found";
    return meaningful.slice(0, 3).map(s => s.detail).join("; ");
}

export async function syncVectorInternalLinksForSite(
    siteId: string,
    newlyPublishedBlogId?: string
): Promise<VectorLinkOpportunity[]> {
    try {
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

        const limit = pLimit(5);
        const legacyCandidates = publishedBlogs.filter(
            b => b.id !== targetBlog.id && !b.content.includes(`/blog/${targetBlog.slug}`)
        );

        const candidatesWithScores = await Promise.all(
            legacyCandidates.map(legacyBlog =>
                limit(async () => {
                    const legacyText = `${legacyBlog.title} ${legacyBlog.targetKeywords.join(" ")} ${legacyBlog.content.slice(0, 1000)}`;
                    const embedding = await getCachedEmbedding(legacyText);
                    const vectorScore = embedding.length > 0 ? cosineSimilarity(targetEmbedding, embedding) : 0;

                    const signals: LinkSignal[] = [];

                    signals.push({
                        type: "vector_similarity",
                        score: vectorScore,
                        detail: `Cosine similarity: ${vectorScore.toFixed(3)}`,
                    });

                    const kwOverlap = computeKeywordOverlap(targetBlog.targetKeywords, legacyBlog.targetKeywords);
                    signals.push({
                        type: "keyword_overlap",
                        score: kwOverlap,
                        detail: `Keyword Jaccard index: ${kwOverlap.toFixed(3)}`,
                    });

                    const titleMention = checkTitleMention(targetBlog.title, legacyBlog.content);
                    signals.push({
                        type: "title_mention",
                        score: titleMention,
                        detail: titleMention >= 1 ? "Full title found in content" : `${Math.round(titleMention * 100)}% of title words found`,
                    });

                    const entityOverlap = computeEntityOverlap(targetBlog.content.slice(0, 3000), legacyBlog.content.slice(0, 3000));
                    signals.push({
                        type: "entity_overlap",
                        score: entityOverlap,
                        detail: `Entity overlap: ${entityOverlap.toFixed(3)}`,
                    });

                    const combinedScore = computeCombinedScore(signals);

                    return { legacyBlog, vectorScore, kwOverlap, combinedScore, signals };
                })
            )
        );

        const opportunities: VectorLinkOpportunity[] = [];

        for (const { legacyBlog, vectorScore, kwOverlap, combinedScore, signals } of candidatesWithScores) {
            if (combinedScore < LINK_THRESHOLDS.CANDIDATE) continue;

            const isAutoLink = combinedScore >= LINK_THRESHOLDS.AUTO_LINK;
            let updated = false;

            if (isAutoLink) {
                const { html: updatedHtml, linked } = injectSpecificInternalLink(
                    legacyBlog.content,
                    { slug: targetBlog.slug, title: targetBlog.title, targetKeywords: targetBlog.targetKeywords },
                    site?.domain
                );

                if (linked) {
                    await prisma.blog.update({
                        where: { id: legacyBlog.id },
                        data: { content: updatedHtml },
                    });
                    updated = true;
                }
            }

            opportunities.push({
                legacyBlogId: legacyBlog.id,
                legacySlug: legacyBlog.slug,
                newBlogId: targetBlog.id,
                newSlug: targetBlog.slug,
                similarityScore: Math.round(vectorScore * 100) / 100,
                keywordOverlapScore: Math.round(kwOverlap * 100) / 100,
                combinedScore: Math.round(combinedScore * 100) / 100,
                anchorText: targetBlog.title,
                reason: buildLinkReason(signals),
                updated,
                stage: isAutoLink ? "AUTO_LINK" : "CANDIDATE",
                signals,
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
        logger.error("[VectorLinker] Link matrix sync failed:", { error: formatError(error) });
        return [];
    }
}