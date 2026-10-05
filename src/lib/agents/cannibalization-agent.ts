// =============================================================================
// CANNIBALIZATION AGENT — Detects keyword & topic cluster cannibalization risk
//
// Pure function. No Prisma, no Inngest, no HTTP.
// Queries GscDailyPerformance for cases where multiple pages rank for
// the same topic cluster or keyword, with temporal evidence of URL alternation.
// Includes search intent compatibility checks to prevent false positives.
// =============================================================================

import { createFindingFingerprint } from "./fingerprint";
import type { AgentExecution, AgentFinding } from "./types";
import type { GscPerformanceRow } from "./gsc-intelligence-agent";
import { buildGscTopicIntelligence, inferQueryIntent } from "@/lib/gsc/topic-cluster";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CannibalizationRisk {
  query: string;
  intent?: string;
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

  // Build canonical topic clusters with ranking URLs and daily date evidence
  const topicClusters = buildGscTopicIntelligence(dailyData, 0.6);
  const risks: CannibalizationRisk[] = [];

  for (const tc of topicClusters) {
    if (tc.rankingUrls.length < 2) continue;

    // Filter to pages with meaningful impressions in top 20
    const significantPages = tc.rankingUrls
      .filter((p) => p.impressions >= 50 && p.avgPosition <= 20)
      .sort((a, b) => a.avgPosition - b.avgPosition);

    if (significantPages.length < 2) continue;

    // Search Intent Compatibility Check:
    // Verify that the multi-page ranking competition represents true intent collision
    // (e.g. not a navigational login page co-ranking with a commercial guide).
    const headIntent = tc.intent || inferQueryIntent(tc.head.keyword);
    if (headIntent === "Navigational" && significantPages.length < 3) {
      // Navigational queries (e.g., login, dashboard) naturally pull homepage/login URLs; skip low-level noise
      continue;
    }

    // Check temporal competition across URLs using dates evidence
    const temporalEvidence = hasTemporalCompetition(
      significantPages.map((p) => ({ url: p.url, dates: p.dates })),
    );

    // Calculate risk score
    const riskScore = calculateRiskScore(
      significantPages.map((p) => ({
        position: p.avgPosition,
        impressions: p.impressions,
        clicks: p.clicks,
      })),
      temporalEvidence,
    );

    if (riskScore < 30) continue;

    const headKeyword = tc.head.keyword;
    const riskEntry: CannibalizationRisk = {
      query: headKeyword,
      intent: headIntent,
      clusterQueries: tc.queries,
      pages: significantPages.map((p) => ({
        url: p.url,
        clicks: p.clicks,
        impressions: p.impressions,
        position: p.avgPosition,
        daysRanked: p.daysRanked,
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
      description: `${significantPages.length} pages compete for ${headIntent} topic cluster "${headKeyword}" (${tc.queries.length} query variants): ${significantPages.map((p) => `${p.url} (pos ${p.avgPosition.toFixed(1)})`).join(", ")}. ${temporalEvidence ? "Ranking URLs alternate over time across the cluster." : "Multiple pages have significant impressions for this topic."}`,
      evidence: significantPages.map((p) => ({
        sourceType: "GSC" as const,
        sourceId: `${headKeyword}|${p.url}`,
        metric: "position",
        value: p.avgPosition.toFixed(2),
        metadata: {
          clicks: p.clicks,
          impressions: p.impressions,
          daysRanked: p.daysRanked,
          clusterQueries: tc.queries.slice(0, 10),
          topicIntent: headIntent,
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

  const totalQueriesChecked = topicClusters.reduce((sum, tc) => sum + tc.queries.length, 0);

  return {
    data: {
      risks,
      totalQueriesChecked,
      risksFound: risks.length,
    },
    findings,
    itemsProcessed: dailyData.length,
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
