// =============================================================================
// GSC INTELLIGENCE AGENT — Detects search opportunities from GSC data
//
// Pure function. Reads pre-fetched GSC performance data (not live API).
// Implements 4 detection strategies with proper period-over-period comparison.
//
// Key corrections from architecture review:
// - Declining: current 28d vs previous 28d, not vs 90-day-ago snapshot
// - CTR: position-bucketed benchmarks, not universal expected CTR
// - All detectors require minimum impression thresholds
// =============================================================================

import { createFindingFingerprint } from "./fingerprint";
import type { AgentExecution, AgentFinding } from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

export interface GscPerformanceRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  date: string; // YYYY-MM-DD
}

export interface GscIntelligenceData {
  quickWins: number;
  lowCtrOpportunities: number;
  decliningQueries: number;
  emergingQueries: number;
  totalQueriesAnalyzed: number;
}

// ── CTR Benchmarks (position-bucketed) ──────────────────────────────────────

/**
 * Average organic CTR by position, based on industry studies.
 * These are defaults — can be overridden per-niche later.
 */
const CTR_BENCHMARKS: Record<number, number> = {
  1: 0.28,
  2: 0.15,
  3: 0.11,
  4: 0.08,
  5: 0.067,
  6: 0.047,
  7: 0.033,
  8: 0.025,
  9: 0.019,
  10: 0.015,
};

