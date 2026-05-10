import { inngest }           from "../client";
import { NonRetriableError }  from "inngest";
import { prisma } from "@/lib/prisma";
import { logger }             from "@/lib/logger";
import { CONCURRENCY }        from "../concurrency";
import { getSerpData, getKeywordMetricsBatch } from "@/lib/keywords/dataforseo";
import { writeVisibilitySnapshot }             from "@/lib/keywords/visibility-score";
import { dispatchWebhooks }                    from "@/lib/alerts/webhook-dispatcher";

export const trackedRankCheckerSiteJob = inngest.createFunction(
    {
        id: "tracked-rank-checker-site",
        name: "Tracked Rank Checker — Per Site",
        retries: 2,
        concurrency: { limit: CONCURRENCY.auditFull, key: "global-rank-check" },
        throttle: { limit: 30, period: "1m", key: "global-rank-check-throttle" },
        onFailure: async ({ error, event }) => {
            logger.error("[TrackedRankChecker] Failed", {
                siteId: (event.data?.event?.data as Record<string, unknown>)?.siteId,
                error:  error.message,
            });
        },
    
        triggers: [{ event: "tracked.rank.check.site" }],
    },
    async ({ event, step }) => {
        if (!process.env.DATAFORSEO_LOGIN)
            throw new NonRetriableError("DATAFORSEO_LOGIN not set — dropping job");

        const { siteId, domain } = event.data as { siteId: string; domain: string };

        const keywords = await step.run("load-tracked-keywords", () =>
            prisma.trackedKeyword.findMany({
                where:  { siteId },
                select: { id: true, keyword: true, locationCode: true, device: true },
            })
        );

        if (keywords.length === 0) return { skipped: true, reason: "no_tracked_keywords" };

        const metricsRaw = await step.run("enrich-volume-cpc", async () => {
            try {
                const map = await getKeywordMetricsBatch(
                    keywords.map((k) => k.keyword),
                    keywords[0].locationCode,
                );
                return Object.fromEntries(map) as Record<string, { searchVolume: number; cpc: number }>;
            } catch {
                return {} as Record<string, { searchVolume: number; cpc: number }>;
            }
        });

        const BATCH = 5;
        const snapshots: Array<{
            siteId:       string;
            keyword:      string;
            position:     number;
            url:          string | null;
            device:       string;
            searchVolume: number | null;
            cpc:          number | null;
            difficulty:   number | null;
            intent:       string | null;
            trackedId:    string;
            serpData?:    {
                hasAiOverview: boolean;
                hasSnippet:    boolean;
                hasPaa:        boolean;
                hasLocalPack:  boolean;
                hasVideo:      boolean;
                brandInAio:    boolean;
            };
        }> = [];

        for (let i = 0; i < keywords.length; i += BATCH) {
            const chunk = keywords.slice(i, i + BATCH);

            const results = await step.run(`check-serp-batch-${i}`, () =>
                Promise.allSettled(
                    chunk.map(async (kw) => {
                        const { urls, features } = await getSerpData(kw.keyword, kw.locationCode, 20);

                        const myUrl = urls.find((u) => {
                            try { return new URL(u).hostname.replace(/^www\./, "") === domain; }
                            catch { return false; }
                        });
                        const position = myUrl ? urls.indexOf(myUrl) + 1 : 0;
                        const metrics  = metricsRaw[kw.keyword.toLowerCase()];

                        const itemTypes = features.items.map((i) => i.type);

                        const aioItems = features.items.filter(i => i.type === "ai_overview");
                        const brandInAio = aioItems.some(item => {
                            const refs: string[] = (item as { references?: string[] }).references ?? [];
                            return refs.some(ref => {
                                try {
                                    return new URL(ref).hostname.replace(/^www\./, "") === domain;
                                } catch {
                                    return false;
                                }
                            });
                        });

                        return {
                            trackedId:    kw.id,
                            keyword:      kw.keyword,
                            device:       kw.device,
                            position,
                            url:          myUrl ?? null,
                            searchVolume: metrics?.searchVolume                  ?? null,
                            cpc:          metrics?.cpc                           ?? null,
                            difficulty:   (metrics as { difficulty?: number })?.difficulty ?? null,
                            intent:       (metrics as { intent?: string })?.intent         ?? null,
                            serpData: {
                                hasAiOverview: itemTypes.includes("ai_overview"),
                                hasSnippet:    features.hasAnswerBox || itemTypes.includes("featured_snippet"),
                                hasPaa:        itemTypes.includes("people_also_ask"),
                                hasLocalPack:  features.hasLocalPack,
                                hasVideo:      itemTypes.includes("video"),
                                brandInAio,
                            },
                        };
                    })
                )
            );

            for (const r of results) {
                if (r.status === "fulfilled") snapshots.push({ siteId, ...r.value });
            }

            if (i + BATCH < keywords.length) await step.sleep("batch-cooldown", "1s");
        }

        if (snapshots.length === 0) return { siteId, checked: 0 };

        await step.run("write-snapshots", () =>
            prisma.rankSnapshot.createMany({
                data: snapshots.map((s) => ({
                    siteId:       s.siteId,
                    keyword:      s.keyword,
                    position:     s.position,
                    url:          s.url,
                    device:       s.device,
                    searchVolume: s.searchVolume,
                    cpc:          s.cpc,
                    difficulty:   s.difficulty,
                    intent:       s.intent,
                    trackedId:    s.trackedId,
                })),
            })
        );

        const serpRows = snapshots.filter((s) => s.serpData);
        if (serpRows.length > 0) {
            await step.run("upsert-serp-features", () =>
                Promise.all(
                    serpRows.map((s) =>
                        prisma.serpFeature.upsert({
                            where:  { siteId_keyword: { siteId, keyword: s.keyword } },
                            update: {
                                hasAiOverview: s.serpData!.hasAiOverview,
                                hasSnippet:    s.serpData!.hasSnippet,
                                hasPaa:        s.serpData!.hasPaa,
                                hasLocalPack:  s.serpData!.hasLocalPack,
                                hasVideo:      s.serpData!.hasVideo,
                                brandInAio:    s.serpData!.brandInAio,
                                capturedAt:    new Date(),
                            },
                            create: {
                                siteId,
                                keyword:       s.keyword,
                                hasAiOverview: s.serpData!.hasAiOverview,
                                hasSnippet:    s.serpData!.hasSnippet,
                                hasPaa:        s.serpData!.hasPaa,
                                hasLocalPack:  s.serpData!.hasLocalPack,
                                hasVideo:      s.serpData!.hasVideo,
                                brandInAio:    s.serpData!.brandInAio,
                            },
                        })
                    )
                )
            );
        }

        await step.run("dispatch-rank-webhooks", async () => {
            const todayMidnight = new Date();
            todayMidnight.setHours(0, 0, 0, 0);
            const yesterdayMidnight = new Date(todayMidnight);
            yesterdayMidnight.setDate(yesterdayMidnight.getDate() - 1);

            const prevSnaps = await prisma.rankSnapshot.findMany({
                where: {
                    siteId,
                    keyword:    { in: snapshots.map((s) => s.keyword) },
                    recordedAt: { gte: yesterdayMidnight, lt: todayMidnight },
                },
                select:   { keyword: true, position: true, recordedAt: true },
                orderBy:  { recordedAt: "desc" },
                take:     snapshots.length * 2,
                distinct: ["keyword"],
            });
            const prevMap = new Map(prevSnaps.map((p) => [p.keyword, p.position]));

            const siteRecord = await prisma.site.findUnique({
                where:  { id: siteId },
                select: { id: true, domain: true, slackWebhookUrl: true, zapierWebhookUrl: true },
            });
            if (!siteRecord) return;

            for (const snap of snapshots) {
                if (snap.position === 0) continue;
                const prev = prevMap.get(snap.keyword);
                if (prev === undefined) continue;
                const delta = prev - snap.position;

                if (delta >= 5) {
                    await dispatchWebhooks(siteRecord, {
                        event:   "rank_win",
                        summary: `+${delta} positions: "${snap.keyword}" moved from #${prev} to #${snap.position}`,
                        details: { keyword: snap.keyword, previousPos: prev, newPos: snap.position, delta },
                    });
                } else if (delta <= -5) {
                    await dispatchWebhooks(siteRecord, {
                        event:   "rank_drop",
                        summary: `${Math.abs(delta)} position drop: "${snap.keyword}" moved from #${prev} to #${snap.position}`,
                        details: { keyword: snap.keyword, previousPos: prev, newPos: snap.position, delta: Math.abs(delta) },
                    });
                }
            }
        });

        await step.run("write-visibility-snapshot", async () => {
            const visible = snapshots
                .filter((s) => s.position > 0)
                .map((s) => ({ position: s.position, searchVolume: s.searchVolume }));
            if (visible.length > 0) {
                await writeVisibilitySnapshot(siteId, visible);
            }
        });

        await step.run("prune-old-snapshots", () =>
            prisma.rankSnapshot.deleteMany({
                where: {
                    siteId,
                    trackedId: { not: null },
                    recordedAt: { lt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) },
                },
            })
        );

        logger.info("[TrackedRankChecker] Site complete", { domain, checked: snapshots.length });
        return { siteId, checked: snapshots.length };
    },
);

export const trackedRankCheckerCronJob = inngest.createFunction(
    {
        id: "tracked-rank-checker-cron",
        name: "Tracked Rank Checker — Daily Cron",
    
        triggers: [{ cron: "0 6 * * *" }],
    },
    async ({ step }) => {
        const sites = await step.run("load-sites", () =>
            prisma.site.findMany({
                where: {
                    user: { subscriptionTier: { in: ["STARTER", "PRO", "AGENCY"] } },
                    trackedKeywords: { some: {} },
                },
                select: { id: true, domain: true },
            })
        );

        await Promise.all(
            sites.map((site) =>
                step.sendEvent(`dispatch-${site.id}`, {
                    name: "tracked.rank.check.site",
                    data: { siteId: site.id, domain: site.domain },
                })
            )
        );

        return { dispatched: sites.length };
    },
);
