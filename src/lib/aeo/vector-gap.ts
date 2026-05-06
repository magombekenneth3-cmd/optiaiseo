import { logger } from "@/lib/logger";
import { getEmbedding, cosineSimilarity } from "./embeddings";
import { callGemini } from "@/lib/gemini";
import { getSerpData, DATAFORSEO_LOCATION_CODES } from "@/lib/keywords/dataforseo";

export interface SemanticGapResult {
    keyword: string;
    userScore: number;
    competitorAvgScore: number;
    missingConcepts: string[];
    serpFeatures?: { hasAnswerBox: boolean; hasLocalPack: boolean; hasShopping: boolean };
    /**
     * Gap 1: Set when no SERP data source is configured and the analysis cannot
     * produce meaningful signals. Surface this in the dashboard instead of
     * silently returning garbage concept gaps.
     */
    setupWarning?: string;
}

// ── SERP source types ─────────────────────────────────────────────────────────

type SerpSource = "dataforseo" | "serper" | "perplexity" | "none";

interface SerpResult {
    urls: string[];
    hasAnswerBox: boolean;
    hasLocalPack: boolean;
    hasShopping: boolean;
    source: SerpSource;
}

// ── Perplexity sonar-pro fallback ─────────────────────────────────────────────
//
// Perplexity sonar-pro returns `citations[]` — URLs of pages it consulted for
// the answer. These are real, topically relevant pages for the query, far
// better than generic Wikipedia/Investopedia/HubSpot hardcodes.
// Uses the PERPLEXITY_API_KEY already required by the citation-check pipeline.

async function perplexityFallbackUrls(keyword: string): Promise<string[]> {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) return [];

    try {
        const res = await fetch("https://api.perplexity.ai/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "sonar-pro",
                messages: [
                    {
                        role: "user",
                        content: `What are the best resources and pages about: "${keyword}"? Summarise briefly.`,
                    },
                ],
                max_tokens: 200,
                // sonar-pro returns citations when return_citations is true
                return_citations: true,
            }),
            signal: AbortSignal.timeout(12000),
        });

        if (!res.ok) {
            logger.warn("[Vector Gap] Perplexity fallback HTTP error", { status: res.status });
            return [];
        }

        const data = await res.json() as { citations?: string[]; choices?: unknown[] };
        const urls = (data.citations ?? []).slice(0, 3) as string[];
        logger.debug("[Vector Gap] Perplexity fallback yielded URLs", { keyword, count: urls.length });
        return urls;
    } catch (e: unknown) {
        logger.warn("[Vector Gap] Perplexity fallback failed", { error: (e as Error)?.message });
        return [];
    }
}

/**
 * Fetches top-N organic URLs for a keyword.
 *
 * Source priority:
 *   1. DataForSEO (real SERP + feature flags)
 *   2. Serper.dev (real SERP, basic feature flags)
 *   3. Perplexity sonar-pro citations (topically relevant, no feature flags)
 *   4. source:"none" — all providers unconfigured/failed
 *
 * Returns a `source` field so callers can detect the "none" case and surface
 * a setup warning rather than silently producing misleading signals.
 */
async function getTopSerpUrls(
    keyword: string,
    locationCode = DATAFORSEO_LOCATION_CODES.us,
): Promise<SerpResult> {
    // ── 1. DataForSEO primary ─────────────────────────────────────────────────
    if (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD) {
        try {
            const { urls, features } = await getSerpData(keyword, locationCode, 3);
            if (urls.length > 0) {
                return { urls, ...features, source: "dataforseo" };
            }
        } catch (e: unknown) {
            logger.error("[Vector Gap] DataForSEO SERP fetch failed:", { error: (e as Error)?.message });
        }
    }

    // ── 2. Serper.dev fallback ────────────────────────────────────────────────
    if (process.env.SERPER_API_KEY) {
        try {
            const res = await fetch("https://google.serper.dev/search", {
                method: "POST",
                headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
                body: JSON.stringify({ q: keyword, num: 3 }),
                signal: AbortSignal.timeout(10000),
            });
            if (res.ok) {
                const data = await res.json();
                const urls: string[] = (data.organic ?? []).slice(0, 3).map((i: { link: string }) => i.link);
                if (urls.length > 0) {
                    return {
                        urls,
                        hasAnswerBox: !!data.answerBox,
                        hasLocalPack: Array.isArray(data.localResults) && data.localResults.length > 0,
                        hasShopping: Array.isArray(data.shopping) && data.shopping.length > 0,
                        source: "serper",
                    };
                }
            }
        } catch (e: unknown) {
            logger.error("[Vector Gap] Serper fallback failed:", { error: (e as Error)?.message });
        }
    }

    // ── 3. Perplexity sonar-pro citation fallback ─────────────────────────────
    const perplexityUrls = await perplexityFallbackUrls(keyword);
    if (perplexityUrls.length > 0) {
        logger.info(`[Vector Gap] Using Perplexity citation fallback for "${keyword}"`, {
            count: perplexityUrls.length,
        });
        return {
            urls: perplexityUrls,
            hasAnswerBox: false,
            hasLocalPack: false,
            hasShopping: false,
            source: "perplexity",
        };
    }

    // ── 4. All providers absent or failed ────────────────────────────────────
    logger.warn(`[Vector Gap] No SERP source available for "${keyword}" — returning source:none`, {
        setupWarning: true,
    });
    return {
        urls: [],
        hasAnswerBox: false,
        hasLocalPack: false,
        hasShopping: false,
        source: "none",
    };
}


