import { logger } from "@/lib/logger";
import { createHash } from "crypto";
import { geminiAdapter } from "@/lib/gsov/llm-adapters";
import { sanitizeBodyForLlm } from "@/lib/gsov/sanitizer";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GROUNDED_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-1.5-flash";
const PROBE_TTL_S = 48 * 3600;

let redis: import("ioredis").Redis | null = null;
async function getRedis() {
    if (redis) return redis;
    if (!process.env.REDIS_URL) return null;
    try {
        const { default: Redis } = await import("ioredis");
        redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
        return redis;
    } catch {
        return null;
    }
}

export interface CitationProbeResult {
    score: number;
    wouldCite: boolean;
    missingSignals: string[];
    wouldCiteIf: string;
    engineDifference: string;
    reasoning: string;
    cachedAt: string;
    groundingUsed: boolean;
    perplexityScore?: number;
    chatGptScore?: number;
    geminiScore?: number;
    groundingSources?: string[];
}

interface GeminiGroundingCandidate {
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
        searchEntryPoint?: { renderedContent?: string };
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
        webSearchQueries?: string[];
    };
}

interface GeminiGroundingResponse {
    candidates?: GeminiGroundingCandidate[];
}

function buildPrompt(url: string, title: string, description: string, bodySnippet: string, schemaSummary: string): string {
    return `You are an AI search quality evaluator assessing whether a webpage would be cited by AI search engines.

Evaluate this page as it appears in live web search results RIGHT NOW:
- URL: ${url}
- Title: ${title}
- Meta description: ${description || "(none)"}
- Schema markup types: ${schemaSummary || "(none detected)"}
- Opening body text (first 400 words):
${bodySnippet.slice(0, 1600)}

Score this page on 6 AI-citation signals:
1. Direct, factual answer in the first paragraph (does it answer the implied question immediately?)
2. Named authorship and publication/modification date
3. Authoritative schema markup (Article, FAQPage, HowTo, Speakable, QAPage, etc.)
4. Outbound links to credible sources (gov, edu, peer-reviewed journals, major publications)
5. Structured headings that match real user queries (question-format H2/H3)
6. Content depth, uniqueness, and freshness vs. competing pages currently ranking for this topic

Also evaluate how each AI engine would treat this page differently:
- Gemini Search (Google): prefers E-E-A-T signals, schema, fresh content
- Perplexity AI: prefers direct factual answers, structured data, citable sources
- ChatGPT Search: prefers comprehensive coverage, clear authorship, reputable domains

Return ONLY valid JSON with this exact shape:
{
  "score": <integer 1-5>,
  "wouldCite": <boolean>,
  "geminiScore": <integer 1-5>,
  "perplexityScore": <integer 1-5>,
  "chatGptScore": <integer 1-5>,
  "missingSignals": [<up to 4 strings, each: "WHAT is missing | HOW to fix it in one sentence">],
  "wouldCiteIf": "<one specific, concrete change that would flip wouldCite to true>",
  "engineDifference": "<explain any material difference between how Gemini, Perplexity, and ChatGPT Search would treat this page; if no difference write 'No significant difference'>",
  "reasoning": "<2-3 sentence explanation based on live web search results>"
}

Score guide: 5=strong citation candidate, 4=likely, 3=possible, 2=unlikely, 1=would not cite.`;
}

async function callGroundedGemini(
    apiKey: string,
    prompt: string,
    model: string,
    useGrounding: boolean,
): Promise<{ text: string; sources: string[] } | null> {
    const body: Record<string, unknown> = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 768, temperature: 0.1 },
    };

    if (useGrounding) {
        body.tools = [{ googleSearch: {} }];
    }

    try {
        const res = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
        });

        if (!res.ok) return null;
        const data = await res.json() as GeminiGroundingResponse;
        const candidate = data.candidates?.[0];
        const text = candidate?.content?.parts?.map(p => p.text ?? "").join("") ?? "";
        if (!text) return null;

        const sources: string[] = (candidate?.groundingMetadata?.groundingChunks ?? [])
            .map(c => c.web?.uri ?? "")
            .filter(Boolean)
            .slice(0, 5);

        return { text, sources };
    } catch {
        return null;
    }
}

