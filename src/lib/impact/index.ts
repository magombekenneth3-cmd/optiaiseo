import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type ImpactAttributionStatus = "PENDING_ATTRIBUTION" | "MEASURED" | "INSUFFICIENT_DATA";
export type ImpactConfidence = "HIGH" | "MEDIUM" | "EVALUATING" | "UNKNOWN";

export interface ImpactMetrics {
  clicks: number;
  impressions: number;
  avgPosition: number | null;
  sampleDays: number;
}

export interface ImpactDelta {
  clicksDiff: number;
  clicksLiftPercent: number | null;
  impressionsDiff: number;
  impressionsLiftPercent: number | null;
  positionDiff: number | null;
}

export interface ImpactEvent {
  id: string;
  sourceType: "SEO_FIX_PROPOSAL" | "GROWTH_DECISION";
  title: string;
  targetUrl?: string;
  targetKeyword?: string;
  dispatchedAt: Date;
  daysSinceDispatch: number;
  status: ImpactAttributionStatus;
  confidence: ImpactConfidence;
  attributionNote?: string;
  before: ImpactMetrics | null;
  after: ImpactMetrics | null;
  delta: ImpactDelta | null;
}

export interface ImpactSummary {
  siteId: string;
  totalFixesDispatched: number;
  totalMeasured: number;
  totalPendingAttribution: number;
  aggregateClickLiftPercent: number | null;
  aggregateImpressionLiftPercent: number | null;
  events: ImpactEvent[];
}

