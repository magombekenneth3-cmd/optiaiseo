import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { cleanupOrphanedRateLimitKeys } from "@/lib/rate-limit";


async function getPaidSites() {
    return prisma.site.findMany({
        where: { user: { subscriptionTier: { in: ["STARTER", "PRO", "AGENCY"] } } },
        select: { id: true, domain: true, userId: true },
    });
}

async function getBacklinkEligibleSites() {
    return prisma.site.findMany({
        where: { user: { subscriptionTier: { in: ["PRO", "AGENCY"] } } },
        select: { id: true, domain: true, userId: true },
    });
}


export const cronWeeklyAudit = inngest.createFunction(
    {
        id: "cron-weekly-audit",
        name: "Cron: Weekly Audit Fan-out",
        retries: 0,
        triggers: [{ cron: "0 2 * * 1" }],
    },
    async ({ step }) => {
        const sites = await step.run("fetch-paid-sites", getPaidSites);

        if (sites.length === 0) {
            logger.info("[CronWeeklyAudit] No paid sites — skipping fan-out");
            return { queued: 0 };
        }

        await step.sendEvent(
            "fan-out-audits",
            sites.map((s) => ({ name: "audit.run" as const, data: { siteId: s.id } })),
        );

        logger.info(`[CronWeeklyAudit] Queued ${sites.length} sites`);
        return { queued: sites.length };
    },
);


export const cronWeeklyBacklinks = inngest.createFunction(
    {
        id: "cron-weekly-backlinks",
        name: "Cron: Weekly Backlinks Fan-out",
        retries: 0,
        triggers: [{ cron: "0 3 * * 1" }],
    },
    async ({ step }) => {
        const sites = await step.run("fetch-backlink-sites", getBacklinkEligibleSites);

        if (sites.length === 0) {
            logger.info("[CronWeeklyBacklinks] No paid sites — skipping fan-out");
            return { queued: 0 };
        }

        await step.sendEvent(
            "fan-out-backlinks",
            sites.map((s) => ({
                name: "backlinks.check.site" as const,
                data: { siteId: s.id, domain: s.domain, userId: s.userId },
            })),
        );

        logger.info(`[CronWeeklyBacklinks] Queued ${sites.length} sites`);
        return { queued: sites.length };
    },
);


export const cronDailyRankTracker = inngest.createFunction(
    {
        id: "cron-daily-rank",
        name: "Cron: Daily Rank Tracker Fan-out",
        retries: 0,
        triggers: [{ cron: "0 4 * * *" }],
    },
    async ({ step }) => {
        const sites = await step.run("fetch-paid-sites", getPaidSites);

        if (sites.length === 0) {
            logger.info("[CronDailyRank] No paid sites — skipping fan-out");
            return { queued: 0 };
        }

        await step.sendEvent(
            "fan-out-rank",
            sites.map((s) => ({
                name: "rank.check" as const,
                data: { siteId: s.id, userId: s.userId },
            })),
        );

        logger.info(`[CronDailyRank] Queued ${sites.length} sites`);
        return { queued: sites.length };
    },
);


export const cronWeeklyAeo = inngest.createFunction(
    {
        id: "cron-weekly-aeo",
        name: "Cron: Weekly AEO Fan-out",
        retries: 0,
        triggers: [{ cron: "0 5 * * 1" }],
    },
    async ({ step }) => {
        const sites = await step.run("fetch-paid-sites", getPaidSites);

        if (sites.length === 0) {
            logger.info("[CronWeeklyAeo] No paid sites — skipping fan-out");
            return { queued: 0 };
        }

        await step.sendEvent(
            "fan-out-aeo",
            sites.map((s) => ({
                name: "aeo.check" as const,
                data: { siteId: s.id, userId: s.userId },
            })),
        );

        logger.info(`[CronWeeklyAeo] Queued ${sites.length} sites`);
        return { queued: sites.length };
    },
);


export const cronDailyBlog = inngest.createFunction(
    {
        id: "cron-daily-blog",
        name: "Cron: Daily Blog Automation Fan-out",
        retries: 0,
        triggers: [{ cron: "0 6 * * *" }],
    },
    async ({ step }) => {
        const sites = await step.run("fetch-paid-sites", getPaidSites);

        if (sites.length === 0) {
            logger.info("[CronDailyBlog] No paid sites — skipping fan-out");
            return { queued: 0 };
        }

        await step.sendEvent(
            "fan-out-blog",
            sites.map((s) => ({
                name: "blog.auto" as const,
                data: { siteId: s.id, userId: s.userId },
            })),
        );

        logger.info(`[CronDailyBlog] Queued ${sites.length} sites`);
        return { queued: sites.length };
    },
);


