import { logger, formatError } from "@/lib/logger";
import { AI_MODELS } from "@/lib/constants/ai-models";
import { getKeywordMetricsBatch, resolveLocationCode } from "./dataforseo";
import { getKeywordIdeas } from "@/lib/ubersuggest";
import { getAhrefsTopKeywords } from "@/lib/ahrefs";

export interface EnrichedKeyword {
    keyword: string;
    gscPosition?: number;
    gscClicks?: number;
    gscImpressions?: number;
    gscCtr?: number;
    gscUrl?: string;
    searchVolume?: number;
    difficulty?: number;
    cpc?: number;
    intent?: string;
    ahrefsPosition?: number;
    ahrefsTraffic?: number;
    opportunityScore: number;
    recommendation: string;
    cluster?: string;
}

export interface KeywordCluster {
    topic: string;
    keywords: EnrichedKeyword[];
    totalVolume: number;
    avgDifficulty: number;
    opportunityScore: number;
    topicalAuthorityScore: number;
    projectedMonthlyRevenue: number;
}

const ESTIMATED_CTR = 0.15;
const ESTIMATED_CPC_FALLBACK = 5;

function computeTopicalAuthorityScore(keywords: EnrichedKeyword[]): number {
    const total = keywords.reduce((sum, k) => {
        const pos = k.gscPosition ?? 100;
        if (pos <= 10) return sum + 10;
        if (pos <= 20) return sum + 5;
        if (pos <= 50) return sum + 2;
        return sum;
    }, 0);
    return Math.round((total / (keywords.length || 1)) * 10);
}

function buildCluster(topic: string, keywords: EnrichedKeyword[]): KeywordCluster {
    // searchVolume is only populated after DataForSEO enrichment.  When it is
    // absent (GSC-only users, enrichment not configured, or quota exceeded) fall
    // back to gscImpressions so the Revenue Clusters panel shows real numbers
    // rather than "$0 / 0 search/mo" for every cluster.
    const volumeOf = (k: EnrichedKeyword) =>
        (k.searchVolume ?? 0) > 0 ? k.searchVolume! : (k.gscImpressions ?? 0);

    return {
        topic,
        keywords,
        totalVolume: keywords.reduce((sum, k) => sum + volumeOf(k), 0),
        avgDifficulty: keywords.reduce((sum, k) => sum + (k.difficulty ?? 50), 0) / (keywords.length || 1),
        opportunityScore: keywords.reduce((sum, k) => sum + k.opportunityScore, 0),
        topicalAuthorityScore: computeTopicalAuthorityScore(keywords),
        projectedMonthlyRevenue: keywords.reduce(
            (sum, k) => sum + volumeOf(k) * ESTIMATED_CTR * (k.cpc ?? ESTIMATED_CPC_FALLBACK),
            0
        ),
    };
}

export const getEnrichedKeywords = async (opts: {
    accessToken: string | null;
    domain: string;
    tier: string;
    seedKeyword?: string;
    localContext?: string | null;
}): Promise<EnrichedKeyword[]> => {
    const { accessToken, domain, tier, seedKeyword, localContext } = opts;
    const enriched = new Map<string, EnrichedKeyword>();
    const locationCode = resolveLocationCode(localContext);

    if (accessToken) {
        try {
            const { fetchGSCKeywords } = await import("@/lib/gsc");
            const gscKeywords = await fetchGSCKeywords(accessToken, `https://${domain}`);
            for (const kw of gscKeywords) {
                enriched.set(kw.keyword, {
                    keyword: kw.keyword,
                    gscPosition: kw.position,
                    gscClicks: kw.clicks,
                    gscImpressions: kw.impressions,
                    gscCtr: kw.ctr,
                    gscUrl: kw.url,
                    opportunityScore: 0,
                    recommendation: "",
                });
            }
        } catch (err: unknown) {
            logger.warn("[keywords] GSC fetch failed", { domain, error: formatError(err) });
        }
    }

    if (enriched.size > 0 && process.env.DATAFORSEO_LOGIN) {
        try {
            const allKeywords = [...enriched.keys()];
            const metrics = await getKeywordMetricsBatch(allKeywords, locationCode);
            for (const [kw, data] of metrics) {
                const existing = enriched.get(kw);
                if (!existing) continue;
                enriched.set(kw, {
                    ...existing,
                    searchVolume: data.searchVolume > 0 ? data.searchVolume : existing.searchVolume,
                    difficulty: data.difficulty > 0 ? data.difficulty : existing.difficulty,
                    cpc: data.cpc > 0 ? data.cpc : existing.cpc,
                });
            }
            logger.debug("[keywords] DataForSEO enrichment complete", {
                enriched: metrics.size,
                total: allKeywords.length,
            });
        } catch (err: unknown) {
            logger.warn("[keywords] DataForSEO batch enrichment failed", { domain, error: formatError(err) });
        }
    }

    if (["PRO", "AGENCY"].includes(tier) && seedKeyword) {
        try {
            const ideas = await getKeywordIdeas(seedKeyword);
            for (const idea of ideas) {
                const existing = enriched.get(idea.keyword);
                if (existing) {
                    if (!existing.searchVolume && idea.searchVolume > 0) {
                        enriched.set(idea.keyword, {
                            ...existing,
                            searchVolume: idea.searchVolume,
                            difficulty: idea.difficulty,
                            cpc: idea.cpc,
                            intent: existing.intent ?? idea.intent,
                        });
                    }
                } else {
                    enriched.set(idea.keyword, {
                        keyword: idea.keyword,
                        searchVolume: idea.searchVolume,
                        difficulty: idea.difficulty,
                        cpc: idea.cpc,
                        intent: idea.intent,
                        opportunityScore: 0,
                        recommendation: "",
                    });
                }
            }
        } catch (err: unknown) {
            logger.warn("[keywords] Ubersuggest fetch failed", { seedKeyword, error: formatError(err) });
        }
    }

    const result = [...enriched.values()].map((kw) => {
        const { score, recommendation } = computeOpportunityScore(kw);
        return { ...kw, opportunityScore: score, recommendation };
    });

    if (process.env.GEMINI_API_KEY && result.length > 0) {
        try {
            const enrichedWithIntent = await classifyIntentWithAI(result);
            return enrichedWithIntent
                .map((kw) => {
                    const { score, recommendation } = computeOpportunityScore(kw);
                    return { ...kw, opportunityScore: score, recommendation };
                })
                .sort((a, b) => b.opportunityScore - a.opportunityScore);
        } catch (err: unknown) {
            logger.warn("[keywords] AI intent classification failed", { error: formatError(err) });
        }
    }

    return result.sort((a, b) => b.opportunityScore - a.opportunityScore);
};