function parseProbeJson(text: string): Partial<CitationProbeResult> | null {
    try {
        const clean = text
            .replace(/^```(?:json)?\s*/im, "")
            .replace(/```\s*$/im, "")
            .trim();
        return JSON.parse(clean) as Partial<CitationProbeResult>;
    } catch {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;
        try { return JSON.parse(jsonMatch[0]) as Partial<CitationProbeResult>; } catch { return null; }
    }
}

export async function probeLlmCitation(
    url: string,
    title: string,
    description: string,
    bodySnippet: string,
    schemaSummary: string,
): Promise<CitationProbeResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return fallback(url);

    const cacheKey = `llm-probe:v2:${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
    const r = await getRedis();
    if (r) {
        try {
            const cached = await r.get(cacheKey);
            if (cached) {
                logger.debug(`[LLM Probe] cache hit for ${url}`);
                return JSON.parse(cached) as CitationProbeResult;
            }
        } catch { }
    }

    const prompt = buildPrompt(url, title, description, bodySnippet, schemaSummary);

    let groundingUsed = false;
    let sources: string[] = [];
    let rawText: string | null = null;

    const groundedResult = await callGroundedGemini(apiKey, prompt, GROUNDED_MODEL, true);
    if (groundedResult?.text) {
        rawText = groundedResult.text;
        sources = groundedResult.sources;
        groundingUsed = true;
        logger.debug(`[LLM Probe] grounded response for ${url}, sources=${sources.length}`);
    }

    if (!rawText) {
        const fallbackResult = await callGroundedGemini(apiKey, prompt, GROUNDED_MODEL, false);
        rawText = fallbackResult?.text ?? null;
    }

    if (!rawText) {
        const legacyResult = await callGroundedGemini(apiKey, prompt, FALLBACK_MODEL, false);
        rawText = legacyResult?.text ?? null;
    }

    if (!rawText) return fallback(url);

    const parsed = parseProbeJson(rawText);
    if (!parsed) return fallback(url);

    const clampScore = (v: unknown): number => Math.max(1, Math.min(5, Number(v) || 1));

    const result: CitationProbeResult = {
        score:            clampScore(parsed.score),
        wouldCite:        Boolean(parsed.wouldCite),
        missingSignals:   Array.isArray(parsed.missingSignals) ? (parsed.missingSignals as string[]).slice(0, 4) : [],
        wouldCiteIf:      String(parsed.wouldCiteIf ?? ""),
        engineDifference: String(parsed.engineDifference ?? ""),
        reasoning:        String(parsed.reasoning ?? ""),
        cachedAt:         new Date().toISOString(),
        groundingUsed,
        groundingSources: sources,
        ...(parsed.geminiScore != null     ? { geminiScore:     clampScore(parsed.geminiScore) }     : {}),
        ...(parsed.perplexityScore != null ? { perplexityScore: clampScore(parsed.perplexityScore) } : {}),
        ...(parsed.chatGptScore != null    ? { chatGptScore:    clampScore(parsed.chatGptScore) }    : {}),
    };

    if (r) {
        try { await r.setex(cacheKey, PROBE_TTL_S, JSON.stringify(result)); } catch { }
    }

    logger.debug(`[LLM Probe] ${url} score=${result.score} wouldCite=${result.wouldCite} grounded=${groundingUsed}`);
    return result;
}

function fallback(url: string): CitationProbeResult {
    return {
        score: 0,
        wouldCite: false,
        missingSignals: [],
        wouldCiteIf: "",
        engineDifference: "",
        reasoning: "Citation probe could not complete (API unavailable).",
        cachedAt: new Date().toISOString(),
        groundingUsed: false,
    };
}
