// =============================================================================
// KEYWORD INTELLIGENCE AGENT — Canonical GSC Topic Cluster Intelligence
// =============================================================================

import { createFindingFingerprint } from "./fingerprint";
import type { AgentExecution, AgentFinding } from "./types";
import type { GscPerformanceRow } from "./gsc-intelligence-agent";
import { clusterGscQueries, type RawGscKeyword } from "@/lib/gsc/topic-cluster";

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

  // Build raw GSC keywords list for canonical clustering
  const rawKeywords: RawGscKeyword[] = [...queryMap.entries()].map(([query, data]) => ({
    keyword: query,
    clicks: data.clicks,
    impressions: data.impressions,
    position: data.position,
  }));

  // Canonical GSC Topic Clustering
  const topicClusters = clusterGscQueries(rawKeywords, 0.6);

  const clusters: KeywordCluster[] = [];
  const clusteredQueriesSet = new Set<string>();

  for (const tc of topicClusters) {
    const allPages = new Set<string>();
    for (const q of tc.queries) {
      clusteredQueriesSet.add(q);
      const data = queryMap.get(q);
      if (data) {
        for (const p of data.pages) allPages.add(p);
      }
    }

    clusters.push({
      representative: tc.head.keyword,
      queries: tc.queries,
      totalClicks: tc.totalClicks,
      totalImpressions: tc.totalImpressions,
      avgPosition: tc.avgPosition,
      uniquePages: allPages.size,
    });
  }

  // Generate findings using canonical topic clusters
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

  const singletonCount = queryMap.size - clusteredQueriesSet.size;

  return {
    data: {
      clusters,
      singletonQueries: Math.max(0, singletonCount),
      totalClusters: clusters.length,
    },
    findings,
    itemsProcessed: queryMap.size,
  };
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 3) + "..." : str;
}
