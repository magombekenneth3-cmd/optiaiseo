import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface GscHealthStatus {
    siteId: string;
    lastSyncDate: string | null;
    daysSinceSync: number;
    totalDaysTracked: number;
    missingDaysLast30: number;
    dataFreshness: "fresh" | "stale" | "missing";
    healthLabel: string;
    alerts: GscAlert[];
}

export interface GscAlert {
    severity: "warning" | "critical";
    message: string;
    suggestion: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Core: Check GSC data health for a site
// ────────────────────────────────────────────────────────────────────────────

export async function getGscHealthStatus(siteId: string): Promise<GscHealthStatus> {
    const alerts: GscAlert[] = [];

    try {
        // Get the most recent data point
        const latestRow = await prisma.gscDailyPerformance.findFirst({
            where: { siteId, device: "ALL" },
            orderBy: { date: "desc" },
            select: { date: true },
        });

        if (!latestRow) {
            return {
                siteId,
                lastSyncDate: null,
                daysSinceSync: -1,
                totalDaysTracked: 0,
                missingDaysLast30: 30,
                dataFreshness: "missing",
                healthLabel: "No GSC data found — connect Google Search Console",
                alerts: [{
                    severity: "critical",
                    message: "No Google Search Console data available",
                    suggestion: "Connect your site to Google Search Console in Settings",
                }],
            };
        }

        const lastDate = new Date(latestRow.date + "T00:00:00Z");
        const now = new Date();
        const daysSinceSync = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

        // Count distinct days in last 30 days
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const distinctDays = await prisma.gscDailyPerformance.groupBy({
            by: ["date"],
            where: {
                siteId,
                device: "ALL",
                date: { gte: thirtyDaysAgo.toISOString().split("T")[0] },
            },
        });

        const totalDaysTracked = distinctDays.length;
        const missingDaysLast30 = 30 - totalDaysTracked;

        // Determine freshness
        // Note: GSC data has a natural 2-3 day delay from Google
        let dataFreshness: "fresh" | "stale" | "missing";
        let healthLabel: string;

        if (daysSinceSync <= 4) {
            dataFreshness = "fresh";
            healthLabel = `GSC data up to date (last sync: ${latestRow.date})`;
        } else if (daysSinceSync <= 7) {
            dataFreshness = "stale";
            healthLabel = `GSC data is ${daysSinceSync} days old — may need attention`;
            alerts.push({
                severity: "warning",
                message: `GSC data gap: last data point is ${daysSinceSync} days ago`,
                suggestion: "Check if the daily GSC sync cron is running. GSC normally has a 2-3 day delay.",
            });
        } else {
            dataFreshness = "stale";
            healthLabel = `GSC data is ${daysSinceSync} days old — sync appears broken`;
            alerts.push({
                severity: "critical",
                message: `GSC data gap: last data point is ${daysSinceSync} days ago`,
                suggestion: "The GSC sync may have stopped. Check cron logs and GSC API credentials.",
            });
        }

        // Check for gaps in the last 30 days
        if (missingDaysLast30 > 10 && totalDaysTracked > 0) {
            alerts.push({
                severity: "warning",
                message: `${missingDaysLast30} missing days in the last 30-day window`,
                suggestion: "Missing data may affect experiment baseline accuracy. Consider a GSC backfill.",
            });
        }

        return {
            siteId,
            lastSyncDate: latestRow.date,
            daysSinceSync,
            totalDaysTracked,
            missingDaysLast30,
            dataFreshness,
            healthLabel,
            alerts,
        };
    } catch (err: unknown) {
        logger.error("[GscHealthMonitor] Failed to check health", {
            siteId, error: (err as Error)?.message,
        });
        return {
            siteId,
            lastSyncDate: null,
            daysSinceSync: -1,
            totalDaysTracked: 0,
            missingDaysLast30: 30,
            dataFreshness: "missing",
            healthLabel: "Unable to check GSC data health",
            alerts: [{
                severity: "critical",
                message: "GSC health check failed",
                suggestion: "Check database connectivity",
            }],
        };
    }
}
