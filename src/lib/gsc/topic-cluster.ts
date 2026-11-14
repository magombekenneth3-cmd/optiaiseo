// =============================================================================
// GSC TOPIC CLUSTER SERVICE — Canonical GSC Query Clustering & Topic Intelligence
//
// Unifies GSC query clustering and ranking URL intelligence across:
// 1. Keyword Suggestion Action (keyword-suggest.ts)
// 2. Keyword Intelligence Agent (keyword-intelligence-agent.ts)
// 3. Cannibalization Agent (cannibalization-agent.ts)
// 4. Opportunity Engine Page Existence Resolver (page-existence-resolver.ts)
// =============================================================================

export interface RawGscKeyword {
    keyword: string;
    impressions: number;
    clicks: number;
    position: number;
}

export interface ClusterRankingUrl {
    url: string;
    clicks: number;
    impressions: number;
    avgPosition: number;
    daysRanked: number;
    dates: Set<string>;
}

export type SearchIntentCategory = "Informational" | "Commercial" | "Transactional" | "Navigational";

export interface GscTopicCluster {
    head: RawGscKeyword;
    variants: string[];
    queries: string[];
    totalClicks: number;
    totalImpressions: number;
    avgPosition: number;
    intent: SearchIntentCategory;
    uniquePages: number;
    rankingUrls: ClusterRankingUrl[];
    pages: {
        url: string;
        clicks: number;
        impressions: number;
        position: number;
        daysRanked: number;
    }[];
}

export interface GscPerformanceInputRow {
    query: string;
    page: string;
    clicks: number;
    impressions: number;
    position: number;
    date?: string;
}

const STOP_WORDS = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "should",
    "could", "can", "may", "might", "shall", "must", "need",
    "in", "on", "at", "to", "for", "of", "with", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then",
    "and", "but", "or", "nor", "not", "no", "so", "if", "than", "too",
    "very", "just", "about", "up", "down",
    "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
    "she", "her", "it", "its", "they", "them", "their",
    "what", "which", "who", "whom", "this", "that", "these", "those",
    "how", "when", "where", "why", "best", "top", "online"
]);

/**
 * Infer search intent from keyword text.
 * Navigational is evaluated first to ensure login/portal terms are not misclassified.
 */
export function inferQueryIntent(keyword: string): SearchIntentCategory {
    const k = keyword.toLowerCase();
    if (/\b(login|portal|sign in|signin|dashboard|app|website|account)\b/.test(k)) return "Navigational";
    if (/\b(buy|pricing|price|cost|order|quote|discount|deal|purchase)\b/.test(k)) return "Transactional";
    if (/\b(best|vs|review|reviews|top|software|tool|platform|alternative|comparison|provider|service|services|solution|agency)\b/.test(k)) return "Commercial";
    return "Informational";
}

/**
 * Tokenize a query string into a Set of normalized tokens (diacritic-free, lowercase, stopword-filtered).
 */
export function tokenizeQuery(text: string): Set<string> {
    const normalized = text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const tokens = normalized
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

    return new Set(tokens);
}

/**
 * Calculate overlap ratio between two token sets.
 */
export function calculateTokenOverlap(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const token of setA) {
        if (setB.has(token)) intersection++;
    }
    return intersection / Math.min(setA.size, setB.size);
}

/**
 * Cluster raw GSC queries by intent AND token overlap.
 * Query token similarity + compatible search intent = same GSC topic cluster.
 * High impression queries become cluster heads.
 */
export function clusterGscQueries(
    rawQueries: RawGscKeyword[],
    threshold: number = 0.6
): GscTopicCluster[] {
    const clusters: {
        head: RawGscKeyword;
        variants: string[];
        queries: string[];
        totalClicks: number;
        totalImpressions: number;
        positionSum: number;
        intent: SearchIntentCategory;
    }[] = [];

    const sorted = [...rawQueries].sort((a, b) => b.impressions - a.impressions);

    for (const q of sorted) {
        const tokens = tokenizeQuery(q.keyword);
        if (tokens.size === 0) continue;

        const qIntent = inferQueryIntent(q.keyword);

        let merged = false;
        for (const cluster of clusters) {
            // Intent compatibility check: queries in the same topic cluster MUST have identical search intent
            if (cluster.intent !== qIntent) {
                continue;
            }

            const headTokens = tokenizeQuery(cluster.head.keyword);
            const overlapRatio = calculateTokenOverlap(tokens, headTokens);

            if (overlapRatio >= threshold) {
                if (!cluster.variants.includes(q.keyword)) {
                    cluster.variants.push(q.keyword);
                }
                if (!cluster.queries.includes(q.keyword)) {
                    cluster.queries.push(q.keyword);
                }
                cluster.totalClicks += q.clicks;
                cluster.totalImpressions += q.impressions;
                cluster.positionSum += q.position * q.impressions;
                merged = true;
                break;
            }
        }

        if (!merged) {
            clusters.push({
                head: q,
                variants: [q.keyword],
                queries: [q.keyword],
                totalClicks: q.clicks,
                totalImpressions: q.impressions,
                positionSum: q.position * q.impressions,
                intent: qIntent,
            });
        }
    }

    return clusters.map((c) => ({
        head: c.head,
        variants: c.variants,
        queries: c.queries,
        totalClicks: c.totalClicks,
        totalImpressions: c.totalImpressions,
        avgPosition: c.totalImpressions > 0 ? c.positionSum / c.totalImpressions : c.head.position,
        intent: c.intent,
        uniquePages: 0,
        rankingUrls: [],
        pages: [],
    }));
}

