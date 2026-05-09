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

// ── Shared helper — fetch all paid (PRO + AGENCY) site IDs ──────────────────

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

// ── Weekly audit fan-out (Monday 2am UTC) ────────────────────────────────────

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

// ── Weekly backlinks fan-out (Monday 3am UTC) ────────────────────────────────

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

// ── Daily rank tracker fan-out (every day 4am UTC) ──────────────────────────

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

// ── Weekly AEO check fan-out (Monday 5am UTC) ────────────────────────────────

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

// ── Daily blog automation fan-out (every day 6am UTC) ───────────────────────

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

// ── Weekly competitor alerts fan-out (Monday 7am UTC) ───────────────────────

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

// ── Monthly rate-limit key cleanup (1st of month, 00:30 UTC) ────────────────
// Runs 30 min after the credits reset job (00:00 UTC) to avoid Redis contention.
// Scans all rl:* keys and deletes any whose prefix is no longer in ACTIVE_PREFIXES.
// @upstash/ratelimit sets TTLs automatically so this is a belt-and-suspenders safety net.

export const cronMonthlyRateLimitCleanup = inngest.createFunction(
    {
        id: "cron-monthly-ratelimit-cleanup",
        name: "Cron: Monthly Rate-Limit Key Cleanup",
        retries: 2,
        triggers: [{ cron: "30 0 1 * *" }], // 00:30 UTC on 1st of every month
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