function getExpectedCtr(position: number): number {
  const rounded = Math.min(10, Math.max(1, Math.round(position)));
  return CTR_BENCHMARKS[rounded] ?? 0.01;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function analyzeGscIntelligence(
  siteId: string,
  currentPeriodData: GscPerformanceRow[],
  previousPeriodData: GscPerformanceRow[],
): AgentExecution<GscIntelligenceData> {
  const findings: AgentFinding[] = [];

  // Aggregate current period by query
  const currentByQuery = aggregateByQuery(currentPeriodData);
  const previousByQuery = aggregateByQuery(previousPeriodData);

  let quickWins = 0;
  let lowCtrOpportunities = 0;
  let decliningQueries = 0;
  let emergingQueries = 0;

  for (const [query, current] of currentByQuery.entries()) {
    const previous = previousByQuery.get(query);

    // ── Quick Win Detection ─────────────────────────────────────────────
    // Position 4–15, meaningful impressions
    if (
      current.position >= 4 &&
      current.position <= 15 &&
      current.impressions >= 500
    ) {
      quickWins++;
      findings.push({
        type: "QUICK_WIN",
        severity: "HIGH",
        title: `Quick win opportunity: "${truncate(query, 60)}"`,
        description: `"${query}" ranks at position ${current.position.toFixed(1)} with ${current.impressions.toLocaleString()} impressions. A small position improvement could yield significant traffic gains.`,
        evidence: [
          {
            sourceType: "GSC",
            sourceId: `${query}|${current.topPage}`,
            metric: "position",
            value: current.position.toFixed(2),
            observedAt: new Date().toISOString(),
          },
          {
            sourceType: "GSC",
            sourceId: `${query}|${current.topPage}`,
            metric: "impressions",
            value: String(current.impressions),
            observedAt: new Date().toISOString(),
          },
          {
            sourceType: "GSC",
            sourceId: `${query}|${current.topPage}`,
            metric: "clicks",
            value: String(current.clicks),
            observedAt: new Date().toISOString(),
          },
        ],
        confidence: 0.9,
        affectedResource: { type: "QUERY", id: query },
        fingerprint: createFindingFingerprint({
          siteId,
          type: "QUICK_WIN",
          resourceType: "QUERY",
          resourceId: query,
        }),
      });
    }

    // ── Low CTR Detection ───────────────────────────────────────────────
    // CTR < benchmark × 0.7, with meaningful impressions
    if (current.impressions >= 200 && current.position <= 10) {
      const expectedCtr = getExpectedCtr(current.position);
      if (current.ctr < expectedCtr * 0.7) {
        lowCtrOpportunities++;
        findings.push({
          type: "LOW_CTR",
          severity: "MEDIUM",
          title: `Low CTR for "${truncate(query, 60)}"`,
          description: `"${query}" at position ${current.position.toFixed(1)} has a CTR of ${(current.ctr * 100).toFixed(1)}% vs expected ${(expectedCtr * 100).toFixed(1)}%. Improving the title/meta description may increase clicks.`,
          evidence: [
            {
              sourceType: "GSC",
              sourceId: `${query}|${current.topPage}`,
              metric: "ctr",
              value: current.ctr.toFixed(4),
              observedAt: new Date().toISOString(),
            },
            {
              sourceType: "COMPUTED",
              metric: "expectedCtr",
              value: expectedCtr.toFixed(4),
              metadata: { positionBucket: Math.round(current.position) },
              observedAt: new Date().toISOString(),
            },
          ],
          confidence: 0.8,
          affectedResource: { type: "QUERY", id: query },
          fingerprint: createFindingFingerprint({
            siteId,
            type: "LOW_CTR",
            resourceType: "QUERY",
            resourceId: query,
          }),
        });
      }
    }

    // ── Declining Query Detection ───────────────────────────────────────
    // Current 28d vs previous 28d, minimum volume, meaningful drops
    if (previous && previous.impressions >= 100 && current.impressions >= 100) {
      const positionDelta = current.position - previous.position;
      const clickDelta =
        previous.clicks > 0
          ? (current.clicks - previous.clicks) / previous.clicks
          : 0;

      if (positionDelta >= 2 && clickDelta <= -0.2) {
        decliningQueries++;
        findings.push({
          type: "DECLINING_QUERY",
          severity: "HIGH",
          title: `Declining performance: "${truncate(query, 60)}"`,
          description: `"${query}" position dropped from ${previous.position.toFixed(1)} to ${current.position.toFixed(1)} (Δ${positionDelta.toFixed(1)}). Clicks dropped ${Math.abs(Math.round(clickDelta * 100))}% from ${previous.clicks} to ${current.clicks}.`,
          evidence: [
            {
              sourceType: "GSC",
              metric: "positionCurrent",
              value: current.position.toFixed(2),
              observedAt: new Date().toISOString(),
            },
            {
              sourceType: "GSC",
              metric: "positionPrevious",
              value: previous.position.toFixed(2),
              observedAt: new Date().toISOString(),
            },
            {
              sourceType: "GSC",
              metric: "clicksCurrent",
              value: String(current.clicks),
              observedAt: new Date().toISOString(),
            },
            {
              sourceType: "GSC",
              metric: "clicksPrevious",
              value: String(previous.clicks),
              observedAt: new Date().toISOString(),
            },
          ],
          confidence: 0.85,
          affectedResource: { type: "QUERY", id: query },
          fingerprint: createFindingFingerprint({
            siteId,
            type: "DECLINING_QUERY",
            resourceType: "QUERY",
            resourceId: query,
          }),
        });
      }
    }

    // ── Emerging Query Detection ────────────────────────────────────────
    // Impressions ↑ 50%+ in current 28d vs previous 28d
    if (current.impressions >= 50) {
      const prevImpressions = previous?.impressions ?? 0;
      if (
        prevImpressions > 0 &&
        (current.impressions - prevImpressions) / prevImpressions >= 0.5
      ) {
        emergingQueries++;
        findings.push({
          type: "EMERGING_QUERY",
          severity: "INFO",
          title: `Emerging query: "${truncate(query, 60)}"`,
          description: `"${query}" impressions grew ${Math.round(((current.impressions - prevImpressions) / prevImpressions) * 100)}% from ${prevImpressions} to ${current.impressions}. Consider investing in this growing topic.`,
          evidence: [
            {
              sourceType: "GSC",
              metric: "impressionsCurrent",
              value: String(current.impressions),
              observedAt: new Date().toISOString(),
            },
            {
              sourceType: "GSC",
              metric: "impressionsPrevious",
              value: String(prevImpressions),
              observedAt: new Date().toISOString(),
            },
          ],
          confidence: 0.75,
          affectedResource: { type: "QUERY", id: query },
          fingerprint: createFindingFingerprint({
            siteId,
            type: "EMERGING_QUERY",
            resourceType: "QUERY",
            resourceId: query,
          }),
        });
      } else if (prevImpressions === 0) {
        // Brand new query
        emergingQueries++;
        findings.push({
          type: "NEW_QUERY",
          severity: "INFO",
          title: `New query detected: "${truncate(query, 60)}"`,
          description: `"${query}" appeared with ${current.impressions} impressions in the current period but had no data in the previous period.`,
          evidence: [
            {
              sourceType: "GSC",
              metric: "impressionsCurrent",
              value: String(current.impressions),
              observedAt: new Date().toISOString(),
            },
          ],
          confidence: 0.6,
          affectedResource: { type: "QUERY", id: query },
          fingerprint: createFindingFingerprint({
            siteId,
            type: "NEW_QUERY",
            resourceType: "QUERY",
            resourceId: query,
          }),
        });
      }
    }
  }

  return {
    data: {
      quickWins,
      lowCtrOpportunities,
      decliningQueries,
      emergingQueries,
      totalQueriesAnalyzed: currentByQuery.size,
    },
    findings,
    itemsProcessed: currentByQuery.size,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface AggregatedQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  topPage: string;
}

function aggregateByQuery(
  rows: GscPerformanceRow[],
): Map<string, AggregatedQuery> {
  const map = new Map<
    string,
    { clicks: number; impressions: number; positionWeightedSum: number; topPage: string; topPageClicks: number }
  >();

  for (const row of rows) {
    const existing = map.get(row.query);
    if (existing) {
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
      existing.positionWeightedSum += row.position * row.impressions;
      if (row.clicks > existing.topPageClicks) {
        existing.topPage = row.page;
        existing.topPageClicks = row.clicks;
      }
    } else {
      map.set(row.query, {
        clicks: row.clicks,
        impressions: row.impressions,
        positionWeightedSum: row.position * row.impressions,
        topPage: row.page,
        topPageClicks: row.clicks,
      });
    }
  }

  const result = new Map<string, AggregatedQuery>();
  for (const [query, data] of map) {
    const avgPosition =
      data.impressions > 0
        ? data.positionWeightedSum / data.impressions
        : 0;
    const ctr =
      data.impressions > 0 ? data.clicks / data.impressions : 0;

    result.set(query, {
      query,
      clicks: data.clicks,
      impressions: data.impressions,
      ctr,
      position: avgPosition,
      topPage: data.topPage,
    });
  }

  return result;
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 3) + "..." : str;
}
