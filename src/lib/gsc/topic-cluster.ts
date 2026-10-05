// =============================================================================
// GSC TOPIC CLUSTER SERVICE — Canonical GSC Query Clustering & Topic Intelligence
//
// Unifies GSC query clustering across:
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

export interface GscTopicCluster {
    head: RawGscKeyword;
    variants: string[];
    queries: string[];
    totalClicks: number;
    totalImpressions: number;
    avgPosition: number;
    uniquePages?: number;
    pages?: {
        url: string;
        clicks: number;
        impressions: number;
        position: number;
        daysRanked?: number;
    }[];
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
    }));
}
