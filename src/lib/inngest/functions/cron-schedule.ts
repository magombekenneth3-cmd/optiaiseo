/**
 * Inngest native cron triggers — platform-agnostic scheduling.
 *
 * Railway ignores vercel.json cron definitions. By registering cron triggers
 * directly in Inngest, scheduling is handled by Inngest Cloud regardless of
 * which hosting platform the app runs on.
 *
 * Fan-out pattern: each cron fetches paid site IDs then sends per-site events
 * that are processed by the existing per-site job handlers (backlinks-check-site,
 * competitor.alerts.site, etc.) with their own concurrency + retry configs.
 *
 * Inngest v4 API: createFunction takes 2 args — (config, handler).
 * Triggers are declared inside config via triggers: [{ cron: "..." }].
 *
 * IMPORTANT: These cron functions complement — not replace — the existing
 * weeklyAutoReauditJob in cron-workers.ts. Both are valid; these provide
 * the missing fan-outs for backlinks, AEO, blog, competitor alerts, rank,
 * and indexing workflows that vercel.json was supposed to cover.
 */

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
        retries: 0, // Fan-out is idempotent; per-site jobs have their own retries
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

// Runs 30 min after the credits reset job (00:00 UTC) to avoid Redis contention.
// Scans all rl:* keys and deletes any whose prefix is no longer in ACTIVE_PREFIXES.
// @upstash/ratelimit sets TTLs automatically so this is a belt-and-suspenders safety net.

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
                    analysisId:     a.id,
                    siteId:         a.siteId,
                    userId:         a.site.userId,
                    keyword:        a.keyword,
                    landingPageUrl: a.landingUrl,
                    domain:         a.site.domain,
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
        triggers: [{ cron: "*/30 * * * *" }], // every 30 min
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
                take: 50, // safety cap — shouldn't need more
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

        // Refund credits for each affected user — group by userId to avoid
        // multiple increments hitting the DB simultaneously per user.
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
                            error: (e as Error)?.message,
                        })
                    );
                logger.info(`[StuckBlogSweep] Refunded ${refund} credits to user ${userId} (${count} stuck blog${count > 1 ? "s" : ""})`);
            }
        });

        return { swept: stuckBlogs.length };
    },
);

/**
 * Subscription Grace Period Enforcer — runs daily at 01:00 UTC.
 *
 * After a subscription is cancelled, the user keeps their tier + credits for
 * 2 days (grace period). This cron catches users whose grace has expired and:
 *   1. Downgrades them to FREE
 *   2. LOCKS their credits (sets creditsLockedAt) — credits become read-only
 *
 * The in-request guard (guards.ts getUserTier) also does lazy enforcement,
 * but this cron catches users who never log in after cancellation.
 */
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
                    cancelledAt: sub.cancelledAt?.toISOString(),
                    creditsLocked: sub.user.credits,
                    previousTier: sub.user.subscriptionTier,
                });

                await prisma.user.update({
                    where: { id: sub.userId },
                    data: { subscriptionTier: "FREE", creditsLockedAt: now },
                }).catch((e: unknown) =>
                    logger.error("[GracePeriodEnforcer] Failed to lock user", {
                        userId: sub.userId,
                        error: (e as Error)?.message,
                    })
                );
            }
        });

        logger.info(`[GracePeriodEnforcer] Locked ${expiredSubs.length} users`);
        return { locked: expiredSubs.length };
    },
);

/**
 * Credit Wipe Finalizer — runs daily at 02:00 UTC.
 *
 * After credits are locked (creditsLockedAt is set), the user has 2 more days
 * to top-up or resubscribe and reclaim them. If they don't act within that
 * window, this cron wipes the balance to 0 permanently.
 *
 * Timeline:
 *   Day 0: Subscription cancelled → credits still fully usable
 *   Day 2: Grace expires → credits locked (read-only, visible but unusable)
 *   Day 4: Finalizer runs → locked credits wiped to 0
 */
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
                    lockedAt: u.creditsLockedAt?.toISOString(),
                });

                await prisma.user.update({
                    where: { id: u.id },
                    data: { credits: 0, creditsLockedAt: null },
                }).catch((e: unknown) =>
                    logger.error("[CreditWipeFinalizer] Failed to wipe credits", {
                        userId: u.id,
                        error: (e as Error)?.message,
                    })
                );
            }
        });

        logger.info(`[CreditWipeFinalizer] Wiped credits for ${lockedUsers.length} users`);
        return { wiped: lockedUsers.length };
    },
);