interface IntentMapping {
    keyword: string;
    intent: string;
}

interface IntentResponse {
    intents: IntentMapping[];
}

export const classifyIntentWithAI = async (
    keywords: EnrichedKeyword[]
): Promise<EnrichedKeyword[]> => {
    if (!process.env.GEMINI_API_KEY || keywords.length === 0) return keywords;

    try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const chunkSize = 50;
        const results = [...keywords];

        for (let i = 0; i < keywords.length; i += chunkSize) {
            const batch = keywords.slice(i, i + chunkSize);
            const keywordList = batch.map((k) => k.keyword).join(", ");

            const prompt = `
                Classify the search intent for each of the following keywords.
                Options: informational, commercial, transactional, navigational.

                Keywords: ${keywordList}

                Respond strictly in JSON format:
                {
                  "intents": [
                    { "keyword": "kw", "intent": "intent_type" }
                  ]
                }
            `;

            const response = await ai.models.generateContent({
                model: AI_MODELS.GEMINI_FLASH,
                contents: prompt,
                config: { responseMimeType: "application/json" },
            });

            const text = response.text;
            if (text) {
                const mapping: IntentResponse = JSON.parse(
                    text.replace(/```json|```/g, "").trim()
                );
                mapping.intents.forEach((item: IntentMapping) => {
                    const idx = results.findIndex((r) => r.keyword === item.keyword);
                    if (idx !== -1) results[idx].intent = item.intent;
                });
            }
        }

        return results;
    } catch (err: unknown) {
        logger.error("[keywords] AI intent classification failed", { error: formatError(err) });
        return keywords;
    }
};

interface ClusterMapping {
    topic: string;
    keywords: string[];
}

interface ClusterResponse {
    clusters: ClusterMapping[];
}

