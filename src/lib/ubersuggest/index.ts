import { logger } from "@/lib/logger";

import { redis, redisErrorCode } from "@/lib/redis";

export type MetricSource = "measured" | "estimated" | "unavailable"

export interface KeywordIdea {
    keyword: string
    searchVolume: number | null
    cpc: number | null
    difficulty: number | null
    intent: "informational" | "navigational" | "commercial" | "transactional"
    source: MetricSource
}

export interface ContentIdea {
    title: string
    url: string
    estimatedVisits: number | null
    backlinks: number | null
    socialShares: number | null
}

export interface DomainOverview {
    domain: string
    organicMonthlyTraffic: number | null
    organicKeywords: number | null
    performanceScore: number | null
    backlinks: number | null
}

// Map intent to our internal enum type safely
export function mapIntent(intentString?: string): KeywordIdea["intent"] {
    if (!intentString) return "informational"
    switch (intentString.toLowerCase()) {
        case "commercial": return "commercial"
        case "transactional": return "transactional"
        case "navigational": return "navigational"
        default: return "informational"
    }
}

// Estimate intent from keyword text heuristically
function estimateIntent(keyword: string): KeywordIdea["intent"] {
    const kw = keyword.toLowerCase()
    if (/^(buy|price|pricing|cheap|discount|coupon|deal|order|shop|purchase|cost)/.test(kw) ||
        /\b(buy|purchase|order|checkout)\b/.test(kw)) return "transactional"
    if (/\b(best|top|review|vs|versus|compare|alternative|alternatives)\b/.test(kw)) return "commercial"
    if (/^(how|what|why|when|where|who|is|are|can|does|do|should|will)\b/.test(kw) ||
        /\b(guide|tutorial|example|learn|tips|tricks|ideas)\b/.test(kw)) return "informational"
    return "informational"
}

// =============================================================================
// KEYWORD IDEAS — using Google Autocomplete (100% free, no key needed)
// =============================================================================

export const getKeywordIdeas = async (
    keyword: string,
    country = "us",
    language = "en",
    limit = 50
): Promise<KeywordIdea[]> => {

    // CACHE LAYER
    const cacheKey = `keywords:autocomplete:v2:${country}:${language}:${keyword.toLowerCase().replace(/\s+/g, '-')}`
    try {
        const cached = await redis.get(cacheKey)
        if (cached) return JSON.parse(cached as string)
     
     
    } catch (e: unknown) { logger.warn("Redis Get Error", { errorCode: redisErrorCode(e) }) }

    try {
        // Google Autocomplete — generates keyword suggestions for free
        const suggestions: KeywordIdea[] = []

        // Use multiple seed prefixes to get more variety
        const prefixes = ["", "how to ", "best ", "what is ", "why "]
        
        for (const prefix of prefixes) {
            const query = encodeURIComponent(`${prefix}${keyword}`)
            const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${query}&hl=${language}&gl=${country}`

            const res = await fetch(url, {
                headers: { "User-Agent": "Mozilla/5.0 (compatible; SEOBot/1.0)" }
            })

            if (!res.ok) continue

            const data = await res.json()
            const autoSuggestions: string[] = data[1] ?? []

            for (const suggestion of autoSuggestions) {
                if (suggestions.length >= limit) break
                if (!suggestions.find(s => s.keyword === suggestion)) {
                    suggestions.push({
                        keyword: suggestion,
                        searchVolume: null,
                        cpc: null,
                        difficulty: null,
                        intent: estimateIntent(suggestion),
                        source: "unavailable",
                    })
                }
            }

            if (suggestions.length >= limit) break
        }

        // Cache for 24 hours
        try {
             
            await redis.set(cacheKey, JSON.stringify(suggestions), { ex: 60 * 60 * 24 });
         
        } catch (e: unknown) { logger.warn("Redis Set Error", { errorCode: redisErrorCode(e) }) }

         
        return suggestions.slice(0, limit)

     
    } catch (err: unknown) {
        logger.warn("[Keywords] Google Autocomplete fetch failed:", { error: (err as Error)?.message || String(err) })
        return []
    }
}

// =============================================================================
// CONTENT IDEAS — uses Serper.dev if available, else mock
// =============================================================================

export const getContentIdeas = async (
    keyword: string,
    country = "us"
): Promise<ContentIdea[]> => {

    const cacheKey = `content:ideas:v2:${country}:${keyword.toLowerCase().replace(/\s+/g, '-')}`
     
    try {
        const cached = await redis.get(cacheKey)
        if (cached) return JSON.parse(cached as string)
     
    } catch (e: unknown) { logger.warn("Redis Get Error", { errorCode: redisErrorCode(e) }) }

    // Use Serper.dev for content ideas if key is available
    if (process.env.SERPER_API_KEY) {
        try {
            const res = await fetch("https://google.serper.dev/search", {
                method: "POST",
                headers: {
                    "X-API-KEY": process.env.SERPER_API_KEY,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ q: keyword, gl: country, num: 10 }),
             
            })

            if (res.ok) {
                const data = await res.json()
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const mapped: ContentIdea[] = (data.organic ?? []).map((item: any) => ({
                    title: item.title ?? "",
                    url: item.link ?? "",
                    estimatedVisits: null,
                    backlinks: null,
                    socialShares: null,
                }))

                try {
                     
                    await redis.set(cacheKey, JSON.stringify(mapped), { ex: 60 * 60 * 24 });
                 
                } catch (e: unknown) { logger.warn("Redis Set Error", { errorCode: redisErrorCode(e) }) }

                return mapped
            }
         
        } catch (err: unknown) {
            logger.warn("[ContentIdeas] Serper fetch failed:", { error: (err as Error)?.message || String(err) })
        }
    }

    return []
}

// =============================================================================
// DOMAIN OVERVIEW — uses free PageSpeed/GSC data, falls back to mock
// =============================================================================

export const getUbersuggestDomainOverview = async (
     
    domain: string
): Promise<DomainOverview | null> => {

    const cacheKey = `domain:overview:v2:${domain.toLowerCase()}`
    try {
        const cached = await redis.get(cacheKey)
        if (cached) return JSON.parse(cached as string)
     
    } catch (e: unknown) { logger.warn("Redis Get Error", { errorCode: redisErrorCode(e) }) }

    // Use Google PageSpeed Insights for some domain signals (free with API key)
    if (process.env.PAGESPEED_API_KEY) {
        try {
            const url = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://${domain}&key=${process.env.PAGESPEED_API_KEY}&strategy=mobile`
            const res = await fetch(url)
            if (res.ok) {
                const data = await res.json()
                const score = data.lighthouseResult?.categories?.performance?.score
                const overview: DomainOverview = {
                    domain,
                    organicMonthlyTraffic: null,
                    organicKeywords: null,
                    performanceScore: typeof score === "number" ? Math.round(score * 100) : null,
                    backlinks: null,
                }
                try {
                    await redis.set(cacheKey, JSON.stringify(overview), { ex: 60 * 60 * 48 });
                 
                } catch (e: unknown) { logger.warn("Redis Set Error", { errorCode: redisErrorCode(e) }) }
                return overview
            }
         
        } catch (err: unknown) {
            logger.warn("[DomainOverview] PageSpeed fetch failed:", { error: (err as Error)?.message || String(err) })
        }
    }

    return null
}
