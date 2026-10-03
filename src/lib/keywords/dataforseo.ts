import { logger, formatError } from "@/lib/logger";

/**
 * Metrics sourced from DataForSEO Google Ads Search Volume endpoint.
 * NOTE: competition / competitionIndex are PAID-SEARCH metrics.
 * keywordDifficulty is the organic ranking difficulty from DataForSEO Labs.
 */
export interface KeywordMetrics {
    keyword: string;
    /** Monthly search volume from Google Ads */
    searchVolume: number;
    /** Organic SEO keyword difficulty (0-100). Null when Labs endpoint not called. Source: DataForSEO Labs keyword_difficulty */
    keywordDifficulty: number | null;
    /** Paid search competition score (0-1). Source: Google Ads competition */
    competition: number;
    /** Paid search competition index (0-100). Source: Google Ads competition_index */
    competitionIndex: number;
    /** Cost per click in USD. Source: Google Ads */
    cpc: number;
    /** Monthly search volume trend (last 12 months) */
    trend: number[];
}

export interface SerpOrganicResult {
    url: string;
    domain: string;
    rank: number;
    title: string;
    /** Approximate referring domains from DataForSEO SERP item (may be absent) */
    backlinks?: number;
}

export interface SerpFeatureData {
    hasAnswerBox: boolean;
    hasLocalPack: boolean;
    hasShopping: boolean;
    items: Array<{ type: string; url?: string }>;
    /** Parsed organic results enriched for feasibility scoring */
    organicResults: SerpOrganicResult[];
    /** All SERP feature type strings present (for feasibility score deductions) */
    featureTypes: string[];
}

export const DATAFORSEO_LOCATION_CODES: Record<string, number> = {
    us: 2840,
    gb: 2826,
    au: 2036,
    ca: 2124,
    in: 2356,
    sg: 2702,
    de: 2276,
    fr: 2250,
    nl: 2528,
    ph: 2608,
    ug: 1011984,
    ke: 1010046,
    ng: 2566,
    gh: 2288,
    za: 2710,
    tz: 1010467,
    rw: 1006886,
    et: 2231,
    sn: 2686,
};

export function resolveLocationCode(text: string | null | undefined): number {
    if (!text) return DATAFORSEO_LOCATION_CODES.us;
    const lower = text.toLowerCase();
    const nameToCode: Record<string, number> = {
        "uganda": 1011984, "kenya": 1010046, "nigeria": 2566,
        "ghana": 2288, "south africa": 2710, "tanzania": 1010467,
        "rwanda": 1006886, "ethiopia": 2231, "senegal": 2686,
        "united states": 2840, "usa": 2840,
        "united kingdom": 2826, "uk": 2826,
        "australia": 2036, "canada": 2124, "india": 2356,
        "singapore": 2702, "germany": 2276, "france": 2250,
        "netherlands": 2528, "philippines": 2608,
    };
    for (const [name, code] of Object.entries(nameToCode)) {
        if (lower.includes(name)) return code;
    }
    for (const [code, loc] of Object.entries(DATAFORSEO_LOCATION_CODES)) {
        if (lower.includes(code)) return loc;
    }
    return DATAFORSEO_LOCATION_CODES.us;
}

function getAuthHeader(): string | null {
    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;
    if (!login || !password) return null;
    return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

class CircuitBreaker {
    private failures = 0;
    private lastFailure = 0;
    private openUntil = 0;

    constructor(
        private readonly threshold: number,
        private readonly windowMs: number,
        private readonly cooldownMs: number,
        private readonly name: string,
    ) {}

    isOpen(): boolean {
        if (Date.now() < this.openUntil) return true;
        if (this.openUntil > 0 && Date.now() >= this.openUntil) {
            this.reset();
        }
        return false;
    }

    recordFailure(): void {
        const now = Date.now();
        if (now - this.lastFailure > this.windowMs) this.failures = 0;
        this.failures++;
        this.lastFailure = now;
        if (this.failures >= this.threshold) {
            this.openUntil = now + this.cooldownMs;
            logger.warn(`[${this.name}] Circuit OPEN — ${this.failures} failures in ${this.windowMs}ms window, cooling down ${this.cooldownMs}ms`);
        }
    }

    recordSuccess(): void {
        this.failures = Math.max(0, this.failures - 1);
    }

    private reset(): void {
        this.failures = 0;
        this.openUntil = 0;
        logger.info(`[${this.name}] Circuit CLOSED — resuming normal operation`);
    }
}

const dataForSeoBreaker = new CircuitBreaker(5, 60_000, 30_000, "dataforseo");

async function fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number
): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchDataForSeo(
    url: string,
    options: RequestInit,
    timeoutMs: number,
): Promise<Response | null> {
    if (dataForSeoBreaker.isOpen()) {
        logger.warn("[dataforseo] Circuit open — returning degraded response");
        return null;
    }
    try {
        const res = await fetchWithTimeout(url, options, timeoutMs);
        if (res.ok) {
            dataForSeoBreaker.recordSuccess();
        } else if (res.status >= 500 || res.status === 429) {
            dataForSeoBreaker.recordFailure();
        }
        return res;
    } catch (err: unknown) {
        dataForSeoBreaker.recordFailure();
        throw err;
    }
}


