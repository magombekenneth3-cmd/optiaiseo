import { getUserGscToken } from "@/lib/gsc/token";
import { fetchGSCKeywords } from "@/lib/gsc";
import { getAuthorizedGscProperty } from "@/lib/gsc/property-resolver";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { GscPageMetric } from "./types";
import { classifyGscError, logGscFailure } from "@/lib/gsc/gsc-availability";
import type { GscDataStatus } from "@/lib/gsc/gsc-availability";

// Require at least seven recent, usable days before preferring persisted history.
const MIN_DB_DAYS_FOR_PRIMARY = 7;
const GSC_REPORTING_LAG_DAYS = 3;
const EVIDENCE_WINDOW_DAYS = 90;

export type OpportunityGscEvidenceStatus =
    | "AVAILABLE"
    | "NO_DATA"
    | "STALE"
    | "SITE_NOT_FOUND"
    | "SOURCE_ERROR"
    | Exclude<GscDataStatus, "AVAILABLE" | "NO_DATA">;

export type OpportunityGscEvidenceResult =
    | {
          status: "AVAILABLE" | "NO_DATA";
          data: GscPageMetric[];
          source: "PERSISTED_DB" | "LIVE_GSC";
          observedAt: string | null;
          dateRange: { from: string; to: string };
      }
    | {
          status: Exclude<OpportunityGscEvidenceStatus, "AVAILABLE" | "NO_DATA">;
          data: null;
          source: "NONE";
          observedAt: null;
          dateRange: null;
          fallbackStatus?: Exclude<GscDataStatus, "AVAILABLE" | "NO_DATA">;
          detail?: string;
      };

interface PersistedHistory {
    recentDistinctDays: number;
    latestRecentDate: string | null;
    hasAnyRows: boolean;
}

function evidenceDateRange() {
    return {
        from: dateDaysAgo(EVIDENCE_WINDOW_DAYS + GSC_REPORTING_LAG_DAYS - 1),
        to: dateDaysAgo(GSC_REPORTING_LAG_DAYS),
    };
}

function unavailableResult(
    status: Exclude<OpportunityGscEvidenceStatus, "AVAILABLE" | "NO_DATA">,
    detail?: string,
    fallbackStatus?: Exclude<GscDataStatus, "AVAILABLE" | "NO_DATA">,
): OpportunityGscEvidenceResult {
    return {
        status,
        data: null,
        source: "NONE",
        observedAt: null,
        dateRange: null,
        ...(fallbackStatus ? { fallbackStatus } : {}),
        ...(detail ? { detail } : {}),
    };
}

function availableResult(
    data: GscPageMetric[],
    source: "PERSISTED_DB" | "LIVE_GSC",
    observedAt: string | null,
): OpportunityGscEvidenceResult {
    return {
        status: data.length > 0 ? "AVAILABLE" : "NO_DATA",
        data,
        source,
        observedAt,
        dateRange: evidenceDateRange(),
    };
}

async function getPersistedHistory(siteId: string): Promise<PersistedHistory> {
    const { from, to } = evidenceDateRange();
    const [recentDays, anyRow] = await Promise.all([
        prisma.gscDailyPerformance.findMany({
            where: { siteId, date: { gte: from, lte: to } },
            select: { date: true },
            distinct: ["date"],
            orderBy: { date: "desc" },
            take: 100,
        }),
        prisma.gscDailyPerformance.findFirst({
            where: { siteId },
            select: { date: true },
            orderBy: { date: "desc" },
        }),
    ]);

    return {
        recentDistinctDays: recentDays.length,
        latestRecentDate: recentDays[0]?.date ?? null,
        hasAnyRows: Boolean(anyRow),
    };
}

/**
 * Returns explicit data-availability semantics to decision pipelines.
 * A disconnected/failed/stale provider is never represented as an authoritative empty array.
 */
