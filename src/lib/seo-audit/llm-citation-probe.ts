/**
 * llm-citation-probe.ts — Phase 2.1
 *
 * Asks Gemini whether it would cite a given page as a primary source when
 * answering the implied question in that page's H1.
 *
 * Results are cached in Redis for 48 hours keyed on `llm-probe:<url-hash>`.
 * This prevents re-billing on every re-audit of the same URL.
 */

import { callGemini } from "@/lib/gemini/client";
import { logger } from "@/lib/logger";
import { createHash } from "crypto";

// ─── Redis cache ─────────────────────────────────────────────────────────────
// Lazy import to avoid breaking non-Redis environments (e.g. free tier local dev)
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

const PROBE_TTL_S = 48 * 3600; // 48 hours

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CitationProbeResult {
    /** 1–5 (5 = highly citable by AI search engines) */
    score: number;
    wouldCite: boolean;
    missingSignals: string[];
    reasoning: string;
    cachedAt: string;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Probes whether Gemini would cite the given page in an AI search answer.
 *
 * @param url             Canonical page URL (used as cache key)
 * @param title           Page <title> or H1
 * @param description     Meta description or first sentence
 * @param bodySnippet     First 400 words of visible body text
 * @param schemaSummary   Detected schema types (e.g. "Article, FAQPage")
 */
export async function probeLlmCitation(
    url: string,
    title: string,
    description: string,
    bodySnippet: string,
    schemaSummary: string,
): Promise<CitationProbeResult> {
    const cacheKey = `llm-probe:${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;

    // ── Cache read ────────────────────────────────────────────────────────
    const r = await getRedis();
    if (r) {
        try {
            const cached = await r.get(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached) as CitationProbeResult;
                logger.debug(`[LLM Probe] cache hit for ${url}`);
                return parsed;
            }
        } catch { /* non-fatal */ }
    }

    // ── Prompt ────────────────────────────────────────────────────────────
    const prompt = `You are simulating how an AI search engine evaluates content for citation.

Given the following webpage content, answer: would you cite this page as a primary source when a user asks "${title}?"

Page details:
- URL: ${url}
- Title: ${title}
- Meta description: ${description || "(none)"}
- Schema markup types: ${schemaSummary || "(none detected)"}
- Opening body text (first 400 words):
${bodySnippet.slice(0, 1600)}

Evaluate the page on these AI-citation signals:
1. Direct, factual answer in the first paragraph
2. Named authorship and publication date
3. Authoritative schema markup (Article, FAQPage, HowTo, etc.)
4. Outbound links to credible sources
5. Structured headings that match user queries
6. Content depth and uniqueness

Return ONLY valid JSON with this exact shape:
{
  "score": <integer 1-5>,
  "wouldCite": <boolean>,
  "missingSignals": [<up to 2 most important missing signals as short strings>],
  "reasoning": "<1-2 sentence explanation>"
}

Score guide: 5=strong citation candidate, 4=likely, 3=possible, 2=unlikely, 1=would not cite.`;

    try {
        const text = await callGemini(prompt, { maxOutputTokens: 512, temperature: 0.1, timeoutMs: 20_000 });
        if (!text) return fallback(url);

        const clean = text.replace(/^```(?:json)?\s*/im, "").replace(/```\s*$/im, "").trim();
        const parsed = JSON.parse(clean) as Partial<CitationProbeResult>;

        const result: CitationProbeResult = {
            score:          Math.max(1, Math.min(5, Number(parsed.score) || 1)),
            wouldCite:      Boolean(parsed.wouldCite),
            missingSignals: Array.isArray(parsed.missingSignals) ? parsed.missingSignals.slice(0, 2) : [],
            reasoning:      String(parsed.reasoning ?? ""),
            cachedAt:       new Date().toISOString(),
        };

        // ── Cache write ───────────────────────────────────────────────────
        if (r) {
            try { await r.setex(cacheKey, PROBE_TTL_S, JSON.stringify(result)); } catch { /* non-fatal */ }
        }

        logger.debug(`[LLM Probe] ${url} → score=${result.score} wouldCite=${result.wouldCite}`);
        return result;

    } catch (err) {
        logger.error("[LLM Probe] failed", { url, error: (err as Error)?.message });
        return fallback(url);
    }
}

function fallback(url: string): CitationProbeResult {
    return {
        score: 0,
        wouldCite: false,
        missingSignals: [],
        reasoning: "Citation probe could not complete (API unavailable).",
        cachedAt: new Date().toISOString(),
    };
}