export async function getKeywordMetricsBatch(
    keywords: string[],
    locationCode = DATAFORSEO_LOCATION_CODES.us,
): Promise<Map<string, KeywordMetrics>> {
    const auth = getAuthHeader();
    if (!auth) {
        logger.warn("[dataforseo] Credentials not set, skipping batch metrics", {});
        return new Map();
    }

    const results = new Map<string, KeywordMetrics>();
    const chunks = chunkArray(keywords, 1000);

    for (const chunk of chunks) {
        try {
            const res = await fetchDataForSeo(
                "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live",
                {
                    method: "POST",
                    headers: { Authorization: auth, "Content-Type": "application/json" },
                    body: JSON.stringify([{
                        keywords: chunk,
                        location_code: locationCode,
                        language_code: "en",
                    }]),
                },
                30_000
            );

            if (!res || !res.ok) {
                if (res) logger.warn("[dataforseo] search_volume response not ok", { status: res.status });
                continue;
            }

            const data = await res.json();
            const items: Array<{
                keyword: string;
                search_volume: number;
                competition: number;
                competition_index: number;
                cpc: number;
                monthly_searches: Array<{ year?: number; month?: number; search_volume: number }> | null;
            }> = data?.tasks?.[0]?.result ?? [];

            for (const item of items) {
                const kw = item.keyword?.toLowerCase().trim();
                if (!kw) continue;
                results.set(kw, {
                    keyword: kw,
                    searchVolume: item.search_volume ?? 0,
                    // keywordDifficulty is intentionally null here — it comes from the Labs endpoint.
                    // competition_index is PAID-SEARCH competition, NOT organic SEO difficulty.
                    keywordDifficulty: null,
                    cpc: parseFloat(String(item.cpc ?? 0)),
                    competition: item.competition ?? 0,
                    competitionIndex: Math.round(item.competition_index ?? 0),
                    // Newest month first — trend direction logic depends on this order.
                    trend: [...(item.monthly_searches ?? [])]
                        .sort((a, b) => ((b.year ?? 0) * 12 + (b.month ?? 0)) - ((a.year ?? 0) * 12 + (a.month ?? 0)))
                        .map((m) => m.search_volume ?? 0)
                        .slice(0, 12),
                });
            }
        } catch (err: unknown) {
            logger.error("[dataforseo] getKeywordMetricsBatch chunk failed", { error: formatError(err) });
        }
    }

    return results;
}

/**
 * Fetches organic keyword_difficulty from DataForSEO Labs.
 * This is the actual SEO ranking difficulty (0-100, logarithmic) based on the
 * link profiles of the top-10 organic results — NOT the Google Ads competition_index.
 *
 * DataForSEO docs: dataforseo_labs/google/bulk_keyword_difficulty/live
 * Response shape: tasks[0].result[0].items[] = { keyword, keyword_difficulty }
 */
export async function getKeywordDifficultyBatch(
    keywords: string[],
    locationCode = DATAFORSEO_LOCATION_CODES.us,
): Promise<Map<string, number>> {
    const auth = getAuthHeader();
    const results = new Map<string, number>();
    if (!auth) return results;

    const chunks = chunkArray(keywords, 1000);

    for (const chunk of chunks) {
        try {
            const res = await fetchDataForSeo(
                "https://api.dataforseo.com/v3/dataforseo_labs/google/bulk_keyword_difficulty/live",
                {
                    method: "POST",
                    headers: { Authorization: auth, "Content-Type": "application/json" },
                    body: JSON.stringify([{
                        keywords: chunk,
                        location_code: locationCode,
                        language_code: "en",
                    }]),
                },
                30_000
            );

            if (!res || !res.ok) {
                if (res) logger.warn("[dataforseo] Labs bulk_keyword_difficulty not ok", { status: res.status });
                continue;
            }

            const data = await res.json();
            const items: Array<{
                keyword?: string;
                keyword_difficulty?: number | null;
            }> = data?.tasks?.[0]?.result?.[0]?.items ?? [];

            for (const item of items) {
                const kw = item.keyword?.toLowerCase().trim();
                if (!kw) continue;
                const kd = item.keyword_difficulty;
                if (typeof kd === "number") {
                    results.set(kw, Math.round(kd));
                }
            }
        } catch (err: unknown) {
            logger.warn("[dataforseo] getKeywordDifficultyBatch chunk failed", { error: formatError(err) });
        }
    }

    return results;
}

