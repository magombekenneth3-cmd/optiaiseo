import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { captureSerpFeatures } from "@/lib/serp/serp-features";

export const serpFeatureWeeklyCron = inngest.createFunction(
    {
        id: "serp-feature-weekly-tracker",
        name: "Weekly SERP Feature Tracker",
        retries: 0,
        concurrency: { limit: 1 },
        triggers: [{ cron: "0 5 * * 4" }],
    },
    async ({ step }) => {
        const sites = await step.run("fetch-eligible-sites", async () => {
            return prisma.site.findMany({
                where: { user: { subscriptionTier: { in: ["PRO", "AGENCY"] } } },
                select: { id: true, domain: true },
            });
        });

        await step.sendEvent(
            "fan-out-serp-features",
            sites.map((site) => ({
                name: "serp-features/capture.site" as const,
                data: { siteId: site.id, domain: site.domain },
            }))
        );

        logger.info("[SerpFeatures/Cron] Dispatched", { count: sites.length });
        return { dispatched: sites.length };
    }
);

export const serpFeatureSiteJob = inngest.createFunction(
    {
        id: "serp-feature-capture-site",
        name: "Capture SERP Features — Per Site",
        retries: 2,
        concurrency: { limit: 3 },
        idempotency: "event.data.siteId",
        triggers: [{ event: "serp-features/capture.site" }],
    },
    async ({ event, step }) => {
        const { siteId, domain } = event.data as { siteId: string; domain: string };

        const keywords = await step.run("load-tracked-keywords", async () => {
            const tracked = await prisma.trackedKeyword.findMany({
                where: { siteId },
                select: { keyword: true },
                take: 20,
                orderBy: { addedAt: "desc" },
            });

            if (tracked.length > 0) return tracked.map((t) => t.keyword);

            const snapshots = await prisma.rankSnapshot.findMany({
                where: { siteId },
                select: { keyword: true },
                distinct: ["keyword"],
                take: 20,
                orderBy: { recordedAt: "desc" },
            });

            return snapshots.map((s) => s.keyword);
        });

        if (keywords.length === 0) {
            return { siteId, skipped: true, reason: "no_keywords" };
        }

        const saved = await step.run("capture-features", async () => {
            return captureSerpFeatures(siteId, domain, keywords);
        });

        return { siteId, domain, captured: saved };
    }
);
