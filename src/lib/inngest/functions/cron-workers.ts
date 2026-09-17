import { logger } from "@/lib/logger";
import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { detectCompetitorMoves, filterUnsentAlerts, renderCompetitorAlertEmail } from "@/lib/competitors/detect-moves";
import { Resend } from "resend";

let _resend: Resend | null = null;
function getResend(): Resend {
    if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
    return _resend;
}

export const competitorAlertsSiteJob = inngest.createFunction(
    {
        id: "competitor-alerts-site",
        name: "Competitor Alerts — Per Site",
        concurrency: { limit: 5 },
        retries: 2,
    
        triggers: [{ event: "competitor.alerts.site" }],
    },
    async ({ event, step }) => {
        const { siteId } = event.data as { siteId: string; domain: string };

        const site = await step.run("fetch-site", async () => {
            return prisma.site.findUnique({
                where: { id: siteId },
                select: { id: true, domain: true, user: { select: { email: true, name: true } } },
            });
        });

        if (!site?.user?.email) return { skipped: true, reason: "no_email" };

        const allAlerts = await step.run("detect-moves", async () => {
            return detectCompetitorMoves(siteId);
        });

        if (allAlerts.length === 0) return { skipped: true, reason: "no_alerts" };

        const newAlerts = await step.run("filter-unsent", async () => {
            return filterUnsentAlerts(siteId, allAlerts);
        });

        if (newAlerts.length === 0) return { skipped: true, reason: "already_sent" };

        await step.run("send-email", async () => {
            await getResend().emails.send({
                from: `Aria <alerts@${process.env.RESEND_FROM_DOMAIN ?? "mail.aiseo.app"}>`,
                to: site.user!.email!,
                subject: `${newAlerts.length} competitor move${newAlerts.length > 1 ? "s" : ""} detected — ${site.domain}`,
                html: renderCompetitorAlertEmail(newAlerts, site.domain),
            });
        });

        return { alerted: newAlerts.length };
    }
);

export const indexingSiteJob = inngest.createFunction(
    {
        id: "indexing-submit-site",
        name: "Google Indexing — Per Site",
        concurrency: { limit: 5 },
        retries: 1,
    
        triggers: [{ event: "indexing.submit.site" }],
    },
    async ({ event, step }) => {
        const { siteId, domain, userId } = event.data as { siteId: string; domain: string; userId: string };

        const homepageUrl = `https://${domain.replace(/^https?:\/\//, "")}/`;

        const { submitUrlForIndexing } = await import("@/lib/indexer");

        const homepageResult = await step.run("submit-homepage", async () => {
            return submitUrlForIndexing(siteId, homepageUrl, "CRON", userId);
        });

        if (homepageResult.skipped && homepageResult.reason === "Daily quota reached") {
            return { skipped: true, reason: "quota_exhausted" };
        }

        const recentBlogs = await step.run("fetch-recent-blogs", async () => {
            return prisma.blog.findMany({
                where: {
                    siteId,
                    status: "PUBLISHED",
                    publishedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
                },
                select: { slug: true, hashnodeUrl: true },
                take: 5,
            });
        });

        let submitted = 1;
        for (const blog of recentBlogs) {
            const blogUrl = blog.hashnodeUrl ?? `https://${domain}/${blog.slug}`;
            const result = await step.run(`submit-blog-${blog.slug}`, async () => {
                return submitUrlForIndexing(siteId, blogUrl, "CRON", userId);
            });
            if (result.skipped && result.reason === "Daily quota reached") break;
            submitted++;
        }

        return { submitted };
    }
);

export const weeklyAutoReauditJob = inngest.createFunction(
    {
        id: "weekly-auto-reaudit",
        name: "Weekly Scheduled Re-Audit (Paid Sites)",
        concurrency: { limit: 5 },
        retries: 2,
    
        triggers: [{ cron: "0 6 * * 1" }],
    },
    async ({ step }) => {
        const sites = await step.run("fetch-paid-sites", async () => {
            return prisma.site.findMany({
                where: {
                    user: {
                        subscriptionTier: { in: ["STARTER", "PRO", "AGENCY"] },
                    },
                },
                select: { id: true, domain: true, userId: true },
            });
        });

        if (sites.length === 0) return { queued: 0 };

        await step.sendEvent(
            "fan-out-weekly-reaudits",
            sites.map((site) => ({
                name: "audit.run" as const,
                data: { siteId: site.id },
            }))
        );

        logger.info(`[WeeklyReaudit] Queued ${sites.length} sites for re-audit`);
        return { queued: sites.length };
    }
);

// ─── TrendingTopic purge ──────────────────────────────────────────────────────
export const purgeExpiredTrendingTopicsJob = inngest.createFunction(
    {
        id: "purge-expired-trending-topics",
        name: "Purge Expired Trending Topics",
        retries: 1,
        triggers: [{ cron: "0 3 * * 0" }], // Sundays at 03:00 UTC
    },
    async ({ step }) => {
        const deleted = await step.run("delete-expired-rows", async () => {
            const result = await prisma.trendingTopic.deleteMany({
                where: { expiresAt: { lt: new Date() } },
            });
            return result.count;
        });

        logger.info(`[PurgeTrending] Deleted ${deleted} expired TrendingTopic rows`);
        return { deleted };
    }
);