export async function getSerpData(
    keyword: string,
    locationCode = DATAFORSEO_LOCATION_CODES.us,
    maxResults = 10,
): Promise<{ urls: string[]; features: SerpFeatureData }> {
    const emptyFeatures: SerpFeatureData = {
        hasAnswerBox: false,
        hasLocalPack: false,
        hasShopping: false,
        items: [],
        organicResults: [],
        featureTypes: [],
    };

    const auth = getAuthHeader();
    if (!auth) {
        logger.warn("[dataforseo] Credentials not set, skipping SERP data", { keyword });
        return { urls: [], features: emptyFeatures };
    }

    try {
        const res = await fetchDataForSeo(
            "https://api.dataforseo.com/v3/serp/google/organic/live/advanced",
            {
                method: "POST",
                headers: { Authorization: auth, "Content-Type": "application/json" },
                body: JSON.stringify([{
                    keyword,
                    location_code: locationCode,
                    language_code: "en",
                    device: "desktop",
                    depth: maxResults,
                }]),
            },
            20_000
        );

        if (!res || !res.ok) {
            if (res) logger.warn("[dataforseo] SERP response not ok", { keyword, status: res.status });
            return { urls: [], features: emptyFeatures };
        }

        const data = await res.json();
        const items: Array<{
            type: string;
            url?: string;
            title?: string;
            domain?: string;
            rank_absolute?: number;
            backlinks_info?: { referring_domains?: number };
        }> = data?.tasks?.[0]?.result?.[0]?.items ?? [];

        const urls = items
            .filter((i) => i.type === "organic" && i.url)
            .map((i) => i.url!)
            .slice(0, Math.min(maxResults, 10));

        const organicItems = items.filter((i) => i.type === "organic" && i.url);
        const organicResults: SerpOrganicResult[] = organicItems
            .slice(0, Math.min(maxResults, 10))
            .map((i, idx) => ({
                url: i.url!,
                domain: i.domain ?? new URL(i.url!).hostname.replace(/^www\./, ""),
                rank: i.rank_absolute ?? idx + 1,
                title: i.title ?? "",
                backlinks: i.backlinks_info?.referring_domains,
            }));

        const featureTypes = [...new Set(items.map((i) => i.type))];

        const features: SerpFeatureData = {
            hasAnswerBox: items.some((i) => i.type === "featured_snippet" || i.type === "answer_box"),
            hasLocalPack: items.some((i) => i.type === "local_pack"),
            hasShopping: items.some((i) => i.type === "shopping"),
            items,
            organicResults,
            featureTypes,
        };

        return { urls, features };
    } catch (err: unknown) {
        logger.error("[dataforseo] getSerpData failed", { keyword, error: formatError(err) });
        return { urls: [], features: emptyFeatures };
    }
}

export interface DomainMetrics {
    organicTraffic: number;
    organicKeywords: number;
    domainRank: number;
    backlinks: number;
    trafficTrend: "growing" | "stable" | "declining";
    dataSource: "semrush" | "dataforseo" | "none";
}

export async function getDomainMetrics(domain: string): Promise<DomainMetrics | null> {
    if (process.env.SEMRUSH_API_KEY) {
        try {
            const url =
                `https://api.semrush.com/?type=domain_organic` +
                `&key=${process.env.SEMRUSH_API_KEY}` +
                `&domain=${encodeURIComponent(domain)}` +
                `&database=us` +
                `&export_columns=Or,Ot,Oi,Ad,At`;

            const res = await fetchWithTimeout(url, {}, 10_000);
            if (res.ok) {
                const text = await res.text();
                const lines = text.split("\n").filter(Boolean);
                if (lines.length >= 2) {
                    const values = lines[1].split(";");
                    const organicKeywords = parseInt(values[0] ?? "0") || 0;
                    const organicTraffic = parseInt(values[1] ?? "0") || 0;
                    const trafficChange = parseFloat(values[2] ?? "0") || 0;
                    return {
                        organicTraffic,
                        organicKeywords,
                        domainRank: 0,
                        backlinks: 0,
                        trafficTrend:
                            trafficChange > 5 ? "growing" :
                                trafficChange < -5 ? "declining" : "stable",
                        dataSource: "semrush",
                    };
                }
            }
        } catch (err: unknown) {
            logger.warn("[dataforseo] Semrush domain_organic failed", { domain, error: formatError(err) });
        }
    }

    const auth = getAuthHeader();
    if (!auth) {
        logger.warn("[dataforseo] Credentials not set, skipping domain rank overview", { domain });
        return null;
    }

    try {
        const res = await fetchDataForSeo(
            "https://api.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live",
            {
                method: "POST",
                headers: { Authorization: auth, "Content-Type": "application/json" },
                body: JSON.stringify([{
                    target: domain,
                    location_code: DATAFORSEO_LOCATION_CODES.us,
                    language_code: "en",
                }]),
            },
            15_000
        );

        if (res?.ok) {
            const data = await res.json();
            const r = data?.tasks?.[0]?.result?.[0]?.items?.[0];
            if (r) {
                return {
                    organicTraffic: r.metrics?.organic?.etv ?? 0,
                    organicKeywords: r.metrics?.organic?.count ?? 0,
                    domainRank: r.rank_absolute ?? 0,
                    backlinks: r.backlinks_info?.referring_domains ?? 0,
                    trafficTrend: "stable",
                    dataSource: "dataforseo",
                };
            }
        }
    } catch (err: unknown) {
        logger.warn("[dataforseo] domain_rank_overview failed", { domain, error: formatError(err) });
    }

    return null;
}