export const cronWeeklyCompetitorAlerts = inngest.createFunction(
    {
        id: "cron-competitor-alerts",
        name: "Cron: Weekly Competitor Alerts Fan-out",
        retries: 0,
        triggers: [{ cron: "0 7 * * 1" }],
    },
    async ({ step }) => {
        const sites = await step.run("fetch-paid-sites", getPaidSites);

        if (sites.length === 0) {
            logger.info("[CronCompetitorAlerts] No paid sites — skipping fan-out");
            return { queued: 0 };
        }

        await step.sendEvent(
            "fan-out-competitor-alerts",
            sites.map((s) => ({
                name: "competitor.alerts.site" as const,
                data: { siteId: s.id, domain: s.domain },
            })),
        );

        logger.info(`[CronCompetitorAlerts] Queued ${sites.length} sites`);
        return { queued: sites.length };
    },
);

export const cronMonthlyRateLimitCleanup = inngest.createFunction(
    {
        id: "cron-monthly-ratelimit-cleanup",
        name: "Cron: Monthly Rate-Limit Key Cleanup",
        retries: 2,
        triggers: [{ cron: "30 0 1 * *" }],
    },
    async ({ step }) => {
        const result = await step.run("cleanup-orphaned-rl-keys", () =>
            cleanupOrphanedRateLimitKeys()
        );

        logger.info("[CronMonthlyRateLimitCleanup] Done", {
            scanned: result.scanned,
            deleted: result.deleted,
            orphanCount: result.orphans.length,
        });

        return result;
    },
);

export const cronWeeklySerpAnalysis = inngest.createFunction(
    {
        id: "cron-weekly-serp-analysis",
        name: "Cron: Weekly SERP Analysis Re-run",
        retries: 0,
        triggers: [{ cron: "0 8 * * 6" }],
    },
    async ({ step }) => {
        const expired = await step.run("fetch-expired-analyses", () =>
            prisma.keywordSerpAnalysis.findMany({
                where: {
                    status: "COMPLETED",
                    expiresAt: { lt: new Date() },
                },
                select: {
                    id: true,
                    keyword: true,
                    landingUrl: true,
                    siteId: true,
                    site: { select: { domain: true, userId: true } },
                },
                take: 500,
            })
        );

        if (expired.length === 0) {
            logger.info("[CronWeeklySerpAnalysis] No expired analyses — skipping");
            return { queued: 0 };
        }

        await step.sendEvent(
            "fan-out-serp-analysis",
            expired.map((a) => ({
                name: "serp-analysis/requested" as const,
                data: {
                    analysisId: a.id,
                    siteId: a.siteId,
                    userId: a.site.userId,
                    keyword: a.keyword,
                    landingPageUrl: a.landingUrl,
                    domain: a.site.domain,
                },
            })),
        );

        logger.info(`[CronWeeklySerpAnalysis] Queued ${expired.length} re-analyses`);
        return { queued: expired.length };
    },
);


/**
 * Stuck-Blog Sweep — runs every 30 minutes.
 *
 * Any blog that has been in GENERATING status for more than 20 minutes is
 * considered stuck (Inngest's onFailure didn't fire, or the job was lost).
 * The sweep marks them FAILED and refunds 10 credits per blog.
 *
 * This is the last-resort safety net — not the primary failure handler.
 * The primary handler is onFailure inside generateBlogJob.
 *
 * 20-min threshold reasoning:
 *   - Inngest max step duration on Pro plan = 15 min per step.
 *   - We cap generation at 4.5 min.
 *   - 20 min = comfortable buffer that covers all retry attempts.
 */