const ATTRIBUTION_WINDOW_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getImpactTimeline(siteId: string): Promise<ImpactSummary> {
  const now = new Date();

  const [proposals, decisions] = await Promise.all([
    prisma.seoFixProposal.findMany({
      where: {
        siteId,
        dispatchedAt: { not: null },
      },
      select: {
        id: true,
        issueLabel: true,
        filePath: true,
        dispatchedAt: true,
        deployedAt: true,
        prUrl: true,
      },
      orderBy: { dispatchedAt: "desc" },
      take: 50,
    }),
    prisma.growthDecision.findMany({
      where: {
        siteId,
        approvedAt: { not: null },
      },
      select: {
        id: true,
        action: true,
        url: true,
        primaryKeyword: true,
        approvedAt: true,
      },
      orderBy: { approvedAt: "desc" },
      take: 50,
    }),
  ]);

  const rawEvents: Array<{
    id: string;
    sourceType: "SEO_FIX_PROPOSAL" | "GROWTH_DECISION";
    title: string;
    targetUrl?: string;
    targetKeyword?: string;
    eventDate: Date;
  }> = [];

  for (const p of proposals) {
    if (!p.dispatchedAt) continue;
    rawEvents.push({
      id: p.id,
      sourceType: "SEO_FIX_PROPOSAL",
      title: p.issueLabel,
      targetUrl: p.filePath,
      eventDate: p.deployedAt ?? p.dispatchedAt,
    });
  }

  for (const d of decisions) {
    if (!d.approvedAt) continue;
    rawEvents.push({
      id: d.id,
      sourceType: "GROWTH_DECISION",
      title: d.action,
      targetUrl: d.url,
      targetKeyword: d.primaryKeyword,
      eventDate: d.approvedAt,
    });
  }

  rawEvents.sort((a, b) => b.eventDate.getTime() - a.eventDate.getTime());

  const earliestDate = rawEvents.length > 0
    ? new Date(rawEvents[rawEvents.length - 1].eventDate.getTime() - ATTRIBUTION_WINDOW_DAYS * MS_PER_DAY)
    : new Date(now.getTime() - 30 * MS_PER_DAY);

  const gscRows = await prisma.gscDailyPerformance.findMany({
    where: {
      siteId,
      date: { gte: formatDateStr(earliestDate) },
    },
    select: {
      url: true,
      keyword: true,
      date: true,
      clicks: true,
      impressions: true,
      position: true,
    },
  });

  const events: ImpactEvent[] = [];
  let measuredCount = 0;
  let pendingCount = 0;
  let totalClicksBefore = 0;
  let totalClicksAfter = 0;
  let totalImpressionsBefore = 0;
  let totalImpressionsAfter = 0;

  for (const raw of rawEvents) {
    const eventTime = raw.eventDate.getTime();
    const daysSinceDispatch = Math.max(0, Math.floor((now.getTime() - eventTime) / MS_PER_DAY));

    const beforeStart = new Date(eventTime - ATTRIBUTION_WINDOW_DAYS * MS_PER_DAY);
    const beforeEnd = raw.eventDate;
    const afterStart = raw.eventDate;
    const afterEnd = new Date(eventTime + ATTRIBUTION_WINDOW_DAYS * MS_PER_DAY);

    const beforeStartStr = formatDateStr(beforeStart);
    const beforeEndStr = formatDateStr(beforeEnd);
    const afterStartStr = formatDateStr(afterStart);
    const afterEndStr = formatDateStr(afterEnd);

    const matchesTarget = (r: typeof gscRows[number]) => {
      if (raw.targetUrl && r.url.includes(raw.targetUrl.replace(/^\/?/, ""))) return true;
      if (raw.targetKeyword && r.keyword.toLowerCase() === raw.targetKeyword.toLowerCase()) return true;
      return false;
    };

    const targetRows = gscRows.filter(matchesTarget);
    const rowsToUse = targetRows.length > 0 ? targetRows : gscRows;

    const beforeRows = rowsToUse.filter((r) => r.date >= beforeStartStr && r.date < beforeEndStr);
    const afterRows = rowsToUse.filter((r) => r.date >= afterStartStr && r.date <= afterEndStr);

    let status: ImpactAttributionStatus = "PENDING_ATTRIBUTION";
    let confidence: ImpactConfidence = "EVALUATING";
    let note: string | undefined;
    let beforeMetrics: ImpactMetrics | null = null;
    let afterMetrics: ImpactMetrics | null = null;
    let delta: ImpactDelta | null = null;

    if (daysSinceDispatch < ATTRIBUTION_WINDOW_DAYS) {
      status = "PENDING_ATTRIBUTION";
      confidence = "EVALUATING";
      note = `Search engine re-indexing & attribution requires ${ATTRIBUTION_WINDOW_DAYS}–28 days. Day ${daysSinceDispatch} of ${ATTRIBUTION_WINDOW_DAYS} elapsed.`;
      pendingCount += 1;
    } else if (beforeRows.length === 0 && afterRows.length === 0) {
      status = "INSUFFICIENT_DATA";
      confidence = "UNKNOWN";
      note = "Insufficient GSC performance records in attribution window to measure lift.";
    } else {
      status = "MEASURED";
      measuredCount += 1;

      const beforeClicks = beforeRows.reduce((sum, r) => sum + r.clicks, 0);
      const beforeImpressions = beforeRows.reduce((sum, r) => sum + r.impressions, 0);
      const beforePositions = beforeRows.map((r) => r.position).filter((p) => p > 0);
      const beforeAvgPos = beforePositions.length > 0
        ? Number((beforePositions.reduce((a, b) => a + b, 0) / beforePositions.length).toFixed(1))
        : null;

      const afterClicks = afterRows.reduce((sum, r) => sum + r.clicks, 0);
      const afterImpressions = afterRows.reduce((sum, r) => sum + r.impressions, 0);
      const afterPositions = afterRows.map((r) => r.position).filter((p) => p > 0);
      const afterAvgPos = afterPositions.length > 0
        ? Number((afterPositions.reduce((a, b) => a + b, 0) / afterPositions.length).toFixed(1))
        : null;

      beforeMetrics = {
        clicks: beforeClicks,
        impressions: beforeImpressions,
        avgPosition: beforeAvgPos,
        sampleDays: new Set(beforeRows.map((r) => r.date)).size,
      };

      afterMetrics = {
        clicks: afterClicks,
        impressions: afterImpressions,
        avgPosition: afterAvgPos,
        sampleDays: new Set(afterRows.map((r) => r.date)).size,
      };

      const clicksDiff = afterClicks - beforeClicks;
      const clicksLiftPercent = beforeClicks > 0
        ? Number(((clicksDiff / beforeClicks) * 100).toFixed(1))
        : null;

      const impressionsDiff = afterImpressions - beforeImpressions;
      const impressionsLiftPercent = beforeImpressions > 0
        ? Number(((impressionsDiff / beforeImpressions) * 100).toFixed(1))
        : null;

      const positionDiff = beforeAvgPos != null && afterAvgPos != null
        ? Number((beforeAvgPos - afterAvgPos).toFixed(1))
        : null;

      delta = {
        clicksDiff,
        clicksLiftPercent,
        impressionsDiff,
        impressionsLiftPercent,
        positionDiff,
      };

      confidence = (beforeMetrics.sampleDays >= 10 && afterMetrics.sampleDays >= 10)
        ? "HIGH"
        : "MEDIUM";

      totalClicksBefore += beforeClicks;
      totalClicksAfter += afterClicks;
      totalImpressionsBefore += beforeImpressions;
      totalImpressionsAfter += afterImpressions;
    }

    events.push({
      id: raw.id,
      sourceType: raw.sourceType,
      title: raw.title,
      targetUrl: raw.targetUrl,
      targetKeyword: raw.targetKeyword,
      dispatchedAt: raw.eventDate,
      daysSinceDispatch,
      status,
      confidence,
      attributionNote: note,
      before: beforeMetrics,
      after: afterMetrics,
      delta,
    });
  }

  const aggregateClickLiftPercent = totalClicksBefore > 0
    ? Number((((totalClicksAfter - totalClicksBefore) / totalClicksBefore) * 100).toFixed(1))
    : null;

  const aggregateImpressionLiftPercent = totalImpressionsBefore > 0
    ? Number((((totalImpressionsAfter - totalImpressionsBefore) / totalImpressionsBefore) * 100).toFixed(1))
    : null;

  logger.info("[ImpactTimeline] Computed impact summary", {
    siteId,
    totalFixes: rawEvents.length,
    measuredCount,
    pendingCount,
  });

  return {
    siteId,
    totalFixesDispatched: rawEvents.length,
    totalMeasured: measuredCount,
    totalPendingAttribution: pendingCount,
    aggregateClickLiftPercent,
    aggregateImpressionLiftPercent,
    events,
  };
}
