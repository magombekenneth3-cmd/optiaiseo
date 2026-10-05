// =============================================================================
// KEYWORD INTELLIGENCE AGENT — Canonical GSC Topic Cluster Intelligence
// =============================================================================

import { createFindingFingerprint } from "./fingerprint";
import type { AgentExecution, AgentFinding } from "./types";
import type { GscPerformanceRow } from "./gsc-intelligence-agent";
import { buildGscTopicIntelligence, type ClusterRankingUrl } from "@/lib/gsc/topic-cluster";

export interface KeywordCluster {
  representative: string;
  queries: string[];
  totalClicks: number;
  totalImpressions: number;
  avgPosition: number;
  uniquePages: number;
  rankingUrls: ClusterRankingUrl[];
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

  // Build canonical topic clusters with ranking URL intelligence
  const topicClusters = buildGscTopicIntelligence(gscData, 0.6);

  const clusters: KeywordCluster[] = [];
  const clusteredQueriesSet = new Set<string>();

  for (const tc of topicClusters) {
    for (const q of tc.queries) {
      clusteredQueriesSet.add(q);
    }

    clusters.push({
      representative: tc.head.keyword,
      queries: tc.queries,
      totalClicks: tc.totalClicks,
      totalImpressions: tc.totalImpressions,
      avgPosition: tc.avgPosition,
      uniquePages: tc.uniquePages,
      rankingUrls: tc.rankingUrls,
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
            metadata: {
              queries: cluster.queries.slice(0, 10),
              rankingUrls: cluster.rankingUrls.map((r) => ({
                url: r.url,
                clicks: r.clicks,
                impressions: r.impressions,
                avgPosition: r.avgPosition,
                daysRanked: r.daysRanked,
              })),
              clusterImpressions: cluster.totalImpressions,
              clusterClicks: cluster.totalClicks,
              clusterAvgPosition: cluster.avgPosition,
            },
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
            metadata: {
              clusterSize: cluster.queries.length,
              rankingUrls: cluster.rankingUrls.map((r) => ({
                url: r.url,
                clicks: r.clicks,
                impressions: r.impressions,
                avgPosition: r.avgPosition,
              })),
            },
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

  const allQueriesCount = new Set(gscData.map((d) => d.query)).size;
  const singletonCount = allQueriesCount - clusteredQueriesSet.size;

  return {
    data: {
      clusters,
      singletonQueries: Math.max(0, singletonCount),
      totalClusters: clusters.length,
    },
    findings,
    itemsProcessed: gscData.length,
  };
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 3) + "..." : str;
}