export const cronStuckBlogSweep = inngest.createFunction(
    {
        id: "cron-stuck-blog-sweep",
        name: "Cron: Stuck Blog GENERATING Sweep",
        retries: 1,
        triggers: [{ cron: "*/30 * * * *" }],
    },
    async ({ step }) => {
        const STUCK_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes
        const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

        const stuckBlogs = await step.run("find-stuck-blogs", () =>
            prisma.blog.findMany({
                where: {
                    status: "GENERATING",
                    createdAt: { lt: cutoff },
                },
                select: {
                    id: true,
                    siteId: true,
                    title: true,
                    createdAt: true,
                    site: { select: { userId: true } },
                },
                take: 50,
            })
        );

        if (stuckBlogs.length === 0) {
            return { swept: 0 };
        }

        logger.warn(`[StuckBlogSweep] Found ${stuckBlogs.length} stuck blogs — marking FAILED`, {
            ids: stuckBlogs.map(b => b.id),
        });

        await step.run("mark-stuck-blogs-failed", async () => {
            await prisma.blog.updateMany({
                where: { id: { in: stuckBlogs.map(b => b.id) } },
                data: { status: "FAILED" },
            });
        });

        const userCounts = new Map<string, number>();
        for (const blog of stuckBlogs) {
            const uid = blog.site?.userId;
            if (uid) userCounts.set(uid, (userCounts.get(uid) ?? 0) + 1);
        }

        await step.run("refund-credits-for-stuck-blogs", async () => {
            for (const [userId, count] of userCounts) {
                const refund = count * 10;
                await prisma.user
                    .update({ where: { id: userId }, data: { credits: { increment: refund } } })
                    .catch((e: unknown) =>
                        logger.error("[StuckBlogSweep] Credit refund failed", {
                            userId,
                            refund,
                            error: e instanceof Error ? e.message : String(e),
                        })
                    );
                logger.info(`[StuckBlogSweep] Refunded ${refund} credits to user ${userId} (${count} stuck blog${count > 1 ? "s" : ""})`);
            }
        });

        return { swept: stuckBlogs.length };
    },
);

export const cronGracePeriodEnforcer = inngest.createFunction(
    {
        id: "cron-grace-period-enforcer",
        name: "Cron: Subscription Grace Period Enforcer",
        retries: 2,
        triggers: [{ cron: "0 1 * * *" }],
    },
    async ({ step }) => {
        const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

        const expiredSubs = await step.run("find-expired-grace-subs", () =>
            prisma.subscription.findMany({
                where: {
                    status: "canceled",
                    cancelledAt: { lt: TWO_DAYS_AGO, not: null },
                    user: { subscriptionTier: { not: "FREE" } },
                },
                select: {
                    userId: true,
                    cancelledAt: true,
                    user: { select: { credits: true, subscriptionTier: true } },
                },
                take: 200,
            })
        );

        if (expiredSubs.length === 0) {
            logger.info("[GracePeriodEnforcer] No expired grace periods found");
            return { locked: 0 };
        }

        const now = new Date();
        await step.run("lock-expired-users", async () => {
            for (const sub of expiredSubs) {
                logger.info("[GracePeriodEnforcer] Locking credits — grace expired", {
                    userId: sub.userId,
                    cancelledAt: String(sub.cancelledAt ?? ""),
                    creditsLocked: sub.user.credits,
                    previousTier: sub.user.subscriptionTier,
                });

                await prisma.user.update({
                    where: { id: sub.userId },
                    data: { subscriptionTier: "FREE", creditsLockedAt: now },
                }).catch((e: unknown) =>
                    logger.error("[GracePeriodEnforcer] Failed to lock user", {
                        userId: sub.userId,
                        error: e instanceof Error ? e.message : String(e),
                    })
                );
            }
        });

        logger.info(`[GracePeriodEnforcer] Locked ${expiredSubs.length} users`);
        return { locked: expiredSubs.length };
    },
);

export const cronCreditWipeFinalizer = inngest.createFunction(
    {
        id: "cron-credit-wipe-finalizer",
        name: "Cron: Credit Wipe Finalizer",
        retries: 2,
        triggers: [{ cron: "0 2 * * *" }],
    },
    async ({ step }) => {
        const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

        const lockedUsers = await step.run("find-wipe-candidates", () =>
            prisma.user.findMany({
                where: {
                    creditsLockedAt: { lt: TWO_DAYS_AGO, not: null },
                    credits: { gt: 0 },
                },
                select: { id: true, credits: true, creditsLockedAt: true },
                take: 200,
            })
        );

        if (lockedUsers.length === 0) {
            logger.info("[CreditWipeFinalizer] No locked credits to wipe");
            return { wiped: 0 };
        }

        await step.run("wipe-locked-credits", async () => {
            for (const u of lockedUsers) {
                logger.info("[CreditWipeFinalizer] Wiping locked credits", {
                    userId: u.id,
                    creditsWiped: u.credits,
                    lockedAt: String(u.creditsLockedAt ?? ""),
                });

                await prisma.user.update({
                    where: { id: u.id },
                    data: { credits: 0, creditsLockedAt: null },
                }).catch((e: unknown) =>
                    logger.error("[CreditWipeFinalizer] Failed to wipe credits", {
                        userId: u.id,
                        error: e instanceof Error ? e.message : String(e),
                    })
                );
            }
        });

        logger.info(`[CreditWipeFinalizer] Wiped credits for ${lockedUsers.length} users`);
        return { wiped: lockedUsers.length };
    },
);


