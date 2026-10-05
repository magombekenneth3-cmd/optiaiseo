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

export interface GscTopicCluster {
    head: RawGscKeyword;
    variants: string[];
    queries: string[];
    totalClicks: number;
    totalImpressions: number;
    avgPosition: number;
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
 * Cluster raw GSC queries by intent and token overlap.
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
    }[] = [];

    const sorted = [...rawQueries].sort((a, b) => b.impressions - a.impressions);

    for (const q of sorted) {
        const tokens = tokenizeQuery(q.keyword);
        if (tokens.size === 0) continue;

        let merged = false;
        for (const cluster of clusters) {
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

    // 3. Cluster queries
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