/**
 * Build complete GSC Topic Intelligence with ranking URL & daily URL evidence
 * from raw GSC performance rows.
 */
export function buildGscTopicIntelligence(
    rows: GscPerformanceInputRow[],
    threshold: number = 0.6
): GscTopicCluster[] {
    // 1. Group rows by query -> url
    const queryMap = new Map<
        string,
        {
            clicks: number;
            impressions: number;
            positionSum: number;
            urlMap: Map<string, { clicks: number; impressions: number; posSum: number; dates: Set<string> }>;
        }
    >();

    for (const row of rows) {
        let qData = queryMap.get(row.query);
        if (!qData) {
            qData = {
                clicks: 0,
                impressions: 0,
                positionSum: 0,
                urlMap: new Map(),
            };
            queryMap.set(row.query, qData);
        }

        qData.clicks += row.clicks;
        qData.impressions += row.impressions;
        qData.positionSum += row.position * row.impressions;

        let uData = qData.urlMap.get(row.page);
        if (!uData) {
            uData = { clicks: 0, impressions: 0, posSum: 0, dates: new Set() };
            qData.urlMap.set(row.page, uData);
        }

        uData.clicks += row.clicks;
        uData.impressions += row.impressions;
        uData.posSum += row.position * row.impressions;
        if (row.date) {
            uData.dates.add(row.date);
        }
    }

    // 2. Build RawGscKeyword array
    const rawKeywords: RawGscKeyword[] = [];
    for (const [query, data] of queryMap.entries()) {
        rawKeywords.push({
            keyword: query,
            clicks: data.clicks,
            impressions: data.impressions,
            position: data.impressions > 0 ? data.positionSum / data.impressions : 0,
        });
    }

    // 3. Cluster queries with token similarity + intent matching
    const clusters = clusterGscQueries(rawKeywords, threshold);

    // 4. Attach ranking URL intelligence to each cluster
    for (const c of clusters) {
        const clusterUrlMap = new Map<
            string,
            { clicks: number; impressions: number; posSum: number; dates: Set<string> }
        >();

        for (const query of c.queries) {
            const qData = queryMap.get(query);
            if (!qData) continue;

            for (const [url, uData] of qData.urlMap.entries()) {
                let existing = clusterUrlMap.get(url);
                if (!existing) {
                    existing = { clicks: 0, impressions: 0, posSum: 0, dates: new Set() };
                    clusterUrlMap.set(url, existing);
                }

                existing.clicks += uData.clicks;
                existing.impressions += uData.impressions;
                existing.posSum += uData.posSum;
                for (const d of uData.dates) {
                    existing.dates.add(d);
                }
            }
        }

        const rankingUrls: ClusterRankingUrl[] = [...clusterUrlMap.entries()]
            .map(([url, data]) => ({
                url,
                clicks: data.clicks,
                impressions: data.impressions,
                avgPosition: data.impressions > 0 ? data.posSum / data.impressions : 0,
                daysRanked: data.dates.size,
                dates: data.dates,
            }))
            .sort((a, b) => b.impressions - a.impressions);

        c.rankingUrls = rankingUrls;
        c.uniquePages = rankingUrls.length;
        c.pages = rankingUrls.map((r) => ({
            url: r.url,
            clicks: r.clicks,
            impressions: r.impressions,
            position: r.avgPosition,
            daysRanked: r.daysRanked,
        }));
    }

    return clusters;
}

const SEARCH_OPERATOR_RE = /\b(?:site|inurl|intitle|allintitle|allinurl|filetype|ext|cache|related|define| before|after):/i;
const NEGATIVE_FLAG_RE = /(?:^|\s)-[a-z0-9_]{2,}/i;
const URL_OR_DOMAIN_RE = /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|org|net|io|co|online|ai|dev|app|uk|us|in|edu|gov)(?:\/\S*)?\b/i;
const KEYBOARD_SMASH_RE = /qwert|asdfg|zxcvb|hjkl|yuiop/i;
const REPEATED_CHAR_RE = /(.)\1{3,}/i;

/**
 * Validates whether a raw GSC or competitor query is a clean, human-readable
 * article topic rather than a search operator dork, URL, keyboard smash, or gibberish string.
 */