export const cronWeeklyGrowthPipeline = inngest.createFunction(
    {
        id: "cron-weekly-growth-pipeline",
        name: "Cron: Weekly Growth Pipeline Fan-out",
        retries: 0,
        triggers: [{ cron: "0 3 * * 3" }],
    },
    async ({ step }) => {
        const sites = await step.run("fetch-paid-sites", getPaidSites);

        if (sites.length === 0) {
            logger.info("[CronWeeklyGrowth] No paid sites — skipping fan-out");
            return { queued: 0 };
        }

        await step.sendEvent(
            "fan-out-growth-pipeline",
            sites.map((s) => ({
                name: "growth.pipeline.run" as const,
                data: { siteId: s.id },
            })),
        );

        logger.info(`[CronWeeklyGrowth] Queued ${sites.length} sites for growth pipeline`);
        return { queued: sites.length };
    },
);


// ────────────────────────────────────────────────────────────────────────────
// D.5: Experiment Measurement — daily GSC metric collection for running experiments
// Runs daily at 04:30 UTC — before evaluation cron at 05:00 UTC
// ────────────────────────────────────────────────────────────────────────────

export const cronDailyExperimentMeasurement = inngest.createFunction(
    {
        id: "cron-daily-experiment-measurement",
        name: "Cron: Daily Experiment Measurement",
        retries: 1,
        triggers: [{ cron: "30 4 * * *" }],
    },
    async ({ step }) => {
        const { measureRunningExperiments } = await import("@/lib/experiments/measurement");

        const results = await step.run("measure-running-experiments", async () => {
            try {
                return await measureRunningExperiments();
            } catch (err: unknown) {
                logger.error("[CronExperimentMeasurement] Measurement failed", {
                    error: err instanceof Error ? err.message : String(err),
                });
                return [];
            }
        });

        logger.info(`[CronExperimentMeasurement] Recorded ${results.length} measurements`);
        return { measured: results.length };
    },
);

export const cronDailyExperimentSafety = inngest.createFunction(
    {
        id: "cron-daily-experiment-safety",
        name: "Cron: Daily Experiment Safety Enforcement",
        retries: 1,
        triggers: [{ cron: "45 4 * * *" }],
    },
    async ({ step }) => {
        const { enforceSafetyOnAllExperiments } = await import("@/lib/experiments/safety");

        const result = await step.run("enforce-experiment-safety", async () => {
            try {
                return await enforceSafetyOnAllExperiments();
            } catch (err: unknown) {
                logger.error("[CronExperimentSafety] Safety enforcement failed", {
                    error: err instanceof Error ? err.message : String(err),
                });
                return { checked: 0, aborted: 0 };
            }
        });

        logger.info("[CronExperimentSafety] Safety enforcement complete", result);
        return result;
    },
);

