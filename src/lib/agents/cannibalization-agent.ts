// =============================================================================
// CANNIBALIZATION AGENT — Detects keyword & topic cluster cannibalization risk
//
// Pure function. No Prisma, no Inngest, no HTTP.
// Queries GscDailyPerformance for cases where multiple pages rank for
// the same topic cluster or keyword, with temporal evidence of URL alternation.
// =============================================================================

import { createFindingFingerprint } from "./fingerprint";
import type { AgentExecution, AgentFinding } from "./types";
import type { GscPerformanceRow } from "./gsc-intelligence-agent";
import { clusterGscQueries, type RawGscKeyword } from "@/lib/gsc/topic-cluster";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CannibalizationRisk {
  query: string;
  clusterQueries?: string[];
  pages: {
    url: string;
    clicks: number;
    impressions: number;
    position: number;
    daysRanked: number;
  }[];
  riskScore: number; // 0–100
  temporalEvidence: boolean;
}

export interface CannibalizationData {
  risks: CannibalizationRisk[];
  totalQueriesChecked: number;
  risksFound: number;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function analyzeCannibalization(
  siteId: string,
  dailyData: GscPerformanceRow[],
): AgentExecution<CannibalizationData> {
  const findings: AgentFinding[] = [];

  // 1. Group data by query → page → daily metrics
  const queryPageMap = new Map<
    string,
    Map<string, { clicks: number; impressions: number; position: number; dates: Set<string> }>
  >();

  for (const row of dailyData) {
    if (!queryPageMap.has(row.query)) {
      queryPageMap.set(row.query, new Map());
    }
    const pageMap = queryPageMap.get(row.query)!;
    const existing = pageMap.get(row.page);

    if (existing) {
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
      existing.position =
        (existing.position * existing.impressions + row.position * row.impressions) /
        (existing.impressions + row.impressions);
      existing.impressions += row.impressions;
      existing.dates.add(row.date);
    } else {
      pageMap.set(row.page, {
        clicks: row.clicks,
        impressions: row.impressions,
        position: row.position,
        dates: new Set([row.date]),
      });
    }
  }

  // 2. Build raw GSC keywords & run canonical Topic Clustering
  const rawKeywords: RawGscKeyword[] = [];
  for (const [query, pageMap] of queryPageMap.entries()) {
    let totalImpressions = 0;
    let totalClicks = 0;
    let posSum = 0;
    for (const [, pData] of pageMap.entries()) {
      totalImpressions += pData.impressions;
      totalClicks += pData.clicks;
      posSum += pData.position * pData.impressions;
    }
    rawKeywords.push({
      keyword: query,
      impressions: totalImpressions,
      clicks: totalClicks,
      position: totalImpressions > 0 ? posSum / totalImpressions : 0,
    });
  }

  const topicClusters = clusterGscQueries(rawKeywords, 0.6);
  const risks: CannibalizationRisk[] = [];
  const processedHeadKeywords = new Set<string>();

  // 3. Evaluate Topic Cluster-level cannibalization
  for (const tc of topicClusters) {
    const headKeyword = tc.head.keyword;
    if (processedHeadKeywords.has(headKeyword)) continue;
    processedHeadKeywords.add(headKeyword);

    // Aggregate page performance across all queries in this topic cluster
    const clusterPageMap = new Map<
      string,
      { clicks: number; impressions: number; posSum: number; dates: Set<string> }
    >();

    for (const memberQuery of tc.queries) {
      const pageMap = queryPageMap.get(memberQuery);
      if (!pageMap) continue;

      for (const [url, data] of pageMap.entries()) {
        const existing = clusterPageMap.get(url);
        if (existing) {
          existing.clicks += data.clicks;
          existing.impressions += data.impressions;
          existing.posSum += data.position * data.impressions;
          for (const d of data.dates) existing.dates.add(d);
        } else {
          clusterPageMap.set(url, {
            clicks: data.clicks,
            impressions: data.impressions,
            posSum: data.position * data.impressions,
            dates: new Set(data.dates),
          });
        }
      }
    }

    if (clusterPageMap.size < 2) continue;

    // Filter to pages with meaningful impressions in top 20
    const significantPages = [...clusterPageMap.entries()]
      .map(([url, data]) => ({
        url,
        clicks: data.clicks,
        impressions: data.impressions,
        position: data.impressions > 0 ? data.posSum / data.impressions : 0,
        dates: data.dates,
      }))
      .filter((p) => p.impressions >= 50 && p.position <= 20)
      .sort((a, b) => a.position - b.position);

    if (significantPages.length < 2) continue;

    // Check temporal competition across URLs
    const temporalEvidence = hasTemporalCompetition(
      significantPages.map((p) => ({ url: p.url, dates: p.dates })),
    );

    // Calculate risk score
    const riskScore = calculateRiskScore(
      significantPages.map((p) => ({
        position: p.position,
        impressions: p.impressions,
        clicks: p.clicks,
      })),
      temporalEvidence,
    );

    if (riskScore < 30) continue;

    const riskEntry: CannibalizationRisk = {
      query: headKeyword,
      clusterQueries: tc.queries,
      pages: significantPages.map((p) => ({
        url: p.url,
        clicks: p.clicks,
        impressions: p.impressions,
        position: p.position,
        daysRanked: p.dates.size,
      })),
      riskScore,
      temporalEvidence,
    };

    risks.push(riskEntry);

    const severity = riskScore >= 70 ? "HIGH" : riskScore >= 50 ? "MEDIUM" : "LOW";

    findings.push({
      type: "CANNIBALIZATION_RISK",
      severity,
      title: `Cannibalization risk: "${truncate(headKeyword, 50)}" topic cluster`,
      description: `${significantPages.length} pages compete for topic cluster "${headKeyword}" (${tc.queries.length} query variants): ${significantPages.map((p) => `${p.url} (pos ${p.position.toFixed(1)})`).join(", ")}. ${temporalEvidence ? "Ranking URLs alternate over time across the cluster." : "Multiple pages have significant impressions for this topic."}`,
      evidence: significantPages.map((p) => ({
        sourceType: "GSC" as const,
        sourceId: `${headKeyword}|${p.url}`,
        metric: "position",
        value: p.position.toFixed(2),
        metadata: {
          clicks: p.clicks,
          impressions: p.impressions,
          daysRanked: p.dates.size,
          clusterQueries: tc.queries.slice(0, 10),
        },
        observedAt: new Date().toISOString(),
      })),
      confidence: temporalEvidence ? 0.85 : 0.6,
      affectedResource: { type: "QUERY", id: headKeyword },
      fingerprint: createFindingFingerprint({
        siteId,
        type: "CANNIBALIZATION_RISK",
        resourceType: "QUERY",
        resourceId: headKeyword,
      }),
    });
  }

  return {
    data: {
      risks,
      totalQueriesChecked: queryPageMap.size,
      risksFound: risks.length,
    },
    findings,
    itemsProcessed: queryPageMap.size,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function hasTemporalCompetition(
  pages: { url: string; dates: Set<string> }[],
): boolean {
  if (pages.length < 2) return false;

  const allDates = new Set<string>();
  for (const page of pages) {
    for (const date of page.dates) allDates.add(date);
  }

  const [page1, page2] = pages;
  const page1Only = [...page1.dates].filter((d) => !page2.dates.has(d)).length;
  const page2Only = [...page2.dates].filter((d) => !page1.dates.has(d)).length;
  const totalDays = allDates.size;

  return totalDays > 0 && (page1Only + page2Only) / totalDays > 0.2;
}

function calculateRiskScore(
  pages: { position: number; impressions: number; clicks: number }[],
  temporal: boolean,
): number {
  if (pages.length < 2) return 0;

  const sorted = [...pages].sort((a, b) => a.position - b.position);
  const top = sorted[0];
  const second = sorted[1];

  const positionGap = Math.abs(top.position - second.position);
  const positionScore = Math.max(0, 40 - positionGap * 4);

  const totalImpressions = top.impressions + second.impressions;
  const splitRatio =
    totalImpressions > 0
      ? Math.min(top.impressions, second.impressions) / totalImpressions
      : 0;
  const splitScore = splitRatio * 60;

  const temporalScore = temporal ? 30 : 0;

  return Math.min(100, Math.round(positionScore + splitScore + temporalScore));
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 3) + "..." : str;
}
