// =============================================================================
// CANNIBALIZATION AGENT — Detects keyword cannibalization risk
//
// Pure function. No Prisma, no Inngest, no HTTP.
// Queries GscDailyPerformance for cases where multiple pages rank for
// the same keyword, with temporal evidence of ranking URL alternation.
//
// Architecture decision: produces CANNIBALIZATION_RISK, not CANNIBALIZATION.
// Multiple pages ranking for one query is not always harmful.
// =============================================================================

import { createFindingFingerprint } from "./fingerprint";
import type { AgentExecution, AgentFinding } from "./types";
import type { GscPerformanceRow } from "./gsc-intelligence-agent";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CannibalizationRisk {
  query: string;
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

  // Group data by query → page → daily rows
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
        (existing.position * (existing.impressions - row.impressions) +
          row.position * row.impressions) /
        existing.impressions;
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

  const risks: CannibalizationRisk[] = [];

  for (const [query, pageMap] of queryPageMap.entries()) {
    // Only consider queries with multiple ranking pages
    if (pageMap.size < 2) continue;

    // Filter to pages with meaningful impressions in top 20
    const significantPages = [...pageMap.entries()]
      .filter(([, data]) => data.impressions >= 50 && data.position <= 20)
      .sort(([, a], [, b]) => a.position - b.position);

    if (significantPages.length < 2) continue;

    // Check for temporal evidence: do ranking URLs alternate?
    const temporalEvidence = hasTemporalCompetition(
      significantPages.map(([url, data]) => ({
        url,
        dates: data.dates,
      })),
    );

    // Calculate risk score
    const riskScore = calculateRiskScore(
      significantPages.map(([, data]) => ({
        position: data.position,
        impressions: data.impressions,
        clicks: data.clicks,
      })),
      temporalEvidence,
    );

    // Only report if risk is meaningful
    if (riskScore < 30) continue;

    const riskEntry: CannibalizationRisk = {
      query,
      pages: significantPages.map(([url, data]) => ({
        url,
        clicks: data.clicks,
        impressions: data.impressions,
        position: data.position,
        daysRanked: data.dates.size,
      })),
      riskScore,
      temporalEvidence,
    };

    risks.push(riskEntry);

    const severity = riskScore >= 70 ? "HIGH" : riskScore >= 50 ? "MEDIUM" : "LOW";

    findings.push({
      type: "CANNIBALIZATION_RISK",
      severity,
      title: `Cannibalization risk: "${truncate(query, 50)}"`,
      description: `${significantPages.length} pages compete for "${query}": ${significantPages.map(([url, data]) => `${url} (pos ${data.position.toFixed(1)})`).join(", ")}. ${temporalEvidence ? "Ranking URLs alternate over time, indicating Google is uncertain which page to rank." : "Multiple pages have significant impressions."}`,
      evidence: significantPages.map(([url, data]) => ({
        sourceType: "GSC" as const,
        sourceId: `${query}|${url}`,
        metric: "position",
        value: data.position.toFixed(2),
        metadata: {
          clicks: data.clicks,
          impressions: data.impressions,
          daysRanked: data.dates.size,
        },
        observedAt: new Date().toISOString(),
      })),
      confidence: temporalEvidence ? 0.85 : 0.6,
      affectedResource: { type: "QUERY", id: query },
      fingerprint: createFindingFingerprint({
        siteId,
        type: "CANNIBALIZATION_RISK",
        resourceType: "QUERY",
        resourceId: query,
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

/**
 * Detect temporal competition: do different URLs appear on different days?
 *
 * Strong cannibalization signal: pages "take turns" ranking, suggesting
 * Google is uncertain which page to show.
 */
function hasTemporalCompetition(
  pages: { url: string; dates: Set<string> }[],
): boolean {
  if (pages.length < 2) return false;

  // Get all dates across all pages
  const allDates = new Set<string>();
  for (const page of pages) {
    for (const date of page.dates) allDates.add(date);
  }

  // For each date, determine which page was "primary" (most impressions)
  // If different pages are primary on different days, that's temporal competition
  // Simplified: check if dates are NOT fully overlapping
  const [page1, page2] = pages;
  const page1Only = [...page1.dates].filter((d) => !page2.dates.has(d)).length;
  const page2Only = [...page2.dates].filter((d) => !page1.dates.has(d)).length;
  const totalDays = allDates.size;

  // If > 20% of days show only one page, there's temporal competition
  return totalDays > 0 && (page1Only + page2Only) / totalDays > 0.2;
}

/**
 * Calculate cannibalization risk score (0–100).
 *
 * Factors:
 * - Position proximity (both in top 20)
 * - Impression split (both getting significant traffic)
 * - Temporal evidence (pages alternating)
 */
function calculateRiskScore(
  pages: { position: number; impressions: number; clicks: number }[],
  temporal: boolean,
): number {
  if (pages.length < 2) return 0;

  const sorted = [...pages].sort((a, b) => a.position - b.position);
  const top = sorted[0];
  const second = sorted[1];

  // Position proximity score (0–40)
  // Closer positions = higher risk
  const positionGap = Math.abs(top.position - second.position);
  const positionScore = Math.max(0, 40 - positionGap * 4);

  // Impression split score (0–30)
  // More even split = higher risk
  const totalImpressions = top.impressions + second.impressions;
  const splitRatio =
    totalImpressions > 0
      ? Math.min(top.impressions, second.impressions) / totalImpressions
      : 0;
  const splitScore = splitRatio * 60; // Max 30 at 50/50 split

  // Temporal evidence bonus (0–30)
  const temporalScore = temporal ? 30 : 0;

  return Math.min(100, Math.round(positionScore + splitScore + temporalScore));
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 3) + "..." : str;
}
