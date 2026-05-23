import { prisma } from "@/lib/prisma";

export interface AIAuthorityScoreResult {
    score: number;
    gemini: number;
    openai: number;
    anthropic: number;
    perplexity: number;
    capturedAt: Date | null;
}

export interface AASTrendPoint {
    date: string;
    score: number;
    gemini: number;
    openai: number;
    anthropic: number;
    perplexity: number;
}

/**
 * Calculates the latest proprietary AI Authority Score (AAS) for a given site.
 * Formula: (Gemini * 35%) + (OpenAI * 35%) + (Anthropic * 20%) + (Perplexity * 10%)
 */
export async function calculateLatestAAS(siteId: string): Promise<AIAuthorityScoreResult> {
    const latest = await prisma.aeoSnapshot.findFirst({
        where: { siteId },
        orderBy: { createdAt: "desc" },
    });

    if (!latest) {
        return {
            score: 0,
            gemini: 0,
            openai: 0,
            anthropic: 0,
            perplexity: 0,
            capturedAt: null,
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pb = (latest.platformBreakdown ?? {}) as Record<string, any>;
    const geminiScore = latest.googleAioScore || pb["Gemini"]?.confidence || 0;
    const openaiScore = latest.chatgptScore || 0;
    const anthropicScore = latest.claudeScore || 0;
    const perplexityScore = pb["Perplexity"]?.confidence || pb["perplexity"]?.score || 0;

    const weightedScore = Math.round(
        (geminiScore * 0.35) + (openaiScore * 0.35) + (anthropicScore * 0.2) + (perplexityScore * 0.1)
    );

    return {
        score: weightedScore,
        gemini: geminiScore,
        openai: openaiScore,
        anthropic: anthropicScore,
        perplexity: perplexityScore,
        capturedAt: latest.createdAt,
    };
}

/**
 * Retrieves the trend of the AI Authority Score over a period of days.
 */
export async function getAASTrend(siteId: string, days = 30): Promise<AASTrendPoint[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const snapshots = await prisma.aeoSnapshot.findMany({
        where: { siteId, createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
        select: {
            createdAt: true,
            googleAioScore: true,
            chatgptScore: true,
            claudeScore: true,
            platformBreakdown: true,
        },
    });

    return snapshots.map(s => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pb = (s.platformBreakdown ?? {}) as Record<string, any>;
        const geminiScore = s.googleAioScore || pb["Gemini"]?.confidence || 0;
        const openaiScore = s.chatgptScore || 0;
        const anthropicScore = s.claudeScore || 0;
        const perplexityScore = pb["Perplexity"]?.confidence || pb["perplexity"]?.score || 0;

        const weightedScore = Math.round(
            (geminiScore * 0.35) + (openaiScore * 0.35) + (anthropicScore * 0.2) + (perplexityScore * 0.1)
        );

        return {
            date: s.createdAt.toISOString().slice(0, 10),
            score: weightedScore,
            gemini: geminiScore,
            openai: openaiScore,
            anthropic: anthropicScore,
            perplexity: perplexityScore,
        };
    });
}