export interface DomainOverview {
    organicTraffic: number;
    organicKeywords: number;
    paidTraffic: number;
    trafficCost: number;
    topCountries: Array<{ country: string; trafficShare: number }>;
}

export async function getDomainOverview(
    domain: string,
    locationCode = DATAFORSEO_LOCATION_CODES.us,
): Promise<DomainOverview | null> {
    const auth = getAuthHeader();
    if (!auth) return null;

    try {
        const res = await fetchDataForSeo(
            "https://api.dataforseo.com/v3/dataforseo_labs/google/domain_overview/live",
            {
                method: "POST",
                headers: { Authorization: auth, "Content-Type": "application/json" },
                body: JSON.stringify([{ target: domain, location_code: locationCode, language_code: "en" }]),
            },
            15_000,
        );

        if (!res || !res.ok) return null;
        const data = await res.json();
        const item = data?.tasks?.[0]?.result?.[0]?.items?.[0];
        if (!item) return null;

        return {
            organicTraffic: item.organic?.etv ?? 0,
            organicKeywords: item.organic?.count ?? 0,
            paidTraffic: item.paid?.etv ?? 0,
            trafficCost: item.organic?.estimated_paid_traffic_cost ?? 0,
            topCountries: (item.organic?.country_rank_info ?? [])
                .slice(0, 5)
                .map((c: { geo_name: string; traffic_share: number }) => ({
                    country: c.geo_name,
                    trafficShare: c.traffic_share,
                })),
        };
    } catch (err: unknown) {
        logger.warn("[dataforseo] getDomainOverview failed", { domain, error: formatError(err) });
        return null;
    }
}

export interface CompetitorTopPage {
    url: string;
    totalVolume: number;
    keywords: string[];
}

export async function getCompetitorTopPages(
    domain: string,
    locationCode = DATAFORSEO_LOCATION_CODES.us,
): Promise<CompetitorTopPage[]> {
    const auth = getAuthHeader();
    if (!auth) return [];

    try {
        const res = await fetchDataForSeo(
            "https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live",
            {
                method: "POST",
                headers: { Authorization: auth, "Content-Type": "application/json" },
                body: JSON.stringify([{
                    target: domain,
                    location_code: locationCode,
                    language_code: "en",
                    limit: 20,
                    order_by: ["keyword_data.keyword_info.search_volume,desc"],
                }]),
            },
            15_000,
        );

        if (!res || !res.ok) return [];
        const data = await res.json();
        const items: Array<{
            ranked_serp_element?: { serp_item?: { relative_url?: string } };
            keyword_data?: { keyword?: string; keyword_info?: { search_volume?: number } };
        }> = data?.tasks?.[0]?.result?.[0]?.items ?? [];

        const pageMap = new Map<string, CompetitorTopPage>();
        for (const item of items) {
            const url = item.ranked_serp_element?.serp_item?.relative_url ?? "";
            const kw = item.keyword_data?.keyword ?? "";
            const vol = item.keyword_data?.keyword_info?.search_volume ?? 0;
            const existing = pageMap.get(url) ?? { url, totalVolume: 0, keywords: [] };
            existing.totalVolume += vol;
            existing.keywords.push(kw);
            pageMap.set(url, existing);
        }

        return [...pageMap.values()]
            .sort((a, b) => b.totalVolume - a.totalVolume)
            .slice(0, 10);
    } catch (err: unknown) {
        logger.warn("[dataforseo] getCompetitorTopPages failed", { domain, error: formatError(err) });
        return [];
    }
}