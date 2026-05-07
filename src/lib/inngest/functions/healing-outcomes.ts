import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

type OutcomeStatus = "improved" | "neutral" | "degraded";

function computeOutcome(impactScore: number): OutcomeStatus {
    if (impactScore > 0.05) return "improved";
    if (impactScore < -0.05) return "degraded";
    return "neutral";
}

export const measureHealingOutcomesJob = inngest.createFunction(
    {
        id: "measure-healing-outcomes",
        name: "Daily Healing Outcome Measurement",
        retries: 1,
        concurrency: { limit: 1 }, // cron — only one run at a time
    
        triggers: [{ cron: "0 4 * * *" }],
    },
    // 4am UTC daily
    async ({ step }) => {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Find outcomes that were applied 30+ days ago but never measured
        // NOTE: only return plain IDs — Inngest JSON-serializes step.run returns
        // which strips Prisma relation types from the result.
        const pendingIds = await step.run("find-pending-outcomes", async () => {
            const rows = await prisma.healingOutcome.findMany({
                where: {
                    measuredAt: null,
                    fixAppliedAt: { lte: thirtyDaysAgo },
                },
                select: { id: true },
                take: 50,
            });
            return rows.map((r) => r.id);
        });

        logger.info(`[HealingOutcome] Measuring ${pendingIds.length} pending outcomes`);
        let measured = 0;

        for (const outcomeId of pendingIds) {
            await step.run(`measure-${outcomeId}`, async () => {
                // Re-fetch inside the step so Inngest serialization doesn't strip relations
                const outcome = await prisma.healingOutcome.findUnique({
                    where: { id: outcomeId },
                    include: {
                        site: {
                            select: {
                                id: true,
                                domain: true,
                                userId: true,
                                user: { select: { gscConnected: true } },
                            },
                        },
                    },
                });

                if (!outcome) return;

                try {
                    // gscConnected lives on User, not Site
                    if (!outcome.site.user.gscConnected) {
                        await prisma.healingOutcome.update({
                            where: { id: outcome.id },
                            data: { measuredAt: new Date(), outcome: "neutral", impactScore: 0 },
                        });
                        return;
                    }

                    // Get the Google OAuth access token for this user
                    const account = await prisma.account.findFirst({
                        where: { userId: outcome.site.userId, provider: "google" },
                        select: { access_token: true },
                    });

                    if (!account?.access_token) {
                        await prisma.healingOutcome.update({
                            where: { id: outcome.id },
                            data: { measuredAt: new Date(), outcome: "neutral", impactScore: 0 },
                        });
                        return;
                    }

                    const { fetchGSCKeywordsByDateRange, normaliseSiteUrl } = await import("@/lib/gsc");
                    const siteUrl = normaliseSiteUrl(outcome.site.domain);

                    const beforeStart = new Date(outcome.fixAppliedAt);
                    beforeStart.setDate(beforeStart.getDate() - 30);
                    const beforeEnd = new Date(outcome.fixAppliedAt);
                    beforeEnd.setDate(beforeEnd.getDate() - 1);
                    const afterStart = new Date(outcome.fixAppliedAt);
                    afterStart.setDate(afterStart.getDate() + 1);
                    const afterEnd = new Date();

                    const [beforeRows, afterRows] = await Promise.allSettled([
                        fetchGSCKeywordsByDateRange(account.access_token, siteUrl, beforeStart, beforeEnd),
                        fetchGSCKeywordsByDateRange(account.access_token, siteUrl, afterStart, afterEnd),
                    ]);

                    const sum = (rows: typeof beforeRows) =>
                        rows.status === "fulfilled"
                            ? rows.value.reduce((acc, r) => ({ clicks: acc.clicks + r.clicks, pos: acc.pos + r.position }), { clicks: 0, pos: 0 })
                            : { clicks: 0, pos: 0 };

                    const bSums = sum(beforeRows);
                    const aSums = sum(afterRows);
                    const bLen = beforeRows.status === "fulfilled" ? beforeRows.value.length : 0;
                    const aLen = afterRows.status === "fulfilled" ? afterRows.value.length : 0;

                    const clicksBefore = bSums.clicks;
                    const clicksAfter = aSums.clicks;
                    const rankBefore = bLen > 0 ? parseFloat((bSums.pos / bLen).toFixed(2)) : null;
                    const rankAfter = aLen > 0 ? parseFloat((aSums.pos / aLen).toFixed(2)) : null;
                    const impactScore = clicksBefore > 0 ? (clicksAfter - clicksBefore) / clicksBefore : 0;

                    await prisma.healingOutcome.update({
                        where: { id: outcome.id },
                        data: {
                            measuredAt: new Date(),
                            trafficBefore: clicksBefore,
                            trafficAfter: clicksAfter,
                            rankBefore,
                            rankAfter,
                            impactScore,
                            outcome: computeOutcome(impactScore),
                        },
                    });
                    measured++;
                } catch (e: unknown) {
                    logger.warn(`[HealingOutcome] Failed to measure outcome ${outcomeId}`, {
                        error: (e as Error)?.message,
                    });
                }
            });
        }

        return { measured, total: pendingIds.length };
    }
);

/** Record a new HealingOutcome when a self-healing fix is applied */
export async function recordHealingOutcome(params: {
    siteId: string;
    healingLogId: string;
    issueType: string;
}): Promise<void> {
    try {
        await prisma.healingOutcome.upsert({
            where: { healingLogId: params.healingLogId },
            create: {
                siteId: params.siteId,
                healingLogId: params.healingLogId,
                issueType: params.issueType,
                fixAppliedAt: new Date(),
            },
            update: {},
        });
    } catch {
        
    }
}