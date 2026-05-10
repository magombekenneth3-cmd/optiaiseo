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
