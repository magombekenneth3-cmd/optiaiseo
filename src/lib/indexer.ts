import { prisma } from "@/lib/prisma";
import { pingGoogleIndexingApi } from "@/lib/gsc/indexing";
import { logger, formatError } from "@/lib/logger";
import { submitToAllIndexNow } from "@/lib/indexnow";
import { getIndexNowConfig } from "@/lib/indexnow-config";

const DAILY_QUOTA = 200;
const MAX_RETRY_ATTEMPTS = 4;
const RETRY_BACKOFF_BASE_MS = 60_000;

export type IndexTrigger = "BLOG_PUBLISHED" | "AUDIT_FIX" | "MANUAL" | "CRON" | "FACT_EXTRACTED";

export interface IndexResult {
    success: boolean;
    skipped?: boolean;
    reason?: string;
    logId?: string;
}

function retryDelayMs(attempt: number): number {
    return RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 10_000);
}

async function getSiteDailyUsage(siteId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    return prisma.indexingLog.count({
        where: {
            siteId,
            createdAt: { gte: startOfDay },
            status: { not: "SKIPPED" },
        },
    });
}

export async function submitUrlForIndexing(
    siteId: string,
    url: string,
    trigger: IndexTrigger,
    userId: string
): Promise<IndexResult> {
    try {
        const usage = await getSiteDailyUsage(siteId);
        if (usage >= DAILY_QUOTA) {
            logger.warn("[indexer] Daily quota reached, skipping URL", { siteId, url, quota: DAILY_QUOTA, usage });
            await prisma.indexingLog.create({
                data: { siteId, url, status: "SKIPPED", trigger, errorMsg: `Daily quota of ${DAILY_QUOTA} URLs reached` },
            });
            return { success: false, skipped: true, reason: "Daily quota reached" };
        }

        const recentLog = await prisma.indexingLog.findFirst({
            where: {
                siteId,
                url,
                status: "SUCCESS",
                createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
        });
        if (recentLog) {
            return { success: true, skipped: true, reason: "Already submitted in last 24h" };
        }

        const log = await prisma.indexingLog.create({
            data: { siteId, url, status: "PENDING", trigger },
        });

        const result = await pingGoogleIndexingApi(url, "URL_UPDATED", userId);

        if (result.success) {
            await prisma.indexingLog.update({
                where: { id: log.id },
                data: { status: "SUCCESS", errorMsg: null, retryError: null },
            });
        } else {
            const isRateLimited = result.code === "RATE_LIMITED";
            const isPermanent   = result.code === "AUTH_FAILED" || result.code === "PERMISSION_DENIED" || result.code === "API_DISABLED";

            if (isPermanent) {
                await prisma.indexingLog.update({
                    where: { id: log.id },
                    data: { status: "FAILED", errorMsg: result.message, retryCount: MAX_RETRY_ATTEMPTS },
                });
            } else {
                const nextRetryAt = new Date(Date.now() + retryDelayMs(isRateLimited ? 2 : 0));
                await prisma.indexingLog.update({
                    where: { id: log.id },
                    data: {
                        status: "RETRY_PENDING",
                        retryCount: 1,
                        retryError: result.message,
                        nextRetryAt,
                    },
                });
                logger.info("[indexer] Scheduled retry", { logId: log.id, url, nextRetryAt, reason: result.message });
            }

            logger.error("[indexer] Google Indexing API submission failed", { url, code: result.code, error: result.message });
        }

        const indexNowCfg = await getIndexNowConfig(siteId).catch(() => null);
        if (indexNowCfg && result.success) {
            const indexNowResults = await submitToAllIndexNow(indexNowCfg.host, indexNowCfg.apiKey, [url]);
            await Promise.all(
                indexNowResults.map((r) =>
                    prisma.indexingLog.create({
                        data: {
                            siteId,
                            url,
                            status: r.success ? "SUCCESS" : "FAILED",
                            trigger,
                            engine: r.engine,
                            errorMsg: r.success ? null : r.message,
                        },
                    })
                )
            );
        }

        return { success: result.success, logId: log.id, reason: result.success ? undefined : result.message };
    } catch (err: unknown) {
        logger.error("[indexer] Unexpected error submitting URL", { url, error: formatError(err) });
        return { success: false, reason: (err as Error)?.message ?? "Unexpected indexer error" };
    }
}

export async function submitBatchForIndexing(
    siteId: string,
    urls: string[],
    trigger: IndexTrigger,
    userId: string
): Promise<{ submitted: number; succeeded: number; failed: number; skipped: number }> {
    let submitted = 0;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        if (!url) continue;
        const result = await submitUrlForIndexing(siteId, url, trigger, userId);
        submitted++;

        if (result.skipped && result.reason === "Daily quota reached") {
            skipped += urls.length - i;
            break;
        }

        if (result.skipped) { skipped++; continue; }
        if (result.success) succeeded++;
        else failed++;

        await new Promise((r) => setTimeout(r, 300));
    }

    return { submitted, succeeded, failed, skipped };
}

