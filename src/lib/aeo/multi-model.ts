import { logger } from "@/lib/logger";
import { GoogleGenAI } from "@google/genai";
import { checkChatGptMention } from "./openai-check";
import { checkClaudeMention } from "./claude-check";
import { checkGrokMention } from "./check-grok";
import { checkCopilotMention } from "./check-copilot";
import { AI_MODELS } from "@/lib/constants/ai-models";
import { checkPerplexityCitation } from "./perplexity-citation-check";
import { cachedMentionCheck } from "./response-cache";
import { semanticMentionCheck, semanticPerplexityCheck } from "./vector-response-cache";
import { redis } from "@/lib/redis";
import { TTL } from "@/lib/constants/ttl";
import {
    extractBrandIdentity,
    isBrandCited,
    brandProminenceScore,
    classifyMentionConfidence,
    type BrandIdentity,
} from "@/lib/aeo/brand-utils";
import { prisma } from "@/lib/prisma";

export interface MentionResult {
    model: string;
    mentioned: boolean;
    confidence: number;
    snippet?: string;
    details?: string;
    error?: string;
    /**
     * Gap 2: true when the brand prominence score is in the 10–40 borderline range.
     * The regex may have matched a co-mention or partial token rather than a clean
     * citation. Surface these rows in the tracker UI for human review.
     */
    lowConfidence?: boolean;
    quality?: {
        positionScore: number;
        isAuthoritative: boolean;
        mentionCount: number;
        context: string | null;
    };
    citation?: {
        cited: boolean;
        citationPosition: number | null;
        citationUrl: string | null;
        competitorsCited: string[];
        citationCount: number;
    };
}

function analyzeCitationQuality(content: string, domainOrIdentity: string | BrandIdentity) {
    const identity =
        typeof domainOrIdentity === "string"
            ? extractBrandIdentity(domainOrIdentity)
            : domainOrIdentity;

    const lower = content.toLowerCase();

    const positionScore = brandProminenceScore(content, identity);

    const authorityPhrases = [
        "according to", "recommended by", "as stated by",
        "leading", "top-rated", "best", "trusted",
    ];
    const isAuthoritative = authorityPhrases.some((p) => lower.includes(p));

    let mentionCount = 0;
    for (const variant of identity.variants) {
        const re = new RegExp(`\\b${variant.replace(/\s+/g, "[\\s\\-]*")}\\b`, "gi");
        mentionCount += (content.match(re) ?? []).length;
    }

    let context: string | null = null;
    const firstMatch = identity.citationRegex.exec(content);
    if (firstMatch) {
        context = content.substring(
            Math.max(0, firstMatch.index - 50),
            Math.min(content.length, firstMatch.index + firstMatch[0].length + 100),
        );
    }

    return { positionScore, isAuthoritative, mentionCount, context };
}

export { analyzeCitationQuality };

export async function checkGeminiMention(
    domain: string,
    coreServices?: string | null,
    brandNameOverride?: string | null,
): Promise<MentionResult> {
    if (!process.env.GEMINI_API_KEY) {
        return { model: "Gemini", mentioned: false, confidence: 0, details: "Gemini API key missing" };
    }

    const cacheKey = `Gemini:${domain}:${coreServices ?? ""}`;
    return semanticMentionCheck(cacheKey, async () => {
    return cachedMentionCheck("Gemini", domain, coreServices, async (_d, _svcs) => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
        const identity = extractBrandIdentity(domain, brandNameOverride);

        const prompt = `
            Act as an AI Search Engine. I will give you a brand name and website.
            Tell me if you have knowledge of this brand and what it does.

            Brand Name: ${identity.displayName}
            Website: ${identity.domain}
            Also known as: ${identity.variants.join(", ")}
            Core Services: ${coreServices || "N/A"}

            Respond in strict JSON:
            {
                "mentioned": boolean,
                "confidence": number,
                "description": "What you know about this brand. Be specific. If unknown, say exactly: UNKNOWN_BRAND",
                "isAuthoritative": boolean
            }
        `;

        // Use Google Search grounding so the check reflects real user behaviour
        // on gemini.google.com, which browses the live web — not frozen training data.
        const result = await ai.models.generateContent({
            model: AI_MODELS.GEMINI_PRO,
            contents: prompt,
            config: {
                temperature: 0.1,
                tools: [{ googleSearch: {} }],
                // Note: responseMimeType cannot be used with googleSearch grounding;
                // JSON is parsed from the text response instead.
            },
        });

        const text = result.text?.trim() || "{}";
        const cleanJson = text
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();
        const data = JSON.parse(cleanJson);

        const rawMentioned: boolean = data.mentioned ?? false;
        const description: string = data.description ?? "No data provided";

        const descriptionConfirms = !/(unknown_brand|no information|not aware|cannot find|no data)/i.test(
            description,
        );
        const descriptionCitesBrand = isBrandCited(description, identity);

        const mentioned = rawMentioned && descriptionConfirms && descriptionCitesBrand;
        const quality = mentioned ? analyzeCitationQuality(description, identity) : undefined;

        const prominenceScore = quality?.positionScore ?? 0;
        const confidenceTier  = classifyMentionConfidence(prominenceScore);
        const lowConfidence   = confidenceTier === "low_confidence";

        // Gap 2: fire-and-forget LOW_CONFIDENCE_MENTION event so the dashboard
        // can surface borderline detections for human review without blocking.
        if (lowConfidence && domain) {
            prisma.site.findFirst({ where: { domain }, select: { id: true } })
                .then(site => {
                    if (!site) return;
                    return prisma.aeoEvent.create({
                        data: {
                            siteId: site.id,
                            eventType: "LOW_CONFIDENCE_MENTION",
                            metadata: {
                                model: "Gemini",
                                keyword: coreServices ?? domain,
                                prominenceScore,
                                snippet: description.slice(0, 300),
                            },
                        },
                    });
                })
                .catch(() => { /* non-fatal */ });
        }

        return {
            model: "Gemini",
            mentioned,
            confidence: mentioned ? (quality?.positionScore || data.confidence || 0) : 0,
            details: description,
            quality,
            lowConfidence,
        };
    } catch (error: unknown) {
        logger.error("[Multi-Model] Gemini mention check failed:", {
            error: (error as Error)?.message || String(error),
        });
        return {
            model: "Gemini",
            mentioned: false,
            confidence: 0,
            details: "Check failed due to parsing error or timeout.",
        };
    }
    });
    });
}

