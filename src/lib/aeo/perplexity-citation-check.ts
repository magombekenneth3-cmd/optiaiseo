/**
 * Perplexity Citation Check
 * ─────────────────────────────────────────────────────────────────────────────
 * Uses Perplexity sonar-pro with return_citations:true to check whether a
 * domain is actually CITED (URL in the sources list) for a given query,
 * rather than merely mentioned in the response text.
 *
 * This is the correct way to measure AEO citation presence in 2026 — it tells
 * you EXACTLY which competitor URLs Perplexity retrieved instead of yours.
 */

import { logger } from "@/lib/logger";
import { cachedPerplexityCheck } from "./response-cache";
import { extractBrandIdentity, brandProminenceScore } from "@/lib/aeo/brand-utils";

export interface PerplexityCitationResult {
    /** Whether the domain appears in any of Perplexity's retrieved citations */
    cited: boolean;
    /** 1-indexed position in the citations list (null if not cited) */
    citationPosition: number | null;
    /** The exact URL that was cited (null if not cited) */
    citationUrl: string | null;
    /** Competitor domains that were cited instead */
    competitorsCited: string[];
    /** Full Perplexity response text */
    responseText: string;
    /** All retrieved citations */
    citations: Array<{ url: string; title?: string }>;
    /** Quality signal: how early in the text the brand appears (0-100) */
    textMentionScore: number;
}

/**
 * Checks whether a domain is cited by Perplexity sonar-pro for a given query.
 *
 * @param query - The search query to check (e.g. "best SEO tools in Uganda")
 * @param domain - The domain to look for (e.g. "example.com")
 */
async function _checkPerplexityCitation(
    query: string,
    domain: string
): Promise<PerplexityCitationResult> {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
        logger.warn("[PerplexityCitation] PERPLEXITY_API_KEY not set — returning uncited");
        return buildEmptyResult("API key missing");
    }

    try {
        const res = await fetch("https://api.perplexity.ai/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "sonar-pro",
                messages: [{ role: "user", content: query }],
                return_citations: true,
                return_related_questions: false,
                temperature: 0.1,
                max_tokens: 1024,
            }),
            signal: AbortSignal.timeout(25000),
        });

        if (!res.ok) {
            const errBody = await res.text().catch(() => res.statusText);
            logger.warn(`[PerplexityCitation] API error ${res.status}: ${errBody}`);
            return buildEmptyResult(`API error ${res.status}`);
        }

        const data = await res.json();
        const responseText: string = data.choices?.[0]?.message?.content ?? "";

        // sonar-pro returns citations as an array of objects { url, title? }
        // Fall back to string array format (sonar/sonar-small legacy shape)
        const rawCitations: unknown[] = data.citations ?? [];
        const citations: Array<{ url: string; title?: string }> = rawCitations.map((c) => {
            if (typeof c === "string") return { url: c };
            const obj = c as Record<string, unknown>;
            return { url: String(obj.url ?? ""), title: obj.title ? String(obj.title) : undefined };
        });

        // Normalise the domain for comparison (strip www, trailing slash)
        const normalisedDomain = domain.toLowerCase().replace(/^www\./, "").replace(/\/$/, "");

        // Check which citation index matches our domain
        const citationIndex = citations.findIndex((c) => {
            try {
                const urlHost = new URL(c.url).hostname.replace(/^www\./, "").toLowerCase();
                const titleMatch = c.title?.toLowerCase().includes(normalisedDomain.split(".")[0]);
                return urlHost.includes(normalisedDomain) || urlHost === normalisedDomain || !!titleMatch;
            } catch {
                return c.url.toLowerCase().includes(normalisedDomain);
            }
        });

        // Build competitor list (all cited domains except ours)
        const competitorsCited = citations
            .filter((_, i) => i !== citationIndex)
            .map((c) => {
                try { return new URL(c.url).hostname.replace(/^www\./, "").toLowerCase(); }
                catch { return ""; }
            })
            .filter((h): h is string => Boolean(h) && h !== normalisedDomain);

        const brandIdentity = extractBrandIdentity(normalisedDomain);
        const textMentionScore = brandProminenceScore(responseText, brandIdentity);

        const cited = citationIndex !== -1;

        logger.debug("[PerplexityCitation] Result", {
            query,
            domain,
            cited,
            citationPosition: cited ? citationIndex + 1 : null,
            citationCount: citations.length,
            competitorCount: competitorsCited.length,
        });

        return {
            cited,
            citationPosition: cited ? citationIndex + 1 : null,
            citationUrl: cited ? citations[citationIndex].url : null,
            competitorsCited: [...new Set(competitorsCited)],
            responseText,
            citations,
            textMentionScore,
        };
    } catch (err: unknown) {
        logger.error("[PerplexityCitation] Request failed", {
            error: (err as Error)?.message ?? String(err),
        });
        return buildEmptyResult((err as Error)?.message ?? "Unknown error");
    }
}

/**
 * Check citation across multiple seed keywords and aggregate results.
 * Returns a summary suitable for store in AiShareOfVoice.
 */
export async function checkCitationForKeywords(
    domain: string,
    keywords: string[],
    coreServices?: string | null
): Promise<{
    citedCount: number;
    totalChecked: number;
    citationRate: number;
    topCompetitors: string[];
    results: Array<PerplexityCitationResult & { keyword: string }>;
}> {
    // Build natural queries from keywords
    const queries = keywords.slice(0, 10).map((kw) =>
        coreServices
            ? `Best ${coreServices} for ${kw}`
            : `What are the top resources for ${kw}?`
    );

    const results = await Promise.all(
        queries.map(async (query, i) => {
            const res = await checkPerplexityCitation(query, domain);
            return { ...res, keyword: keywords[i] };
        })
    );

    const citedCount = results.filter((r) => r.cited).length;

    // Aggregate competitor mentions across all queries
    const competitorMap: Record<string, number> = {};
    for (const r of results) {
        for (const comp of r.competitorsCited) {
            competitorMap[comp] = (competitorMap[comp] ?? 0) + 1;
        }
    }
    const topCompetitors = Object.entries(competitorMap)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([domain]) => domain);

    return {
        citedCount,
        totalChecked: results.length,
        citationRate: results.length > 0 ? Math.round((citedCount / results.length) * 100) : 0,
        topCompetitors,
        results,
    };
}


function buildEmptyResult(reason: string): PerplexityCitationResult {
    return {
        cited: false,
        citationPosition: null,
        citationUrl: null,
        competitorsCited: [],
        responseText: reason,
        citations: [],
        textMentionScore: 0,
    };
}

export async function checkPerplexityCitation(
    query: string,
    domain: string
): Promise<PerplexityCitationResult> {
    return cachedPerplexityCheck(query, domain, _checkPerplexityCitation);
}