export async function drainRetryQueue(maxBatch = 50): Promise<{ retried: number; succeeded: number; failed: number; requeued: number }> {
    const now = new Date();
    let retried = 0;
    let succeeded = 0;
    let failed = 0;
    let requeued = 0;

    const pending = await prisma.indexingLog.findMany({
        where: {
            status: "RETRY_PENDING",
            retryCount: { lt: MAX_RETRY_ATTEMPTS },
            nextRetryAt: { lte: now },
        },
        orderBy: { nextRetryAt: "asc" },
        take: maxBatch,
        include: { site: { select: { userId: true } } },
    });

    for (const log of pending) {
        retried++;
        const userId = log.site.userId;
        const usage  = await getSiteDailyUsage(log.siteId);

        if (usage >= DAILY_QUOTA) {
            const nextRetryAt = new Date(Date.now() + 60 * 60 * 1000);
            await prisma.indexingLog.update({
                where: { id: log.id },
                data: { nextRetryAt, retryError: "Daily quota hit during retry" },
            });
            requeued++;
            continue;
        }

        const result = await pingGoogleIndexingApi(log.url, "URL_UPDATED", userId);

        if (result.success) {
            await prisma.indexingLog.update({
                where: { id: log.id },
                data: { status: "SUCCESS", errorMsg: null, retryError: null },
            });
            succeeded++;
        } else {
            const newRetryCount = log.retryCount + 1;
            const isPermanent = result.code === "AUTH_FAILED" || result.code === "PERMISSION_DENIED" || result.code === "API_DISABLED";
            const exhausted    = newRetryCount >= MAX_RETRY_ATTEMPTS;

            if (isPermanent || exhausted) {
                await prisma.indexingLog.update({
                    where: { id: log.id },
                    data: {
                        status: "FAILED",
                        retryCount: newRetryCount,
                        errorMsg: result.message,
                        retryError: `Exhausted after ${newRetryCount} attempts: ${result.message}`,
                        nextRetryAt: null,
                    },
                });
                failed++;
                logger.error("[indexer/retry] Permanently failed", {
                    logId: log.id, url: log.url, attempts: newRetryCount, code: result.code,
                });
            } else {
                const nextRetryAt = new Date(Date.now() + retryDelayMs(newRetryCount));
                await prisma.indexingLog.update({
                    where: { id: log.id },
                    data: { retryCount: newRetryCount, retryError: result.message, nextRetryAt },
                });
                requeued++;
                logger.info("[indexer/retry] Rescheduled", {
                    logId: log.id, url: log.url, attempt: newRetryCount, nextRetryAt,
                });
            }
        }

        await new Promise((r) => setTimeout(r, 300));
    }

    logger.info("[indexer/drainRetryQueue] Done", { retried, succeeded, failed, requeued });
    return { retried, succeeded, failed, requeued };
}