export const clusterKeywords = async (
    keywords: EnrichedKeyword[],
    siteId?: string
): Promise<KeywordCluster[]> => {
    if (keywords.length === 0) return [];

    if (!process.env.GEMINI_API_KEY) {
        const clusters = new Map<string, EnrichedKeyword[]>();
        keywords.forEach((kw) => {
            const firstWord = kw.keyword.split(" ")[0].toLowerCase();
            const existing = clusters.get(firstWord) ?? [];
            existing.push(kw);
            clusters.set(firstWord, existing);
        });
        return Array.from(clusters.entries()).map(([topic, kws]) =>
            buildCluster(topic.toUpperCase(), kws)
        );
    }

    let redisClient: import("@upstash/redis").Redis | null = null;
    let cacheKey: string | null = null;
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (upstashUrl?.startsWith("https://") && upstashToken) {
        try {
            const { Redis } = await import("@upstash/redis");
            redisClient = new Redis({ url: upstashUrl, token: upstashToken });
            const keywordHash = keywords.map((k) => k.keyword).sort().join(",");
            const { createHash } = await import("crypto");
            const hash8 = createHash("sha256").update(keywordHash).digest("hex").slice(0, 8);
            cacheKey = `cluster:${siteId ?? "global"}:${hash8}`;
            const cached = await redisClient.get<string>(cacheKey);
            if (cached) {
                logger.debug("[keywords] Cluster cache hit", { cacheKey });
                return typeof cached === "string" ? JSON.parse(cached) : cached;
            }
        } catch (err: unknown) {
            logger.warn("[keywords] Redis cache check failed, continuing without cache", {
                error: formatError(err),
            });
        }
    }

    try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        const keywordList = keywords.map((k) => k.keyword).join(", ");
        const prompt = `
            Group the following keywords into semantic clusters based on search intent and topic.
            Keywords: ${keywordList}

            Respond strictly in JSON format:
            {
              "clusters": [
                { "topic": "Short Descriptive Topic Name", "keywords": ["kw1", "kw2"] }
              ]
            }
        `;

        let responseText: string | null | undefined = null;

        try {
            const result = await ai.models.generateContent({
                model: AI_MODELS.GEMINI_FLASH,
                contents: prompt,
                config: { responseMimeType: "application/json" },
            });
            responseText = result.text;
        } catch (geminiErr: unknown) {
            const message = (geminiErr as Error)?.message ?? "";
            const is429 =
                (geminiErr as { status?: number })?.status === 429 ||
                message.includes("429") ||
                message.includes("RESOURCE_EXHAUSTED") ||
                message.includes("quota");

            if (is429) {
                logger.warn("[keywords] Gemini rate limited on clusterKeywords, returning ungrouped fallback", {});
                return [buildCluster("All Keywords", keywords)];
            }
            throw geminiErr;
        }

        if (!responseText) return [];

        const mapping: ClusterResponse = JSON.parse(
            responseText.replace(/```json|```/g, "").trim()
        );

        const clusters: KeywordCluster[] = mapping.clusters.map((c: ClusterMapping) => {
            const clusterKws = keywords.filter((k) => c.keywords.includes(k.keyword));
            return buildCluster(c.topic, clusterKws);
        });

        const sorted = clusters.sort((a, b) => b.opportunityScore - a.opportunityScore);

        if (redisClient && cacheKey) {
            try {
                await redisClient.set(cacheKey, JSON.stringify(sorted), { ex: 3600 });
                logger.debug("[keywords] Cluster result cached", { cacheKey, ttl: 3600 });
            } catch (err: unknown) {
                logger.warn("[keywords] Failed to write cluster cache", { error: formatError(err) });
            }
        }

        return sorted;
    } catch (err: unknown) {
        logger.error("[keywords] Clustering failed", { error: formatError(err) });
        return [];
    }
};

export function computeOpportunityScore(
    kw: Partial<EnrichedKeyword>
): { score: number; recommendation: string } {
    let score = 0;
    let recommendation = "";

    const pos = kw.gscPosition ?? kw.ahrefsPosition ?? 100;
    const volume = kw.searchVolume ?? kw.gscImpressions ?? 0;
    const diff = kw.difficulty ?? 50;

    if (pos > 10 && pos <= 20 && volume > 100) {
        score = Math.round((volume / pos) * 2);
        recommendation = `Ranking #${pos} — just off page 1. A content refresh could push this into top 10.`;
    } else if (pos > 20 && volume > 200) {
        score = Math.round(volume / pos);
        recommendation = `Ranking #${pos} with ${volume} searches/mo. A dedicated page could capture this traffic.`;
    } else if (pos <= 10 && kw.gscCtr && kw.gscCtr < 3 && (kw.gscImpressions ?? 0) > 100) {
        score = Math.round((kw.gscImpressions ?? 0) * 0.5);
        recommendation = `Good position but low CTR (${kw.gscCtr}%). Improve your title and meta description.`;
    } else if (volume > 500 && diff < 40) {
        score = Math.round(volume * (1 - diff / 100));
        recommendation = `High volume (${volume}/mo), low difficulty (${diff}/100) — great keyword to target.`;
    } else {
        score = Math.max(1, Math.round(volume / (diff + 10)));
        recommendation = `Standard keyword with volume ${volume} and difficulty ${diff}. Maintain optimization.`;
    }

    if (score > 0 && kw.intent) {
        if (kw.intent === "transactional") {
            score = Math.round(score * 1.5);
            recommendation += " High-value transactional keyword — prioritize conversion.";
        } else if (kw.intent === "commercial") {
            score = Math.round(score * 1.2);
            recommendation += " Strong commercial intent — great for review or comparison pages.";
        } else if (kw.intent === "informational") {
            recommendation += " Informational intent — best suited for comprehensive guides.";
        }
    }

    return { score, recommendation };
}