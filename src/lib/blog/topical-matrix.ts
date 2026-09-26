import { prisma } from "@/lib/prisma";
import { clusterKey } from "@/lib/gsc";
import { fetchGscEvidence } from "@/lib/opportunity-engine/evidence";
import { logger, formatError } from "@/lib/logger";

export interface TopicSpokeNode {
    id: string;
    title: string;
    url: string;
    isPillar: boolean;
    position?: number;
    impressions?: number;
    clicks?: number;
    inboundClusterMentionCount: number;
    lastUpdated: Date;
}

export interface MissingSpokeGap {
    topicClusterKey: string;
    suggestedKeyword: string;
    suggestedTitle: string;
    hasGscEvidence: boolean;
    targetPillarUrl?: string;
}

export interface TopicMatrixEntry {
    parentTopic: string;
    childTopic: string;
    entities: string[];
    intent: string;
    questions: string[];
    existingUrls: string[];
    gscQueries: string[];
    competitorGaps: string[];
}

export interface TopicClusterTree {
    clusterKey: string;
    clusterName: string;
    pillarNode?: TopicSpokeNode;
    spokeNodes: TopicSpokeNode[];
    coverageScore: number;
    internalLinkScore: number;
    clusterAuthorityScore: number;
    missingSpokes: MissingSpokeGap[];
    matrixEntries: TopicMatrixEntry[];
}

export interface TopicalAuthorityReport {
    siteId: string;
    overallAuthorityScore: number;
    totalClustersCount: number;
    publishedPillarsCount: number;
    publishedSpokesCount: number;
    clusters: TopicClusterTree[];
    topRecommendedMissingSpoke?: MissingSpokeGap;
}

const ENTITY_STOPWORDS = new Set([
    "the", "this", "that", "these", "those", "when", "what", "how", "why",
    "where", "which", "who", "and", "but", "for", "with", "from", "your",
    "you", "our", "their", "its", "yes", "no", "a", "an", "is", "are",
    "was", "were", "will", "can", "does", "do", "did", "not",
]);

function extractEntitiesFromContent(content: string, targetKeywords: string[] = []): string[] {
    const plain = content.replace(/<[^>]+>/g, " ");
    const candidates = plain.match(/\b[A-Z][a-zA-Z0-9&'.-]*(?:\s+[A-Z][a-zA-Z0-9&'.-]*){0,3}\b/g) || [];
    const entities = new Map<string, string>();

    for (const kw of targetKeywords) {
        const trimmed = kw.trim();
        if (trimmed.length >= 3) entities.set(trimmed.toLowerCase(), trimmed);
    }

    for (const raw of candidates) {
        const trimmed = raw.trim();
        const key = trimmed.toLowerCase();
        if (trimmed.length < 3 || entities.has(key)) continue;
        const words = trimmed.split(/\s+/);
        if (words.length === 1 && ENTITY_STOPWORDS.has(words[0].toLowerCase())) continue;
        entities.set(key, trimmed);
    }

    return [...entities.values()].slice(0, 15);
}

function extractFaqQuestionsFromContent(content: string): string[] {
    return [...content.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)]
        .map(m => m[1].replace(/<[^>]+>/g, "").trim())
        .filter(q => q.endsWith("?"));
}

function extractQuestionsFromContent(content: string): string[] {
    const faqQuestions = extractFaqQuestionsFromContent(content);
    const plain = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const sentences = (plain.match(/[^.!?]+[.!?]*/g) || [])
        .map(s => s.trim())
        .filter(Boolean);
    const sentenceQuestions = sentences.filter(s =>
        s.endsWith("?") || /^(how|what|why|when|where|which|who|can|does|is|are|should)\s/i.test(s)
    );

    const seen = new Set<string>();
    const unique: string[] = [];
    for (const q of [...faqQuestions, ...sentenceQuestions]) {
        const key = q.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(q);
    }
    return unique.slice(0, 10);
}

function inferIntentFromKeywords(keywords: string[]): string {
    const joined = keywords.join(" ").toLowerCase();
    if (/buy|price|cost|discount|deal|cheap|order|purchase/.test(joined)) return "transactional";
    if (/best|top|review|compare|vs|alternative/.test(joined)) return "commercial";
    if (/how to|what is|guide|tutorial|learn|explain/.test(joined)) return "informational";
    if (/near me|in \w+|local|nearby/.test(joined)) return "local";
    return "informational";
}

function outrankedByCompetitors(node: { impressions?: number; position?: number }): boolean {
    return (node.impressions ?? 0) >= 10 && (node.position ?? 0) > 10;
}