export async function fetchGscEvidenceResult(
    siteId: string,
): Promise<OpportunityGscEvidenceResult> {
    let site: { id: string; domain: string; userId: string } | null;
    try {
        site = await prisma.site.findUnique({
            where: { id: siteId },
            select: { id: true, domain: true, userId: true },
        });
    } catch (err: unknown) {
        logger.error("[EvidenceProvider] Site lookup failed", {
            siteId,
            error: (err as Error)?.message || String(err),
        });
        return unavailableResult("SOURCE_ERROR", "Unable to load the site's GSC evidence configuration.");
    }

    if (!site) return unavailableResult("SITE_NOT_FOUND", "The requested site no longer exists.");

    let history: PersistedHistory;
    try {
        history = await getPersistedHistory(siteId);
    } catch (err: unknown) {
        logger.error("[EvidenceProvider] Persisted GSC history lookup failed", {
            siteId,
            error: (err as Error)?.message || String(err),
        });
        return unavailableResult("SOURCE_ERROR", "Unable to read persisted GSC history.");
    }

    if (history.recentDistinctDays >= MIN_DB_DAYS_FOR_PRIMARY) {
        try {
            const data = await fetchEvidenceFromDb(siteId);
            logger.info("[EvidenceProvider] Using recent persisted GSC history", {
                siteId: "redacted",
                recentDistinctDays: history.recentDistinctDays,
                rows: data.length,
            });
            return availableResult(data, "PERSISTED_DB", history.latestRecentDate);
        } catch (err: unknown) {
            logger.error("[EvidenceProvider] Persisted GSC aggregation failed", {
                siteId,
                error: (err as Error)?.message || String(err),
            });
            return unavailableResult("SOURCE_ERROR", "Persisted GSC rows could not be aggregated safely.");
        }
    }

    logger.info("[EvidenceProvider] Recent GSC history below threshold; trying live API", {
        siteId,
        recentDistinctDays: history.recentDistinctDays,
        threshold: MIN_DB_DAYS_FOR_PRIMARY,
    });

    try {
        const data = await fetchEvidenceFromLiveApi(site);
        return availableResult(data, "LIVE_GSC", new Date().toISOString());
    } catch (err: unknown) {
        const failureStatus = classifyGscError(err);
        logGscFailure("EvidenceProvider.liveApi", failureStatus, {
            siteId,
            phase: "fetch",
            error: (err as Error)?.message || String(err),
        });

        if (history.hasAnyRows) {
            return unavailableResult(
                "STALE",
                "Stored GSC history is too old to use, and refreshing it failed.",
                failureStatus,
            );
        }

        return unavailableResult(failureStatus, "GSC could not provide current evidence.");
    }
}

/**
 * Backwards-compatible adapter for existing non-decision consumers.
 * New decision paths should consume fetchGscEvidenceResult() and check status.
 */
export async function fetchGscEvidence(siteId: string): Promise<GscPageMetric[]> {
    const result = await fetchGscEvidenceResult(siteId);
    return result.data ?? [];
}

// ────────────────────────────────────────────────────────────────────────────
// DB-backed evidence (primary path)
// ────────────────────────────────────────────────────────────────────────────

function dateDaysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split("T")[0];
}

