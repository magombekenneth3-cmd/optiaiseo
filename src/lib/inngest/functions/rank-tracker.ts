import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { fetchGSCKeywords, classifyIntent } from "@/lib/gsc";
import { getUserGscToken } from "@/lib/gsc/token";
import { getKeywordMetricsBatch, getKeywordDifficultyBatch, resolveLocationCode } from "@/lib/keywords/dataforseo";

export const rankTrackerSiteJob = inngest.createFunction(
    {
        id: "rank-tracker-site",
        name: "Rank Tracker — Per Site",
        retries: 2,
        concurrency: { limit: 5 },  // capped at Inngest plan limit
        triggers: [
            { event: "rank.tracker.site" },
            { cron: "0 4 * * *" },  // every day at 4am UTC
        ],
    },
    async ({ event, step }) => {
        // When fired by cron, event.data is CronEventData (no siteId) — fan out to all eligible sites.
        // When fired by event, event.data has { siteId, domain, userId } — process that single site.
        const eventData = event.data as Record<string, unknown>;
        if (!eventData?.siteId) {
            const sites = await step.run("fetch-eligible-sites", () =>
                prisma.site.findMany({
                    where:  { user: { subscriptionTier: { in: ["STARTER", "PRO", "AGENCY"] } } },
                    select: { id: true, domain: true, userId: true },
                })
            );
            await inngest.send(
                sites.map(s => ({
                    name: "rank.tracker.site" as const,
                    data: { siteId: s.id, domain: s.domain, userId: s.userId },
                }))
            );
            return { fanned: sites.length };
        }

        const { siteId, domain, userId } = eventData as {
            siteId: string;
            domain: string;
            userId: string;
        };


        const site = await step.run("load-site", async () => {
            return prisma.site.findUnique({
                where: { id: siteId },
                select: { localContext: true },
            });
        });

        if (!site) return { skipped: true, reason: "site_not_found" };

        const accessToken = await step.run("get-gsc-token", async () => {
            return getUserGscToken(userId);
        });

        const keywords = await step.run("fetch-gsc-keywords", async () => {
            const { resolveGscProperty } = await import("@/lib/gsc/property-resolver");
            const resolution = await resolveGscProperty(userId, accessToken, domain);
            if (!resolution) return [];
            return fetchGSCKeywords(accessToken, resolution.property, 90);
        });

        const top50 = keywords
            .sort((a, b) => b.impressions - a.impressions)
            .slice(0, 50);

        const volumeMap = await step.run("enrich-volume", async () => {
            if (!process.env.DATAFORSEO_LOGIN || top50.length === 0) return {};
            const locationCode = resolveLocationCode(site.localContext ?? null);
            const kwList = top50.map((k) => k.keyword);
            try {
                const [volMap, kdMap] = await Promise.all([
                    getKeywordMetricsBatch(kwList, locationCode),
                    getKeywordDifficultyBatch(kwList, locationCode).catch(() => new Map<string, number>()),
                ]);
                const combined: Record<string, { searchVolume: number; keywordDifficulty: number | null }> = {};
                for (const [k, v] of volMap.entries()) {
                    combined[k.toLowerCase()] = {
                        searchVolume: v.searchVolume,
                        keywordDifficulty: kdMap.get(k.toLowerCase()) ?? null,
                    };
                }
                return combined;
            } catch (err: unknown) {
                logger.warn("[RankTracker] DataForSEO batch failed", { error: (err as Error)?.message });
                return {};
            }
        });

        await step.run("write-snapshots", async () => {
            const snapshots = top50.map((kw) => {
                const metrics = (volumeMap as Record<string, { searchVolume: number; keywordDifficulty: number | null }>)[kw.keyword.toLowerCase()];
                return {
                    siteId,
                    keyword: kw.keyword,
                    intent: classifyIntent(kw.keyword),
                    position: Math.round(kw.position),
                    url: kw.url,
                    device: "desktop",
                    ...(metrics ? { searchVolume: metrics.searchVolume, difficulty: metrics.keywordDifficulty ?? null } : {}),
                };
            });
            await prisma.rankSnapshot.createMany({ data: snapshots });
        });

        logger.info("[RankTracker] Site complete", { domain, keywords: top50.length });
        return { siteId, keywords: top50.length };
    }
);