/**
 * Extracts raw textual content from a URL (simplified HTML parsing).
 */
async function scrapeUrlText(url: string): Promise<string> {
    try {
        const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; SEOBot/1.0)" },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return "";
        const html = await res.text();


        const paraMatches = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gi)];
        const text = paraMatches
            .map(m => m[1].replace(/<[^>]+>/g, "").trim())
            .filter(p => p.length > 50)
            .slice(0, 15)
            .join(" ");

        return text;
    } catch {
        return "";
    }
}

/**
 * Performs Semantic Vector Gap Analysis.
 * 1. Fetches top 3 SERP competitors for a keyword via DataForSEO → Serper → Perplexity.
 * 2. Extracts their content and asks Gemini to identify core "Semantic Concepts".
 * 3. Embeds those specific concepts into vectors.
 * 4. Checks how close the user's content vector is to each concept vector.
 * 5. Returns concepts that the user is missing (distance below threshold).
 *
 * When no SERP source is configured, returns a `setupWarning` field instead of
 * garbage signals. The caller should surface this as a dashboard banner.
 */
export async function performVectorGapAnalysis(
    userContent: string,
    targetKeyword: string
): Promise<SemanticGapResult> {

    logger.debug(`[Vector Gap] Analyzing gaps for keyword: "${targetKeyword}"`);
    const serpResult = await getTopSerpUrls(targetKeyword);

    // Gap 1: all providers absent — abort with a descriptive warning rather than
    // running the analysis on empty competitor content and returning useless signals.
    if (serpResult.source === "none") {
        const warning =
            "Vector gap analysis requires at least one SERP data source. " +
            "Configure DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD, SERPER_API_KEY, " +
            "or PERPLEXITY_API_KEY to enable this feature.";
        logger.warn("[Vector Gap] Aborting — no SERP source configured", { keyword: targetKeyword });
        return {
            keyword: targetKeyword,
            userScore: 0,
            competitorAvgScore: 0,
            missingConcepts: [],
            setupWarning: warning,
        };
    }

    let combinedCompetitorText = "";
    for (const url of serpResult.urls) {
        const text = await scrapeUrlText(url);
        combinedCompetitorText += "\n" + text;
    }

    if (!process.env.GEMINI_API_KEY) {
        return { keyword: targetKeyword, userScore: 0, competitorAvgScore: 0, missingConcepts: ["Semantic API disabled"] };
    }

    let coreConcepts: string[] = [];
    try {
        const prompt = `You are a Semantic SEO extractor. 
Analyze the following compiled text from top-ranking pages for the keyword "${targetKeyword}".
Identify the top 5 most critical semantic concepts, entities, or sub-topics that are universally discussed in these pages.

Compiled Competitor Text:
${combinedCompetitorText.substring(0, 8000)}

Return ONLY a valid JSON array of strings representing the 5 core concepts. No markdown, no explanations.
Example: ["Concept A", "Concept B", "Concept C", "Concept D", "Concept E"]`;

        let responseText = null;
        try {
            responseText = await callGemini(prompt, { maxOutputTokens: 2048, temperature: 0.1 });
        } catch { }

        if (!responseText) throw new Error("Gemini returned null");

        const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        coreConcepts = JSON.parse(cleanJson);
        if (!Array.isArray(coreConcepts)) coreConcepts = ["Comprehensive Definition", "Use Cases"];

    } catch (e: unknown) {
        logger.error("[Vector Gap] Failed to extract concepts:", { error: (e as Error)?.message || String(e) });
        coreConcepts = ["Key definition", "Best practices", "Examples"];
    }

    const missingConcepts: string[] = [];
    const userEmbedding = await getEmbedding(userContent);

    let totalScore = 0;

    for (const concept of coreConcepts) {
        const conceptEmbedding = await getEmbedding(concept);
        const sim = cosineSimilarity(userEmbedding, conceptEmbedding);

        totalScore += sim;

        // If similarity is below 0.65, the user content likely doesn't adequately cover this concept
        if (sim < 0.65) {
            missingConcepts.push(concept);
        }
    }

    return {
        keyword: targetKeyword,
        userScore: Math.round((totalScore / coreConcepts.length) * 100),
        competitorAvgScore: 85, // Mapped standard expectation
        missingConcepts,
        serpFeatures: {
            hasAnswerBox: serpResult.hasAnswerBox,
            hasLocalPack: serpResult.hasLocalPack,
            hasShopping: serpResult.hasShopping,
        },
    };
}
