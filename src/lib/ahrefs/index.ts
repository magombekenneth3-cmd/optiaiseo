import { logger } from "@/lib/logger";

export interface AhrefsDomainOverview {
    domain: string
    domainRating: number
    organicTraffic: number
    backlinks: number
    referringDomains: number
    organicKeywords: number
}

export interface AhrefsKeyword {
    keyword: string
    position: number
    searchVolume: number
    traffic: number
    difficulty: number
    url: string
}

export interface AhrefsBacklink {
    sourceDomain: string
    sourceUrl: string
    targetUrl: string
    domainRating: number
    anchorText: string
    firstSeen: string
    lastSeen: string
}

// =============================================================================
// DOMAIN OVERVIEW — uses Moz free API if configured, else mock
// =============================================================================

export const getAhrefsDomainOverview = async (
    domain: string
): Promise<AhrefsDomainOverview> => {

    // ── Moz API — Domain Authority only ──────────────────────────────────────
    // Supports two auth methods:
    //   NEW  (post-March 2024): MOZ_API_TOKEN  → single token, header: x-moz-token
    //                           endpoint: https://api.moz.com/jsonrpc
    //   LEGACY (pre-March 2024): MOZ_ACCESS_ID + MOZ_SECRET_KEY → Basic Auth
    //                           endpoint: https://lsapi.seomoz.com/v2/url_metrics
    // Get your token at: https://moz.com/api/dashboard
    const mozToken = process.env.MOZ_API_TOKEN
    const mozAccessId = process.env.MOZ_ACCESS_ID
    const mozSecretKey = process.env.MOZ_SECRET_KEY

    if (mozToken || (mozAccessId && mozSecretKey)) {
        try {
            let da: number | null = null

            if (mozToken) {
                // ── New token-based API (JSON-RPC) ────────────────────────
                const res = await fetch("https://api.moz.com/jsonrpc", {
                    method: "POST",
                    headers: {
                        "x-moz-token": mozToken,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        id: `da-${domain}`,
                        method: "data.site.metrics.fetch.multiple",
                        params: {
                            data: {
                                site_queries: [{ query: domain, scope: "root_domain" }],
                                site_metrics: ["domain_authority"],
                            }
                        },
                    }),
                })
                if (res.ok) {
                    const data = await res.json()
                    da = data.result?.site_metrics?.[0]?.domain_authority ?? null
                }
            } else {
                // ── Legacy Basic Auth API (V2) ─────────────────────────────
                const auth = Buffer.from(`${mozAccessId}:${mozSecretKey}`).toString('base64')
                const res = await fetch("https://lsapi.seomoz.com/v2/url_metrics", {
                    method: "POST",
                    headers: {
                        Authorization: `Basic ${auth}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ targets: [domain] }),
                })
                if (res.ok) {
                    const data = await res.json()
                    da = data.results?.[0]?.domain_authority ?? null
                }
            }

            if (da !== null) {
                return {
                    domain,
                    domainRating: Math.round(da),
                    organicTraffic: 0,
                    backlinks: 0,
                    referringDomains: 0,
                    organicKeywords: 0,
                }
            }
         
         
        } catch (err: unknown) {
            logger.warn("[Ahrefs/Moz] Domain Authority fetch failed:", { error: (err as Error)?.message || String(err) })
        }
    }

    
    return {
        domain,
        domainRating: 0,
        organicTraffic: 0,
        backlinks: 0,
        referringDomains: 0,
        organicKeywords: 0,
    }
}

// =============================================================================
// TOP ORGANIC KEYWORDS — uses GSC data (handled in keywords engine)
// =============================================================================

export const getAhrefsTopKeywords = async (
    domain: string,
    limit = 50
): Promise<{ data: AhrefsKeyword[] | null; warning?: string }> => {
    // ── DataForSEO domain organic keywords (real data, no Ahrefs key needed) ──
    const login    = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;

    if (login && password) {
        try {
            const auth = Buffer.from(`${login}:${password}`).toString("base64");
            const res = await fetch(
                "https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live",
                {
                    method: "POST",
                    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
                    body: JSON.stringify([{
                        target:        domain,
                        location_code: 2840,   // US baseline; callers can extend if needed
                        language_code: "en",
                        limit:         Math.min(limit, 1000),
                        order_by:      ["keyword_data.keyword_info.search_volume,desc"],
                    }]),
                    signal: AbortSignal.timeout(20_000),
                }
            );

            if (res.ok) {
                const data = await res.json();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const items: any[] = data?.tasks?.[0]?.result?.[0]?.items ?? [];
                const keywords: AhrefsKeyword[] = items
                    .filter(i => i.keyword_data?.keyword_info?.search_volume > 0)
                    .slice(0, limit)
                    .map(i => ({
                        keyword:      i.keyword_data.keyword ?? "",
                        position:     i.ranked_serp_element?.serp_item?.rank_absolute ?? 0,
                        searchVolume: i.keyword_data.keyword_info?.search_volume      ?? 0,
                        traffic:      i.ranked_serp_element?.serp_item?.etv           ?? 0,
                        difficulty:   Math.round(i.keyword_data.keyword_properties?.keyword_difficulty ?? 0),
                        url:          i.ranked_serp_element?.serp_item?.url            ?? `https://${domain}`,
                    }));

                if (keywords.length > 0) {
                    return { data: keywords };
                }
            }
        } catch (err: unknown) {
            logger.warn("[Ahrefs/DataForSEO] ranked_keywords failed:", {
                error: (err as Error)?.message,
            });
        }
    }

    return {
        data: null,
        warning: "Keyword volume data unavailable. Set DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD in .env to enable real metrics.",
    };
};