export function isViableGscTopicQuery(query: string, siteDomain?: string): boolean {
    const trimmed = query.trim();
    if (trimmed.length < 3 || trimmed.length > 90) return false;

    // Reject search operators (e.g. `site:linkedin.com/posts ... -for hire -agency`)
    if (SEARCH_OPERATOR_RE.test(trimmed)) return false;
    if (NEGATIVE_FLAG_RE.test(trimmed)) return false;
    if (URL_OR_DOMAIN_RE.test(trimmed)) return false;
    if (/[<>{}[\]\\|^~`"*()]/.test(trimmed)) return false;

    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 10) return false;

    // Reject self-brand navigational queries matching the site's own domain root
    if (siteDomain) {
        const cleanDomain = siteDomain
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "")
            .split("/")[0];
        const domainRoot = cleanDomain.split(".")[0];
        const normalizedQuery = trimmed.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (normalizedQuery === cleanDomain.replace(/[^a-z0-9]/g, "") || (domainRoot.length >= 4 && normalizedQuery === domainRoot)) {
            return false;
        }
    }

    // Check individual tokens for gibberish / keyboard smashes
    for (const rawWord of words) {
        const word = rawWord.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!word) continue;
        if (word.length > 28) return false;
        if (KEYBOARD_SMASH_RE.test(word)) return false;
        if (REPEATED_CHAR_RE.test(word)) return false;

        const alphaOnly = word.replace(/[^a-z]/g, "");
        if (alphaOnly.length >= 4) {
            // 4+ consecutive vowels (e.g. "aoizeoizaoiea") or 6+ consecutive consonants
            if (/[aeiou]{4,}/i.test(alphaOnly)) return false;
            if (/[bcdfghjklmnpqrstvwxyz]{6,}/i.test(alphaOnly)) return false;
        }

        if (alphaOnly.length >= 8) {
            const vowelCount = (alphaOnly.match(/[aeiou]/g) || []).length;
            const vowelRatio = vowelCount / alphaOnly.length;
            // Extremely vowel-heavy (e.g., "aoizeoizaoiea" = 77%) or zero-vowel consonant strings
            if (vowelCount === 0 || vowelRatio >= 0.68 || vowelRatio <= 0.12) {
                return false;
            }
        }
    }

    return true;
}

const ACTION_LABELS: Record<string, string> = {
    IMPROVE_SEARCH_INTENT: "Align Search Intent",
    CREATE_NEW_CONTENT: "New Article",
    EXPAND_CONTENT_DEPTH: "Expand Content Depth",
    IMPROVE_TITLE_META: "Improve Title & CTR",
    OPTIMIZE_CTR: "Improve Title & CTR",
    CONSOLIDATE_PAGES: "Consolidate Pages",
    FIX_TECHNICAL_SEO: "Fix Technical SEO",
    REFRESH: "Refresh Content",
    OPTIMIZE: "Optimize Content",
};

/**
 * Formats internal enum strings (like `IMPROVE_SEARCH_INTENT`) into clean UI labels.
 */
export function formatRecommendedActionLabel(
    action?: string | null,
    actionType?: "CREATE_PAGE" | "UPDATE_PAGE"
): string {
    if (!action) {
        return actionType === "UPDATE_PAGE" ? "Refresh Content" : "New Article";
    }
    const upper = action.trim().toUpperCase();
    if (ACTION_LABELS[upper]) return ACTION_LABELS[upper];
    return upper
        .split("_")
        .filter(Boolean)
        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
        .join(" ");
}

/**
 * Formats a full page URL into a concise pathname for card display (e.g. `/tools/seo-tools-local-business`).
 */
export function formatUrlPathForDisplay(url?: string | null): string | null {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        const path = parsed.pathname === "/" ? parsed.hostname : parsed.pathname.replace(/\/$/, "");
        return path || parsed.hostname;
    } catch {
        return url.replace(/^https?:\/\/[^/]+/i, "") || url;
    }
}

/**
 * Computes an opportunity priority score so high-impression striking-distance topics
 * sort above low-impression micro-queries.
 */
export function scoreKeywordOpportunity(params: {
    impressions: number;
    position: number;
    searchVolume?: number | null;
    actionType?: "CREATE_PAGE" | "UPDATE_PAGE";
    wordCount?: number;
}): number {
    const demand = Math.max(params.impressions || 0, params.searchVolume || 0);
    // Striking distance (positions 4–40) gets highest multiplier
    const positionMultiplier =
        params.position >= 4 && params.position <= 20
            ? 1.5
            : params.position >= 21 && params.position <= 45
                ? 1.35
                : params.position > 45
                    ? 1.0
                    : 0.7;
    // Multi-word topics (2–6 words) have clearer search intent than single-word terms
    const wordBonus = (params.wordCount ?? 2) >= 2 ? 1.2 : 0.65;
    return demand * positionMultiplier * wordBonus;
}