async function fetchEvidenceFromDb(siteId: string): Promise<GscPageMetric[]> {
    const recentStart = dateDaysAgo(EVIDENCE_WINDOW_DAYS + GSC_REPORTING_LAG_DAYS - 1);
    const recentEnd = dateDaysAgo(GSC_REPORTING_LAG_DAYS);
    const previousStart = dateDaysAgo((EVIDENCE_WINDOW_DAYS * 2) + GSC_REPORTING_LAG_DAYS - 1);
    const previousEnd = recentStart;

    // Recent 90 days: aggregated by URL
    const recentRows = await prisma.gscDailyPerformance.groupBy({
        by: ["url", "keyword"],
        where: {
            siteId,
            date: { gte: recentStart, lte: recentEnd },
            device: "ALL",
        },
        _sum: { clicks: true, impressions: true },
        _avg: { position: true },
    });

    // Previous 90 days: for comparison (previousPosition, previousClicks)
    const previousRows = await prisma.gscDailyPerformance.groupBy({
        by: ["url", "keyword"],
        where: {
            siteId,
            date: { gte: previousStart, lt: previousEnd },
            device: "ALL",
        },
        _sum: { clicks: true, impressions: true },
        _avg: { position: true },
    });

    // Build previous-period lookup map: URL → { clicks, impressions, position }
    const prevMap = new Map<string, { clicks: number; impressions: number; position: number }>();
    for (const row of previousRows) {
        const url = row.url.split("?")[0].replace(/\/$/, "");
        const existing = prevMap.get(url);
        const rowClicks = row._sum.clicks ?? 0;
        const rowImpressions = row._sum.impressions ?? 0;
        const rowPosition = row._avg.position ?? 0;

        if (!existing || rowImpressions > existing.impressions) {
            prevMap.set(url, {
                clicks: (existing?.clicks ?? 0) + rowClicks,
                impressions: (existing?.impressions ?? 0) + rowImpressions,
                position: rowPosition, // Use the position of the highest-impression keyword
            });
        } else {
            prevMap.set(url, {
                clicks: existing.clicks + rowClicks,
                impressions: existing.impressions + rowImpressions,
                position: existing.position,
            });
        }
    }

    // Aggregate recent rows by URL (same logic as original, but with previous data)
    const urlMap = new Map<string, {
        url: string;
        keyword: string;
        clicks: number;
        impressions: number;
        positionSum: number;
        count: number;
        maxImpressionKeyword: string;
        maxImpressionValue: number;
    }>();

    for (const row of recentRows) {
        const cleanUrl = row.url.split("?")[0].replace(/\/$/, "");
        const rowClicks = row._sum.clicks ?? 0;
        const rowImpressions = row._sum.impressions ?? 0;
        const rowPosition = row._avg.position ?? 0;

        const existing = urlMap.get(cleanUrl) || {
            url: cleanUrl,
            keyword: row.keyword,
            clicks: 0,
            impressions: 0,
            positionSum: 0,
            count: 0,
            maxImpressionKeyword: row.keyword,
            maxImpressionValue: 0,
        };

        existing.clicks += rowClicks;
        existing.impressions += rowImpressions;
        existing.positionSum += rowPosition * rowImpressions;
        existing.count += rowImpressions;

        // Keep highest impression keyword as primary keyword
        if (rowImpressions > existing.maxImpressionValue) {
            existing.maxImpressionKeyword = row.keyword;
            existing.maxImpressionValue = rowImpressions;
        }

        urlMap.set(cleanUrl, existing);
    }

    const metrics: GscPageMetric[] = [];
    for (const entry of urlMap.values()) {
        const avgPosition = entry.count > 0
            ? parseFloat((entry.positionSum / entry.count).toFixed(1))
            : 0;
        const prev = prevMap.get(entry.url);

        metrics.push({
            url: entry.url,
            keyword: entry.maxImpressionKeyword,
            clicks: entry.clicks,
            impressions: entry.impressions,
            position: avgPosition,
            previousPosition: prev?.position,
            previousClicks: prev?.clicks,
        });
    }

    logger.info("[EvidenceProvider] Loaded evidence from persistent DB", {
        siteId: "redacted",
        urlCount: metrics.length,
        withPreviousData: metrics.filter(m => m.previousPosition !== undefined).length,
    });

    return metrics;
}

// ────────────────────────────────────────────────────────────────────────────
// Live GSC API fallback (original behavior for fresh installations)
// ────────────────────────────────────────────────────────────────────────────

async function fetchEvidenceFromLiveApi(
    site: { id: string; domain: string; userId: string }
): Promise<GscPageMetric[]> {
    const accessToken = await getUserGscToken(site.userId);
    const siteUrl = await getAuthorizedGscProperty(site.userId, accessToken, site.domain);
    const keywordRows = await fetchGSCKeywords(accessToken, siteUrl, 90, 3600);

    // Aggregate by URL (preserved from original implementation)
    const urlMap = new Map<string, {
        url: string;
        keyword: string;
        clicks: number;
        impressions: number;
        positionSum: number;
        count: number;
    }>();

    for (const row of keywordRows) {
        const cleanUrl = row.url.split("?")[0].replace(/\/$/, "");
        const existing = urlMap.get(cleanUrl) || {
            url: cleanUrl,
            keyword: row.keyword,
            clicks: 0,
            impressions: 0,
            positionSum: 0,
            count: 0
        };

        existing.clicks += row.clicks;
        existing.impressions += row.impressions;
        existing.positionSum += row.position * row.impressions;
        existing.count += row.impressions;

        // Keep highest impression keyword as primary keyword
        if (row.impressions > (existing.impressions - row.impressions)) {
            existing.keyword = row.keyword;
        }

        urlMap.set(cleanUrl, existing);
    }

    const metrics: GscPageMetric[] = [];
    for (const entry of urlMap.values()) {
        const avgPosition = entry.count > 0 ? parseFloat((entry.positionSum / entry.count).toFixed(1)) : 0;
        metrics.push({
            url: entry.url,
            keyword: entry.keyword,
            clicks: entry.clicks,
            impressions: entry.impressions,
            position: avgPosition,
            // No previousPosition/previousClicks available in live API mode
        });
    }

    return metrics;
}