export async function buildTopicalAuthorityMatrix(siteId: string): Promise<TopicalAuthorityReport> {
    try {
        const blogs = await prisma.blog.findMany({
            where: { siteId, status: "PUBLISHED" },
            select: { id: true, slug: true, title: true, content: true, targetKeywords: true, updatedAt: true }
        });

        const gscMetrics = await fetchGscEvidence(siteId);
        const gscMap = new Map<string, { impressions: number; clicks: number; position: number }>();
        const gscQueryMap = new Map<string, string[]>();
        for (const metric of gscMetrics) {
            const clean = metric.url.split("?")[0].replace(/\/$/, "");
            gscMap.set(clean, metric);
            if (metric.keyword) {
                const existing = gscQueryMap.get(clean) || [];
                if (!existing.includes(metric.keyword)) existing.push(metric.keyword);
                gscQueryMap.set(clean, existing);
            }
        }

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
                inboundClusterMentionCount: 0,
                lastUpdated: pillarBlog.updatedAt,
                ...gscMap.get(`/blog/${pillarBlog.slug}`)
            };

            const spokeNodes: TopicSpokeNode[] = [];
            for (const spoke of spokeBlogs) {
                const inboundCount = clusterBlogs.filter(b => b.id !== spoke.id && b.content.includes(spoke.slug)).length;
                spokeNodes.push({
                    id: spoke.id,
                    title: spoke.title,
                    url: `/blog/${spoke.slug}`,
                    isPillar: false,
                    inboundClusterMentionCount: inboundCount,
                    lastUpdated: spoke.updatedAt,
                    ...gscMap.get(`/blog/${spoke.slug}`)
                });
            }

            const coverageScore = Math.min(100, Math.round((spokeNodes.length / 4) * 100));

            const linkedSpokes = spokeNodes.filter(s => s.inboundClusterMentionCount > 0).length;
            const internalLinkScore = spokeNodes.length > 0 ? Math.round((linkedSpokes / spokeNodes.length) * 100) : 100;

            const clusterAuthorityScore = Math.round(coverageScore * 0.6 + internalLinkScore * 0.4);

            const missingSpokes: MissingSpokeGap[] = [];
            if (spokeNodes.length < 3) {
                const hasGscEvidence = gscMap.has(`/blog/${pillarBlog.slug}`) || spokeNodes.some(s => gscMap.has(s.url));
                missingSpokes.push({
                    topicClusterKey: cKey,
                    suggestedKeyword: `${cKey} guide`,
                    suggestedTitle: `Complete Guide to ${pillarBlog.title}`,
                    hasGscEvidence,
                    targetPillarUrl: pillarNode.url
                });
            }

            const allClusterKeywords = clusterBlogs.flatMap(b => b.targetKeywords);
            const clusterIntent = inferIntentFromKeywords(allClusterKeywords);
            const existingUrls = clusterBlogs.map(b => `/blog/${b.slug}`);

            const clusterGscQueries: string[] = [];
            for (const url of existingUrls) {
                const queries = gscQueryMap.get(url);
                if (queries) clusterGscQueries.push(...queries);
            }

            const outrankedNodes = [pillarNode, ...spokeNodes].filter(outrankedByCompetitors);

            const competitorGaps: string[] = [];
            if (spokeNodes.length < 3) {
                competitorGaps.push(`Missing subtopic coverage for "${cKey}"`);
            }
            const orphans = spokeNodes.filter(s => s.inboundClusterMentionCount === 0);
            if (orphans.length > 0) {
                competitorGaps.push(`${orphans.length} orphan spoke(s) without internal links`);
            }
            if (outrankedNodes.length > 0) {
                competitorGaps.push(
                    `${outrankedNodes.length} page(s) earning impressions but ranking beyond position 10 — competitors likely hold page 1`
                );
            }

            const matrixEntries: TopicMatrixEntry[] = spokeBlogs.map((spoke, idx) => {
                const spokeNode = spokeNodes[idx];
                const spokeGaps = spoke.targetKeywords.length < 2
                    ? [`Thin keyword coverage for "${spoke.title}"`]
                    : [];
                if (outrankedByCompetitors(spokeNode)) {
                    spokeGaps.push(`Ranking beyond position 10 despite ${spokeNode.impressions ?? 0} impressions`);
                }
                return {
                    parentTopic: pillarBlog.title,
                    childTopic: spoke.title,
                    entities: extractEntitiesFromContent(spoke.content, spoke.targetKeywords),
                    intent: inferIntentFromKeywords(spoke.targetKeywords),
                    questions: extractQuestionsFromContent(spoke.content),
                    existingUrls: [`/blog/${spoke.slug}`],
                    gscQueries: gscQueryMap.get(`/blog/${spoke.slug}`) || [],
                    competitorGaps: spokeGaps,
                };
            });

            if (pillarBlog) {
                matrixEntries.unshift({
                    parentTopic: cKey,
                    childTopic: pillarBlog.title,
                    entities: extractEntitiesFromContent(pillarBlog.content, allClusterKeywords),
                    intent: clusterIntent,
                    questions: extractQuestionsFromContent(pillarBlog.content),
                    existingUrls: [`/blog/${pillarBlog.slug}`],
                    gscQueries: clusterGscQueries,
                    competitorGaps,
                });
            }

            clusterTrees.push({
                clusterKey: cKey,
                clusterName: pillarBlog.title,
                pillarNode,
                spokeNodes,
                coverageScore,
                internalLinkScore,
                clusterAuthorityScore,
                missingSpokes,
                matrixEntries,
            });
        }

        const overallAuthorityScore = clusterTrees.length > 0
            ? Math.round(clusterTrees.reduce((sum, c) => sum + c.clusterAuthorityScore, 0) / clusterTrees.length)
            : 0;

        const allMissing = clusterTrees.flatMap(c => c.missingSpokes);
        allMissing.sort((a, b) => Number(b.hasGscEvidence) - Number(a.hasGscEvidence));

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
        logger.error("[TopicalMatrix] Failed to build topical authority matrix", { siteId, error: formatError(err) });
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