export const cronDailyExperimentEval = inngest.createFunction(
    {
        id: "cron-daily-experiment-eval",
        name: "Cron: Daily Experiment Auto-Evaluation",
        retries: 1,
        triggers: [{ cron: "0 5 * * *" }],
    },
    async ({ step }) => {
        const { evaluate28DayExperimentLift } = await import("@/lib/experiments/tracker");
        const { evaluateMaturedExperiments } = await import("@/lib/experiments/evaluator");

        const readyExperiments = await step.run("fetch-mature-experiments", async () => {
            try {
                const rows = await (prisma as any).experiment.findMany({
                    where: {
                        evaluationDate: { lte: new Date() },
                        status: { in: ["RECORDED", "EVALUATING"] },
                    },
                    select: { id: true },
                    take: 50,
                });
                return rows.map((r: any) => r.id as string);
            } catch {
                return [];
            }
        });

        let legacyEvaluated = 0;

        if (readyExperiments.length > 0) {
            await step.run("evaluate-legacy-experiments", async () => {
                for (const expId of readyExperiments) {
                    try {
                        const result = await evaluate28DayExperimentLift(expId);
                        if (result.status === "COMPLETED") legacyEvaluated++;
                        logger.info("[CronExperimentEval] Evaluated legacy experiment", {
                            expId,
                            status: result.status,
                            positionDelta: result.lift?.positionDelta,
                        });
                    } catch (err: unknown) {
                        logger.warn("[CronExperimentEval] Failed to evaluate legacy", {
                            expId,
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                }
            });
        }

        const d5Result = await step.run("evaluate-d5-experiments", async () => {
            try {
                return await evaluateMaturedExperiments();
            } catch (err: unknown) {
                logger.warn("[CronExperimentEval] D.5 evaluation failed", {
                    error: err instanceof Error ? err.message : String(err),
                });
                return { evaluated: 0, outcomes: { WIN: 0, LOSS: 0, INCONCLUSIVE: 0, ABORTED: 0 } };
            }
        });

        logger.info("[CronExperimentEval] Evaluation complete", {
            legacyEvaluated,
            legacyTotal: readyExperiments.length,
            d5Evaluated: d5Result.evaluated,
            d5Outcomes: d5Result.outcomes,
        });

        return {
            legacy: { evaluated: legacyEvaluated, total: readyExperiments.length },
            d5: d5Result,
        };
    },
);

export const cronWeeklyLearningLoop = inngest.createFunction(
    {
        id: "cron-weekly-learning-loop",
        name: "Cron: Weekly D.6 Learning Loop",
        retries: 1,
        triggers: [{ cron: "0 6 * * 0" }],
    },
    async ({ step }) => {
        const { aggregateOutcomesByAction } = await import("@/lib/learning/aggregator");
        const { generateSignals } = await import("@/lib/learning/signal-generator");
        const { validateSignal } = await import("@/lib/learning/signal-validator");
        const { persistAndActivateSignal, persistActionPerformance } = await import("@/lib/learning/signal-registry");

        // 1. Get all sites with D.5 experiments
        const sites = await step.run("fetch-sites-with-experiments", async () => {
            try {
                const rows = await (prisma as any).experiment.findMany({
                    where: { outcome: { not: null } },
                    select: { siteId: true },
                    distinct: ["siteId"],
                });
                return rows.map((r: any) => r.siteId as string);
            } catch {
                return [];
            }
        });

        if (sites.length === 0) {
            logger.info("[CronLearningLoop] No sites with D.5 experiments");
            return { sites: 0, signals: 0 };
        }

        let totalSignals = 0;

        for (const siteId of sites) {
            const result = await step.run(`learn-site-${siteId}`, async () => {
                let siteSignals = 0;

                try {
                    const aggregations = await aggregateOutcomesByAction(siteId);

                    for (const agg of aggregations) {
                        await persistActionPerformance(agg);

                        const signals = generateSignals(agg);

                        for (const signal of signals) {
                            const validation = validateSignal(signal, agg);
                            if (validation.valid) {
                                await persistAndActivateSignal(siteId, signal);
                                siteSignals++;
                            } else {
                                logger.warn("[CronLearningLoop] Signal failed validation", {
                                    siteId,
                                    actionType: signal.actionType,
                                    signalType: signal.signalType,
                                    violations: validation.violations,
                                });
                            }
                        }
                    }
                } catch (err: unknown) {
                    logger.error("[CronLearningLoop] Failed to process site", {
                        siteId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }

                return siteSignals;
            });

            totalSignals += result;
        }

        logger.info("[CronLearningLoop] Learning loop complete", {
            sites: sites.length,
            totalSignals,
        });

        return { sites: sites.length, signals: totalSignals };
    },
);

export const cronDailyPortfolioAllocation = inngest.createFunction(
    {
        id: "cron-daily-portfolio-allocation",
        name: "Cron: Daily D.7 Portfolio Allocation",
        retries: 1,
        triggers: [{ cron: "30 6 * * *" }],
    },
    async ({ step }) => {
        const { allocatePortfolioForSite } = await import("@/lib/portfolio/allocator");

        // 1. Get all active sites with OPEN opportunities
        const sites = await step.run("fetch-sites-with-open-opportunities", async () => {
            try {
                const rows = await (prisma as any).growthDecision.findMany({
                    where: { opportunityStatus: "OPEN" },
                    select: { siteId: true },
                    distinct: ["siteId"],
                });
                return rows.map((r: any) => r.siteId as string);
            } catch {
                return [];
            }
        });

        if (sites.length === 0) {
            logger.info("[CronPortfolio] No sites with OPEN opportunities");
            return { sites: 0, allocations: 0 };
        }

        let totalSelected = 0;

        for (const siteId of sites) {
            const result = await step.run(`allocate-site-${siteId}`, async () => {
                try {
                    const allocation = await allocatePortfolioForSite(siteId);
                    return allocation?.diagnostics.selectedCount ?? 0;
                } catch (err: unknown) {
                    logger.error("[CronPortfolio] Failed to allocate for site", {
                        siteId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                    return 0;
                }
            });

            totalSelected += result;
        }

        logger.info("[CronPortfolio] Portfolio allocation complete", {
            sites: sites.length,
            totalSelected,
        });

        return { sites: sites.length, allocations: totalSelected };
    },
);


export const cronStuckAuditSweep = inngest.createFunction(
    {
        id: "cron-stuck-audit-sweep",
        name: "Cron: Stuck Audit PENDING/IN_PROGRESS Sweep",
        retries: 1,
        triggers: [{ cron: "*/15 * * * *" }],
    },
    async ({ step }) => {
        const PENDING_THRESHOLD_MS = 20 * 60 * 1000;   // 20 minutes
        const IN_PROGRESS_THRESHOLD_MS = 45 * 60 * 1000; // 45 minutes

        const pendingCutoff = new Date(Date.now() - PENDING_THRESHOLD_MS);
        const inProgressCutoff = new Date(Date.now() - IN_PROGRESS_THRESHOLD_MS);

        const stuckPending = await step.run("find-stuck-pending", () =>
            prisma.audit.findMany({
                where: {
                    fixStatus: "PENDING",
                    runTimestamp: { lt: pendingCutoff },
                },
                select: {
                    id: true,
                    siteId: true,
                    runTimestamp: true,
                    site: { select: { userId: true } },
                },
                take: 50,
            })
        );

        const stuckInProgress = await step.run("find-stuck-in-progress", () =>
            prisma.audit.findMany({
                where: {
                    fixStatus: "IN_PROGRESS",
                    runTimestamp: { lt: inProgressCutoff },
                },
                select: {
                    id: true,
                    siteId: true,
                    totalPages: true,
                    completedPages: true,
                    failedPages: true,
                    runTimestamp: true,
                    site: { select: { userId: true } },
                },
                take: 50,
            })
        );

        const reconciled: string[] = [];
        for (const audit of stuckInProgress) {
            const processed = audit.completedPages + audit.failedPages;
            if (audit.totalPages > 0 && processed >= audit.totalPages) {
                const finalStatus = audit.completedPages === 0
                    ? "FAILED"
                    : audit.failedPages > 0
                        ? "PARTIAL"
                        : "COMPLETED";

                const { count } = await prisma.audit.updateMany({
                    where: { id: audit.id, fixStatus: "IN_PROGRESS" },
                    data: { fixStatus: finalStatus },
                });
                if (count > 0) {
                    reconciled.push(audit.id);
                    logger.info("[StuckAuditSweep] Reconciled completed audit", {
                        auditId: audit.id,
                        finalStatus,
                        completed: audit.completedPages,
                        failed: audit.failedPages,
                        total: audit.totalPages,
                    });
                }
            }
        }

        const trulyStuckInProgress = stuckInProgress.filter(
            (a) => !reconciled.includes(a.id)
        );

        const allStuck = [...stuckPending, ...trulyStuckInProgress];

        if (allStuck.length === 0 && reconciled.length === 0) {
            return { swept: 0, reconciled: reconciled.length };
        }

        if (allStuck.length > 0) {
            logger.warn(`[StuckAuditSweep] Found ${allStuck.length} stuck audits — marking FAILED`, {
                pendingCount: stuckPending.length,
                inProgressCount: trulyStuckInProgress.length,
                ids: allStuck.map((a) => a.id),
            });

            await step.run("mark-stuck-audits-failed", async () => {
                await prisma.audit.updateMany({
                    where: {
                        id: { in: allStuck.map((a) => a.id) },
                        fixStatus: { notIn: ["COMPLETED", "FAILED", "PARTIAL"] },
                    },
                    data: { fixStatus: "FAILED" },
                });
            });

            await step.run("release-stuck-audit-leases", async () => {
                const { releaseAuditLease } = await import("@/lib/audit-lock");
                for (const audit of allStuck) {
                    const userId = audit.site?.userId;
                    if (userId) {
                        const lockKey = `audit-lock:${userId}:${audit.siteId}`;
                        await releaseAuditLease(lockKey, audit.id).catch(() => null);
                    }
                }
            });
        }

        return {
            swept: allStuck.length,
            reconciled: reconciled.length,
            pending: stuckPending.length,
            inProgress: trulyStuckInProgress.length,
        };
    },
);
