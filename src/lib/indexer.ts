import { prisma } from "@/lib/prisma";
import { pingGoogleIndexingApi } from "@/lib/gsc/indexing";
import { logger, formatError } from "@/lib/logger";
import { submitToAllIndexNow } from "@/lib/indexnow";

const DAILY_QUOTA = 200;

export type IndexTrigger = "BLOG_PUBLISHED" | "AUDIT_FIX" | "MANUAL" | "CRON";

export interface IndexResult {
    success: boolean;
    skipped?: boolean;
    reason?: string;
    logId?: string;
}

async function getTodayUsage(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    return prisma.indexingLog.count({
        where: {
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
        const usage = await getTodayUsage();
        if (usage >= DAILY_QUOTA) {
            logger.warn("[indexer] Daily quota reached, skipping URL", {
                url,
                quota: DAILY_QUOTA,
                usage,
            });
            await prisma.indexingLog.create({
                data: {
                    siteId,
                    url,
                    status: "SKIPPED",
                    trigger,
                    errorMsg: `Daily quota of ${DAILY_QUOTA} URLs reached`,
                },
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

        await prisma.indexingLog.update({
            where: { id: log.id },
            data: {
                status: result.success ? "SUCCESS" : "FAILED",
                errorMsg: result.success ? null : result.message,
            },
        });

        if (!result.success) {
            logger.error("[indexer] Google Indexing API submission failed", {
                url,
                error: result.message,
            });
        }

        const indexNowKey = process.env.INDEXNOW_API_KEY;
        const indexNowHost = process.env.INDEXNOW_HOST;

        if (indexNowKey && indexNowHost && result.success) {
            const indexNowResults = await submitToAllIndexNow(indexNowHost, indexNowKey, [url]);
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

        return {
            success: result.success,
            logId: log.id,
            reason: result.success ? undefined : result.message,
        };
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
        const result = await submitUrlForIndexing(siteId, url, trigger, userId);

        submitted++;

        if (result.skipped && result.reason === "Daily quota reached") {
            skipped += urls.length - i;
            break;
        }

        if (result.skipped) {
            skipped++;
            continue;
        }

        if (result.success) succeeded++;
        else failed++;

        await new Promise((r) => setTimeout(r, 300));
    }

    return { submitted, succeeded, failed, skipped };
}