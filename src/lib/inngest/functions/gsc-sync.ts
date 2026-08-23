/**
 * GSC Daily Performance Sync — Inngest cron + per-site handler.
 *
 * Runs daily at 04:30 UTC (after the existing rank tracker at 04:00).
 * Fetches yesterday's GSC data (accounting for the 3-day reporting lag)
 * and persists it into the GscDailyPerformance table.
 *
 * Fan-out pattern: the cron fetches GSC-connected paid sites, then sends
 * per-site events processed by gscSyncSite with its own concurrency + retry.
 *
 * Data retention: a monthly purge job removes rows older than RETENTION_DAYS.
 */

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { getUserGscToken } from "@/lib/gsc/token";
import { fetchGSCKeywordsByDateRange, normaliseSiteUrl } from "@/lib/gsc";
import { logger } from "@/lib/logger";

const MIN_IMPRESSIONS_THRESHOLD = 5;
const RETENTION_DAYS = 400;
const GSC_LAG_DAYS = 3;
const BATCH_SIZE = 500;

// ────────────────────────────────────────────────────────────────────────────
// 1. Cron: Fan-out to all GSC-connected paid sites
// ────────────────────────────────────────────────────────────────────────────

export const cronDailyGscSync = inngest.createFunction(
    {
        id: "cron-daily-gsc-sync",
        name: "Cron: Daily GSC Performance Sync",
        retries: 0,
        triggers: [{ cron: "30 4 * * *" }],
    },
    async ({ step }) => {
        const sites = await step.run("fetch-gsc-connected-sites", () =>
            prisma.site.findMany({
                where: {
                    user: {
                        gscConnected: true,
                        subscriptionTier: { in: ["STARTER", "PRO", "AGENCY"] },
                    },
                },
                select: { id: true, domain: true, userId: true },
            })
        );

        if (sites.length === 0) {
            logger.info("[GscSync] No GSC-connected paid sites — skipping");
            return { queued: 0 };
        }

        await step.sendEvent(
            "fan-out-gsc-sync",
            sites.map((s) => ({
                name: "gsc.sync.site" as const,
                data: { siteId: s.id, domain: s.domain, userId: s.userId },
            }))
        );

        logger.info(`[GscSync] Queued ${sites.length} sites for GSC sync`);
        return { queued: sites.length };
    }
);

// ────────────────────────────────────────────────────────────────────────────
// 2. Per-site handler: fetch yesterday's GSC data and persist
// ────────────────────────────────────────────────────────────────────────────

export const gscSyncSite = inngest.createFunction(
    {
        id: "gsc-sync-site",
        name: "GSC Sync: Per-Site Handler",
        retries: 2,
        concurrency: [{ limit: 3 }], // Avoid hammering GSC API
        triggers: [{ event: "gsc.sync.site" }],
    },
    async ({ event, step }) => {
        const { siteId, domain, userId } = event.data as {
            siteId: string;
            domain: string;
            userId: string;
        };

        // Step 1: Acquire GSC access token
        const accessToken = await step.run("get-gsc-token", async () => {
            try {
                return await getUserGscToken(userId);
            } catch (err: unknown) {
                logger.warn("[GscSync] No GSC token available", {
                    siteId,
                    error: (err as Error)?.message,
                });
                return null;
            }
        });

        if (!accessToken) {
            return { siteId, synced: 0, status: "NO_TOKEN" };
        }

        // Step 2: Fetch yesterday's data (accounting for GSC reporting lag)
        const rows = await step.run("fetch-gsc-data", async () => {
            const siteUrl = normaliseSiteUrl(domain);

            // GSC data is delayed by ~3 days. Fetch the most recent reliable day.
            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() - GSC_LAG_DAYS);
            const startDate = new Date(targetDate);
            const endDate = new Date(targetDate);

            const data = await fetchGSCKeywordsByDateRange(
                accessToken,
                siteUrl,
                startDate,
                endDate,
                { dataState: "final" }
            );

            return data
                .filter((row) => row.impressions >= MIN_IMPRESSIONS_THRESHOLD)
                .map((row) => ({
                    url: row.url,
                    keyword: row.keyword,
                    clicks: row.clicks,
                    impressions: row.impressions,
                    ctr: row.ctr,
                    position: row.position,
                }));
        });

        if (!rows || rows.length === 0) {
            logger.info("[GscSync] No rows above threshold", { siteId });
            return { siteId, synced: 0, status: "NO_DATA" };
        }

        // Step 3: Persist into GscDailyPerformance
        const synced = await step.run("persist-gsc-data", async () => {
            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() - GSC_LAG_DAYS);
            const dateStr = targetDate.toISOString().split("T")[0]; // YYYY-MM-DD

            let totalInserted = 0;

            // Batch insert with skipDuplicates for idempotent re-runs
            for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                const batch = rows.slice(i, i + BATCH_SIZE);

                const result = await prisma.gscDailyPerformance.createMany({
                    data: batch.map((row) => ({
                        siteId,
                        url: row.url,
                        keyword: row.keyword,
                        date: dateStr,
                        clicks: row.clicks,
                        impressions: row.impressions,
                        ctr: row.ctr,
                        position: row.position,
                        device: "ALL",
                    })),
                    skipDuplicates: true,
                });

                totalInserted += result.count;
            }

            return totalInserted;
        });

        logger.info("[GscSync] Completed site sync", {
            siteId,
            domain,
            synced,
        });

        return { siteId, synced, status: "COMPLETED" };
    }
);

// ────────────────────────────────────────────────────────────────────────────
// 3. Monthly purge: remove rows older than RETENTION_DAYS
// ────────────────────────────────────────────────────────────────────────────

export const cronGscDataPurge = inngest.createFunction(
    {
        id: "cron-gsc-data-purge",
        name: "Cron: GSC Performance Data Purge",
        retries: 2,
        triggers: [{ cron: "0 3 1 * *" }], // 1st of each month at 03:00 UTC
    },
    async ({ step }) => {
        const deleted = await step.run("purge-old-gsc-data", async () => {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
            const cutoffStr = cutoff.toISOString().split("T")[0];

            const result = await prisma.gscDailyPerformance.deleteMany({
                where: { date: { lt: cutoffStr } },
            });

            return result.count;
        });

        logger.info("[GscSync] Purged old performance data", { deleted });
        return { deleted };
    }
);
