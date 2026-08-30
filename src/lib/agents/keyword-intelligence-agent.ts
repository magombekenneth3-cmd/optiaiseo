import { createFindingFingerprint } from "./fingerprint";
import type { AgentExecution, AgentFinding } from "./types";
import type { GscPerformanceRow } from "./gsc-intelligence-agent";

export interface KeywordCluster {
  representative: string;
  queries: string[];
  totalClicks: number;
  totalImpressions: number;
  avgPosition: number;
  uniquePages: number;
}

export interface KeywordIntelligenceData {
  clusters: KeywordCluster[];
  singletonQueries: number;
  totalClusters: number;
}

export function analyzeKeywordIntelligence(
  siteId: string,
  gscData: GscPerformanceRow[],
): AgentExecution<KeywordIntelligenceData> {
  const findings: AgentFinding[] = [];

  // 1. Aggregate queries
  const queryMap = new Map<
    string,
    { clicks: number; impressions: number; position: number; pages: Set<string> }
  >();

  for (const row of gscData) {
    const existing = queryMap.get(row.query);
    if (existing) {
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
      existing.position =
        (existing.position * (existing.impressions - row.impressions) +
          row.position * row.impressions) /
        existing.impressions;
      existing.pages.add(row.page);
    } else {
      queryMap.set(row.query, {
        clicks: row.clicks,
        impressions: row.impressions,
        position: row.position,
        pages: new Set([row.page]),
      });
    }
  }

  // 2. Normalize queries → token sets
  const queries = [...queryMap.keys()];
  const tokenized = new Map<string, string[]>();

  for (const q of queries) {
    tokenized.set(q, normalizeAndTokenize(q));
  }

  // 3. Cluster using Jaccard similarity on token sets
  const clustered = new Set<string>();
  const clusters: KeywordCluster[] = [];

  // Sort by impressions descending so cluster representatives are high-volume
  const sortedQueries = queries.sort(
    (a, b) =>
      (queryMap.get(b)?.impressions ?? 0) - (queryMap.get(a)?.impressions ?? 0),
  );

  for (const query of sortedQueries) {
    if (clustered.has(query)) continue;

    const tokens = tokenized.get(query)!;
    const clusterMembers = [query];
    clustered.add(query);

    // Find similar queries
    for (const candidate of sortedQueries) {
      if (clustered.has(candidate)) continue;

      const candidateTokens = tokenized.get(candidate)!;
      const similarity = jaccardSimilarity(tokens, candidateTokens);

      if (similarity >= 0.45) {
        clusterMembers.push(candidate);
        clustered.add(candidate);
      }
    }

    if (clusterMembers.length < 2) continue; // Skip singletons

    // Aggregate cluster metrics
    let totalClicks = 0;
    let totalImpressions = 0;
    let positionSum = 0;
    const allPages = new Set<string>();

    for (const member of clusterMembers) {
      const data = queryMap.get(member)!;
      totalClicks += data.clicks;
      totalImpressions += data.impressions;
      positionSum += data.position * data.impressions;
      for (const page of data.pages) allPages.add(page);
    }

    clusters.push({
      representative: clusterMembers[0], // Highest impressions
      queries: clusterMembers,
      totalClicks,
      totalImpressions,
      avgPosition:
        totalImpressions > 0 ? positionSum / totalImpressions : 0,
      uniquePages: allPages.size,
    });
  }

  // 4. Generate findings

  // Large clusters with poor average position (topic opportunity)
  for (const cluster of clusters) {
    if (
      cluster.queries.length >= 3 &&
      cluster.avgPosition > 10 &&
      cluster.totalImpressions >= 500
    ) {
      findings.push({
        type: "TOPIC_OPPORTUNITY",
        severity: "MEDIUM",
        title: `Topic opportunity: "${truncate(cluster.representative, 50)}" cluster`,
        description: `${cluster.queries.length} related queries averaging position ${cluster.avgPosition.toFixed(1)} with ${cluster.totalImpressions.toLocaleString()} total impressions. Creating focused content for this topic cluster could capture significant search traffic.`,
        evidence: [
          {
            sourceType: "GSC",
            metric: "clusterSize",
            value: String(cluster.queries.length),
            metadata: { queries: cluster.queries.slice(0, 10) },
            observedAt: new Date().toISOString(),
          },
          {
            sourceType: "GSC",
            metric: "avgPosition",
            value: cluster.avgPosition.toFixed(2),
            observedAt: new Date().toISOString(),
          },
        ],
        confidence: 0.7,
        affectedResource: { type: "KEYWORD", id: cluster.representative },
        fingerprint: createFindingFingerprint({
          siteId,
          type: "TOPIC_OPPORTUNITY",
          resourceType: "KEYWORD",
          resourceId: cluster.representative,
        }),
      });
    }

    // Clusters with only 1 ranking page but many queries (content gap)
    if (cluster.uniquePages === 1 && cluster.queries.length >= 3) {
      findings.push({
        type: "CONTENT_GAP",
        severity: "MEDIUM",
        title: `Content gap: "${truncate(cluster.representative, 50)}" cluster served by one page`,
        description: `${cluster.queries.length} related queries all land on a single page. Creating additional pages for subtopics within this cluster could improve coverage and rankings.`,
        evidence: [
          {
            sourceType: "GSC",
            metric: "uniquePages",
            value: "1",
            metadata: { clusterSize: cluster.queries.length },
            observedAt: new Date().toISOString(),
          },
        ],
        confidence: 0.65,
        affectedResource: { type: "KEYWORD", id: cluster.representative },
        fingerprint: createFindingFingerprint({
          siteId,
          type: "CONTENT_GAP",
          resourceType: "KEYWORD",
          resourceId: cluster.representative,
        }),
      });
    }
  }

  const singletonCount = queries.length - clustered.size;

  return {
    data: {
      clusters,
      singletonQueries: singletonCount,
      totalClusters: clusters.length,
    },
    findings,
    itemsProcessed: queries.length,
  };
}

// ── Normalization & Similarity ──────────────────────────────────────────────

/**
 * Normalize a query and split into tokens for similarity comparison.
 *
 * Steps: lowercase → unicode normalize → remove punctuation →
 * whitespace normalize → remove stopwords → sort tokens
 */
export function normalizeAndTokenize(query: string): string[] {
  const normalized = query
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/[^\w\s]/g, " ") // Remove punctuation
    .replace(/\s+/g, " ")
    .trim();

  const tokens = normalized.split(" ").filter((t) => t.length > 0);

  // Remove common English stopwords
  const filtered = tokens.filter((t) => !STOPWORDS.has(t));

  // Return sorted for consistent comparison
  return filtered.sort();
}

/**
 * Jaccard similarity on two token sets.
 * Returns 0.0–1.0 where 1.0 means identical token sets.
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);

  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ── Stopwords ───────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
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
  "how", "when", "where", "why",
]);

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 3) + "..." : str;
}
