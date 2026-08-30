import { createFindingFingerprint } from "./fingerprint";
import type { AgentExecution, AgentFinding } from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

export interface Ga4PerformanceRow {
  landingPage: string;
  sessions: number;
  users: number;
  engagedSessions: number;
  conversions: number;
  engagementRate: number | null;
  pageviews: number;
}

export interface Ga4IntelligenceData {
  pagesAnalyzed: number;
  highTrafficLowConversion: number;
  highEngagementPages: number;
  lowEngagementPages: number;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function analyzeGa4Intelligence(
  siteId: string,
  ga4Data: Ga4PerformanceRow[],
): AgentExecution<Ga4IntelligenceData> {
  const findings: AgentFinding[] = [];

  if (ga4Data.length === 0) {
    return {
      data: {
        pagesAnalyzed: 0,
        highTrafficLowConversion: 0,
        highEngagementPages: 0,
        lowEngagementPages: 0,
      },
      findings: [],
      itemsProcessed: 0,
    };
  }

  // Aggregate by landing page
  const pageMap = new Map<
    string,
    {
      sessions: number;
      users: number;
      engagedSessions: number;
      conversions: number;
      pageviews: number;
    }
  >();

  for (const row of ga4Data) {
    const existing = pageMap.get(row.landingPage);
    if (existing) {
      existing.sessions += row.sessions;
      existing.users += row.users;
      existing.engagedSessions += row.engagedSessions;
      existing.conversions += row.conversions;
      existing.pageviews += row.pageviews;
    } else {
      pageMap.set(row.landingPage, {
        sessions: row.sessions,
        users: row.users,
        engagedSessions: row.engagedSessions,
        conversions: row.conversions,
        pageviews: row.pageviews,
      });
    }
  }

  // Calculate site-wide averages
  let totalSessions = 0;
  let totalEngaged = 0;
  let totalConversions = 0;
  for (const data of pageMap.values()) {
    totalSessions += data.sessions;
    totalEngaged += data.engagedSessions;
    totalConversions += data.conversions;
  }

  const avgEngagementRate =
    totalSessions > 0 ? totalEngaged / totalSessions : 0;
  const avgConversionRate =
    totalSessions > 0 ? totalConversions / totalSessions : 0;

  let highTrafficLowConversion = 0;
  let highEngagementPages = 0;
  let lowEngagementPages = 0;

  for (const [page, data] of pageMap) {
    if (data.sessions < 10) continue; // Skip low-traffic pages

    const engagementRate =
      data.sessions > 0 ? data.engagedSessions / data.sessions : 0;
    const conversionRate =
      data.sessions > 0 ? data.conversions / data.sessions : 0;

    // High-traffic, low-conversion pages (above median traffic, below average conversion)
    if (
      data.sessions >= 50 &&
      conversionRate < avgConversionRate * 0.5 &&
      avgConversionRate > 0
    ) {
      highTrafficLowConversion++;
      findings.push({
        type: "HIGH_TRAFFIC_LOW_CONVERSION",
        severity: "MEDIUM",
        title: `High traffic, low conversion: ${page}`,
        description: `${page} has ${data.sessions} sessions but a conversion rate of ${(conversionRate * 100).toFixed(1)}% vs site average of ${(avgConversionRate * 100).toFixed(1)}%. Optimizing CTAs or content alignment may improve conversions.`,
        evidence: [
          {
            sourceType: "GA4",
            sourceId: page,
            metric: "sessions",
            value: String(data.sessions),
            observedAt: new Date().toISOString(),
          },
          {
            sourceType: "GA4",
            sourceId: page,
            metric: "conversionRate",
            value: conversionRate.toFixed(4),
            observedAt: new Date().toISOString(),
          },
          {
            sourceType: "GA4",
            metric: "siteAvgConversionRate",
            value: avgConversionRate.toFixed(4),
            observedAt: new Date().toISOString(),
          },
        ],
        confidence: 0.75,
        affectedResource: { type: "PAGE", id: page },
        fingerprint: createFindingFingerprint({
          siteId,
          type: "HIGH_TRAFFIC_LOW_CONVERSION",
          resourceType: "PAGE",
          resourceId: page,
        }),
      });
    }

    // High engagement pages (worth investing in)
    if (engagementRate > avgEngagementRate * 1.3 && data.sessions >= 30) {
      highEngagementPages++;
      findings.push({
        type: "HIGH_ENGAGEMENT_PAGE",
        severity: "INFO",
        title: `High engagement page: ${page}`,
        description: `${page} has an engagement rate of ${(engagementRate * 100).toFixed(1)}% (${Math.round((engagementRate / avgEngagementRate) * 100)}% of site average). This content resonates well — consider expanding it or building internal links to it.`,
        evidence: [
          {
            sourceType: "GA4",
            sourceId: page,
            metric: "engagementRate",
            value: engagementRate.toFixed(4),
            observedAt: new Date().toISOString(),
          },
        ],
        confidence: 0.7,
        affectedResource: { type: "PAGE", id: page },
        fingerprint: createFindingFingerprint({
          siteId,
          type: "HIGH_ENGAGEMENT_PAGE",
          resourceType: "PAGE",
          resourceId: page,
        }),
      });
    }

    // Low engagement pages with significant traffic
    if (
      engagementRate < avgEngagementRate * 0.5 &&
      data.sessions >= 50 &&
      avgEngagementRate > 0
    ) {
      lowEngagementPages++;
      findings.push({
        type: "LOW_ENGAGEMENT_PAGE",
        severity: "MEDIUM",
        title: `Low engagement page: ${page}`,
        description: `${page} has ${data.sessions} sessions but only ${(engagementRate * 100).toFixed(1)}% engagement rate (site avg: ${(avgEngagementRate * 100).toFixed(1)}%). Users may not be finding what they expect.`,
        evidence: [
          {
            sourceType: "GA4",
            sourceId: page,
            metric: "engagementRate",
            value: engagementRate.toFixed(4),
            observedAt: new Date().toISOString(),
          },
          {
            sourceType: "GA4",
            sourceId: page,
            metric: "sessions",
            value: String(data.sessions),
            observedAt: new Date().toISOString(),
          },
        ],
        confidence: 0.7,
        affectedResource: { type: "PAGE", id: page },
        fingerprint: createFindingFingerprint({
          siteId,
          type: "LOW_ENGAGEMENT_PAGE",
          resourceType: "PAGE",
          resourceId: page,
        }),
      });
    }
  }

  return {
    data: {
      pagesAnalyzed: pageMap.size,
      highTrafficLowConversion,
      highEngagementPages,
      lowEngagementPages,
    },
    findings,
    itemsProcessed: pageMap.size,
  };
}