export async function checkPerplexityMention(
    domain: string,
    coreServices?: string | null,
    brandNameOverride?: string | null,
): Promise<MentionResult> {
    if (!process.env.PERPLEXITY_API_KEY) {
        return { model: "Perplexity", mentioned: false, confidence: 0, details: "Perplexity API key missing" };
    }

    const query = coreServices
        ? `Best ${coreServices} — top recommendations`
        : `What are the top tools and resources for ${domain.split(".")[0]}?`;

    return semanticPerplexityCheck(query, async () => {
    try {
        const result = await checkPerplexityCitation(query, domain);
        const identity = extractBrandIdentity(domain, brandNameOverride);

        const quality = analyzeCitationQuality(result.responseText, identity);
        const citationPositionScore = result.citationPosition
            ? Math.max(10, 100 - (result.citationPosition - 1) * 15)
            : 0;
        const confidence = result.cited
            ? Math.round((citationPositionScore + result.textMentionScore) / 2)
            : 0;

        return {
            model: "Perplexity",
            mentioned: result.cited || result.textMentionScore > 20,
            confidence,
            snippet: result.responseText.substring(0, 200) + (result.responseText.length > 200 ? "..." : ""),
            details: result.cited
                ? `Cited at position #${result.citationPosition} — URL: ${result.citationUrl}. Competitors also cited: ${result.competitorsCited.slice(0, 3).join(", ") || "none"}`
                : result.textMentionScore > 20
                    ? `Mentioned in response text but NOT in Perplexity's source Citations. Competitors cited: ${result.competitorsCited.slice(0, 3).join(", ") || "none"}`
                    : `Not cited. Perplexity retrieved: ${result.competitorsCited.slice(0, 3).join(", ") || "no competitors identified"}`,
            quality,
            citation: {
                cited: result.cited,
                citationPosition: result.citationPosition,
                citationUrl: result.citationUrl,
                competitorsCited: result.competitorsCited,
                citationCount: result.citations.length,
            },
        };
    } catch (error: unknown) {
        logger.error("[Multi-Model] Perplexity citation check failed:", {
            error: (error as Error)?.message || String(error),
        });
        return { model: "Perplexity", mentioned: false, confidence: 0, details: "Check failed" };
    }
    });
}

export async function auditMultiModelMentions(domain: string, coreServices?: string | null, brandNameOverride?: string | null) {
    const multiCacheKey = `aeo:multi:${domain}:${coreServices ?? ""}`;

    const cached = await redis.get(multiCacheKey).catch(() => null);
    if (cached) {
        const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
        logger.debug("[MultiModel] Full results from cache", { domain });
        return parsed as { results: MentionResult[]; overallScore: number };
    }

    const [geminiSettled, perplexitySettled, chatgptSettled, claudeSettled, grokSettled, copilotSettled] =
        await Promise.allSettled([
            cachedMentionCheck("Gemini",     domain, coreServices, (d, s) => checkGeminiMention(d, s, brandNameOverride)),
            cachedMentionCheck("Perplexity", domain, coreServices, (d, s) => checkPerplexityMention(d, s, brandNameOverride)),
            cachedMentionCheck("ChatGPT",    domain, coreServices, checkChatGptMention),
            cachedMentionCheck("Claude",     domain, coreServices, checkClaudeMention),
            cachedMentionCheck("Grok",       domain, coreServices, checkGrokMention),
            cachedMentionCheck("Copilot",    domain, coreServices, checkCopilotMention),
        ]);

    const toResult = (settled: PromiseSettledResult<MentionResult>, engineName: string): MentionResult =>
        settled.status === "fulfilled"
            ? settled.value
            : {
                model: engineName,
                mentioned: false,
                confidence: 0,
                error: (settled.reason as Error)?.message ?? "Unknown error",
              } as MentionResult;

    const results: MentionResult[] = [
        toResult(geminiSettled, "Gemini"),
        toResult(perplexitySettled, "Perplexity"),
        toResult(chatgptSettled, "ChatGPT"),
        toResult(claudeSettled, "Claude"),
        toResult(grokSettled, "Grok"),
        toResult(copilotSettled, "Copilot"),
    ];

    const cacheHits = [geminiSettled, perplexitySettled, chatgptSettled, claudeSettled, grokSettled, copilotSettled]
        .filter((s) => s.status === "fulfilled" && (s.value as MentionResult & { fromCache?: boolean }).fromCache)
        .length;
    logger.debug("[MultiModel] Cache", { domain, cacheHits, liveCalls: 6 - cacheHits });

    const score = results.reduce((acc, curr) => acc + (curr.mentioned ? curr.confidence : 0), 0) / results.length;
    const output = { results, overallScore: Math.round(score) };

    await redis.set(multiCacheKey, JSON.stringify(output), { ex: TTL.MULTI_MODEL_S }).catch(() => undefined);

    return output;
}