// =============================================================================
// BACKLINKS — uses OpenLinkProfiler (FREE, no API key needed!)
// Docs: https://openlinkprofiler.org/api
// =============================================================================

export const getAhrefsBacklinks = async (
    domain: string,
    limit = 100
): Promise<AhrefsBacklink[]> => {
    try {
        const url = `https://openlinkprofiler.org/api/?url=${encodeURIComponent(domain)}&limit=${Math.min(limit, 200)}&format=json`
        const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; SEOBot/1.0)" },
            signal: AbortSignal.timeout(10000), 
        })

        if (!res.ok) {
            throw new Error(`OpenLinkProfiler error: ${res.status}`)
        }

        const data = await res.json()
        const links = data.links ?? []
  

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return links.map((item: any) => ({
            sourceDomain: item.source_domain ?? "",
            sourceUrl: item.source_url ?? "",
            targetUrl: item.target_url ?? `https://${domain}`,
            domainRating: item.citation_flow ?? 0,
            anchorText: item.anchor_text ?? "",
            firstSeen: item.date_found ?? new Date().toISOString(),
             
            lastSeen: item.date_last_checked ?? new Date().toISOString(),
        }))
     
    } catch (err: unknown) {
        logger.warn("[Ahrefs/OpenLinkProfiler] Backlinks fetch failed:", { error: (err as Error)?.message || String(err) })

        // Fallback mock
        return [
            {
                sourceDomain: "example.com",
                sourceUrl: "https://example.com/blog/post",
                targetUrl: `https://${domain}`,
                domainRating: 67,
                anchorText: "SEO tool",
                firstSeen: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
            },
        ]
    }
}

// =============================================================================
// COMPETING DOMAINS — uses Serper.dev if available, else mock
// =============================================================================

export const getAhrefsCompetitors = async (
    domain: string,
    limit = 10
): Promise<{ domain: string; commonKeywords: number; organicTraffic: number }[]> => {

    if (process.env.SERPER_API_KEY) {
        try {
            
            const searchQuery = domain.replace(/\.(com|io|net|org|co)$/, "").replace(/^www\./, "");

            
            const AGGREGATOR_DOMAINS = new Set([
                "g2.com", "capterra.com", "trustpilot.com", "yelp.com",
                "sitejabber.com", "getapp.com", "softwareadvice.com", "producthunt.com",
                "alternativeto.net", "trustradius.com", "glassdoor.com",
            ]);

            const res = await fetch("https://google.serper.dev/search", {
                method: "POST",
                headers: {
                    "X-API-KEY": process.env.SERPER_API_KEY,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ q: searchQuery, num: 20 }), // fetch 20, filter down
            })

            if (res.ok) {
                const data = await res.json()
                const results = data.organic ?? []
                const seen = new Set<string>([domain])
                const competitors = []

                for (const item of results) {
                    try {
                        const itemDomain = new URL(item.link).hostname.replace(/^www\./, "")
                        // Skip aggregators and the site itself
                        if (!seen.has(itemDomain) && !AGGREGATOR_DOMAINS.has(itemDomain)) {
                            seen.add(itemDomain)
                            competitors.push({
                                domain: itemDomain,
                                commonKeywords: 0,
                                organicTraffic: 0,
                            })
                        }
                    } catch { }
                    if (competitors.length >= limit) break
                }

                return competitors
            }
         
        } catch (err: unknown) {
            logger.warn("[Ahrefs/Competitors] Serper fetch failed:", { error: (err as Error)?.message || String(err) })
        }
    }

    // Fallback mock
    return [
        { domain: "competitor1.com", commonKeywords: 450, organicTraffic: 25000 },
        { domain: "competitor2.com", commonKeywords: 320, organicTraffic: 18000 },
    ]
}
