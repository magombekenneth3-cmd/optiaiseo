import { callGeminiJson } from "@/lib/gemini/client";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

// Cache each reasoning for 7 days — it's expensive and slow-changing
const CACHE_TTL_S = 60 * 60 * 24 * 7;

export interface AiReasoningResult {
  competitorDomain: string;
  clientDomain: string;
  keyword: string;
  /** Gemini's plain-English reasoning for why the competitor is preferred */
  reasoning: string;
  /**
   * Structured factors Gemini identified — max 4.
   * Each has a label ("Has FAQ Schema") and a gap description
   * ("Your page has no FAQ section").
   */
  factors: Array<{
    factor: string;
    competitorAdvantage: string;
    clientGap: string;
    fixHint: string;
  }>;
  /** Confidence 0-100 that this is the real explanation */
  confidence: number;
  generatedAt: string;
}

function cacheKey(siteId: string, competitorDomain: string, keyword: string): string {
  const slug = keyword.toLowerCase().replace(/\s+/g, "-").slice(0, 80);
  return `ai-reasoning:${siteId}:${competitorDomain}:${slug}`;
}

/**
 * Ask Gemini: "Why does AI prefer this competitor for this keyword?"
 *
 * Uses only keyword text + domain names — no live page fetches.
 * This is the fast, cached path. The citation-gap live analysis already
 * fetches competitor pages; this is for the dashboard on-demand call.
 *
 * @param siteId           - For cache namespacing
 * @param clientDomain     - The client's domain
 * @param competitorDomain - The competitor being cited
 * @param keyword          - The keyword where the gap exists
 * @param competitorProfile - Optional structured profile from comp-profile Redis key
 */
export async function getAiReasoningForGap(
  siteId: string,
  clientDomain: string,
  competitorDomain: string,
  keyword: string,
  competitorProfile?: {
    hasFaqSection?: boolean;
    hasDefinitionParagraph?: boolean;
    hasOriginalStats?: boolean;
    hasComparisonContent?: boolean;
    schemaTypes?: string[];
    strengths?: string[];
  } | null,
): Promise<AiReasoningResult | null> {
  if (!process.env.GEMINI_API_KEY) return null;

  const key = cacheKey(siteId, competitorDomain, keyword);

  try {
    const cached = await redis.get<AiReasoningResult>(key);
    if (cached) return cached;
  } catch {
    // Redis unavailable — proceed to Gemini
  }

  // Build optional structured context from existing comp-profile data
  const profileContext = competitorProfile
    ? `
Known facts about the competitor's page:
- Has FAQ section: ${competitorProfile.hasFaqSection ?? "unknown"}
- Has definition paragraph: ${competitorProfile.hasDefinitionParagraph ?? "unknown"}
- Has original statistics: ${competitorProfile.hasOriginalStats ?? "unknown"}
- Has comparison content: ${competitorProfile.hasComparisonContent ?? "unknown"}
- Schema types: ${competitorProfile.schemaTypes?.join(", ") || "none detected"}
- Top strengths: ${competitorProfile.strengths?.join("; ") || "none detected"}`
    : "";

  const prompt = `You are an AEO (Answer Engine Optimization) expert acting as a strategic advisor.

A client's website (${clientDomain}) is NOT being cited by AI engines (Perplexity, ChatGPT, Gemini) for the keyword: "${keyword}"

Their competitor (${competitorDomain}) IS being cited for this keyword.${profileContext}

Your task: Explain clearly and specifically why AI engines prefer the competitor. Focus on content structure, schema, authority, and entity signals — not vague generalities.

Respond ONLY in this exact JSON format:
{
  "reasoning": "<2-3 sentence plain-English explanation a non-technical client can understand>",
  "factors": [
    {
      "factor": "<short label, e.g. FAQ Schema>",
      "competitorAdvantage": "<what the competitor has that drives citation>",
      "clientGap": "<what the client is likely missing>",
      "fixHint": "<one concrete step to close this gap>"
    }
  ],
  "confidence": <integer 0-100>
}

Rules:
- factors array: minimum 2, maximum 4 items
- Each fixHint must be actionable in under 1 week
- Do not mention things you cannot know from the keyword alone unless profileContext is provided
- confidence reflects how certain you are given the available information`;

  try {
    const parsed = await callGeminiJson<{
      reasoning: string;
      factors: AiReasoningResult["factors"];
      confidence: number;
    }>(prompt, {
      model: "gemini-2.0-flash",
      temperature: 0.2,
      maxOutputTokens: 600,
    });

    const result: AiReasoningResult = {
      competitorDomain,
      clientDomain,
      keyword,
      reasoning: parsed.reasoning ?? "Unable to determine reasoning.",
      factors: (parsed.factors ?? []).slice(0, 4),
      confidence: parsed.confidence ?? 50,
      generatedAt: new Date().toISOString(),
    };

    try {
      await redis.set(key, result, { ex: CACHE_TTL_S });
    } catch {
      // Non-fatal
    }

    return result;
  } catch (err) {
    logger.warn("[AiReasoning] Gemini call failed", {
      keyword,
      competitorDomain,
      error: (err as Error)?.message,
    });
    return null;
  }
}
