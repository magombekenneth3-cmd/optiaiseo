import { getUserGscToken } from "@/lib/gsc/token";
import { fetchGSCKeywords, normaliseSiteUrl } from "@/lib/gsc";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { GscPageMetric } from "./types";

// Minimum number of days of persisted data required before we trust the DB
// over the live API. Below this, a fresh install falls back to live GSC.
const MIN_DB_DAYS_FOR_PRIMARY = 7;

/**
 * Fetch GSC evidence for the opportunity pipeline.
 *
 * Primary path: reads from the persistent GscDailyPerformance table.
 * This provides previousPosition / previousClicks (90-day comparison)
 * which unlocks the DECLINING detector and improves scoring accuracy.
 *
 * Fallback path: if the DB has < 7 days of data (fresh install, new site),
 * falls back to the live GSC API (original behavior, no historical comparison).
 */
export async function fetchGscEvidence(siteId: string): Promise<GscPageMetric[]> {
    try {
        const site = await prisma.site.findUnique({
            where: { id: siteId },
            select: { id: true, domain: true, userId: true }
        });

        if (!site) return [];

        // Check if we have enough persisted data to use the DB path
        const dbDayCount = await getPersistedDayCount(siteId);

        if (dbDayCount >= MIN_DB_DAYS_FOR_PRIMARY) {
            return fetchEvidenceFromDb(siteId);
        }

        // Fallback: live GSC API (original behavior for fresh installs)
        logger.info("[EvidenceProvider] Insufficient DB history, falling back to live GSC API", {
            siteId, dbDayCount, threshold: MIN_DB_DAYS_FOR_PRIMARY,
        });
        return fetchEvidenceFromLiveApi(site);
    } catch (err: unknown) {
        logger.error("[EvidenceProvider] Failed to fetch GSC evidence", {
            siteId, error: (err as Error)?.message || String(err),
        });
        return [];
    }
}

// ────────────────────────────────────────────────────────────────────────────
// DB-backed evidence (primary path)
// ────────────────────────────────────────────────────────────────────────────

async function getPersistedDayCount(siteId: string): Promise<number> {
    try {
        const distinctDays = await prisma.gscDailyPerformance.findMany({
            where: { siteId },
            select: { date: true },
            distinct: ["date"],
            orderBy: { date: "desc" },
            take: 100,
        });
        return distinctDays.length;
    } catch {
        return 0;
    }
}

function dateDaysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split("T")[0];
}

async function fetchEvidenceFromDb(siteId: string): Promise<GscPageMetric[]> {
    const recentStart = dateDaysAgo(90);
    const previousStart = dateDaysAgo(180);
    const previousEnd = dateDaysAgo(91);

    // Recent 90 days: aggregated by URL
    const recentRows = await prisma.gscDailyPerformance.groupBy({
        by: ["url", "keyword"],
        where: {
            siteId,
            date: { gte: recentStart },
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
    if (!accessToken) {
        logger.info("[EvidenceProvider] No GSC access token found for site", { siteId: site.id });
        return [];
    }

    const siteUrl = normaliseSiteUrl(site.domain);
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
