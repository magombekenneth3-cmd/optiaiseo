import { inngest }           from "../client";
import { NonRetriableError }  from "inngest";
import { prisma } from "@/lib/prisma";
import { logger }             from "@/lib/logger";
import { CONCURRENCY }        from "../concurrency";
import { getSerpData, getKeywordMetricsBatch, getKeywordDifficultyBatch } from "@/lib/keywords/dataforseo";
import { classifyIntent }                      from "@/lib/gsc";
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
        const cleanDomain = domain
            .replace(/^https?:\/\//i, "")
            .replace(/^www\./i, "")
            .replace(/\/.*$/, "")
            .toLowerCase();

        const keywords = await step.run("load-tracked-keywords", () =>
            prisma.trackedKeyword.findMany({
                where:  { siteId },
                select: { id: true, keyword: true, locationCode: true, device: true },
            })
        );

        if (keywords.length === 0) return { skipped: true, reason: "no_tracked_keywords" };

        const metricsRaw = await step.run("enrich-volume-cpc", async () => {
            try {
                const byLocation = new Map<number, string[]>();
                for (const k of keywords) {
                    const loc = k.locationCode || 2840;
                    const list = byLocation.get(loc) ?? [];
                    list.push(k.keyword);
                    byLocation.set(loc, list);
                }

                const combined: Record<string, { searchVolume: number; cpc: number; difficulty: number | null }> = {};
                for (const [loc, kwList] of byLocation.entries()) {
                    const [volMap, kdMap] = await Promise.all([
                        getKeywordMetricsBatch(kwList, loc).catch(() => new Map<string, { searchVolume: number; cpc: number }>()),
                        getKeywordDifficultyBatch(kwList, loc).catch(() => new Map<string, number>()),
                    ]);
                    for (const [kw, m] of volMap.entries()) {
                        combined[kw.toLowerCase()] = {
                            searchVolume: m.searchVolume,
                            cpc: m.cpc,
                            difficulty: kdMap.get(kw.toLowerCase()) ?? null,
                        };
                    }
                    for (const [kw, kd] of kdMap.entries()) {
                        const lower = kw.toLowerCase();
                        if (!combined[lower]) {
                            combined[lower] = { searchVolume: 0, cpc: 0, difficulty: kd };
                        }
                    }
                }
                return combined;
            } catch {
                return {} as Record<string, { searchVolume: number; cpc: number; difficulty: number | null }>;
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

                        const matchesSiteDomain = (rawUrl?: string): boolean => {
                            if (!rawUrl) return false;
                            try {
                                const host = new URL(rawUrl).hostname.replace(/^www\./i, "").toLowerCase();
                                return host === cleanDomain || host.endsWith(`.${cleanDomain}`);
                            } catch {
                                return false;
                            }
                        };

                        const myUrl = urls.find((u) => matchesSiteDomain(u));
                        const position = myUrl ? urls.indexOf(myUrl) + 1 : 0;
                        const metrics  = metricsRaw[kw.keyword.toLowerCase()];

                        const itemTypes = features.items.map((i) => i.type);

                        const aioItems = features.items.filter(i => i.type === "ai_overview");
                        const brandInAio = aioItems.some(item => {
                            const rawRefs = (item as { references?: Array<string | { url?: string }>; url?: string }).references ?? [];
                            if (matchesSiteDomain(item.url)) return true;
                            return rawRefs.some(ref => {
                                const u = typeof ref === "string" ? ref : ref?.url;
                                return matchesSiteDomain(u);
                            });
                        });

                        return {
                            trackedId:    kw.id,
                            keyword:      kw.keyword,
                            device:       kw.device,
                            position,
                            url:          myUrl ?? null,
                            searchVolume: metrics?.searchVolume ?? null,
                            cpc:          metrics?.cpc          ?? null,
                            difficulty:   metrics?.difficulty   ?? null,
                            intent:       classifyIntent(kw.keyword),
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
            await step.run("upsert-serp-features", async () => {
                await prisma.serpFeatureSnapshot.createMany({
                    data: serpRows.map((s) => ({
                        siteId,
                        keyword:       s.keyword,
                        hasAiOverview: s.serpData!.hasAiOverview,
                        hasSnippet:    s.serpData!.hasSnippet,
                        hasPaa:        s.serpData!.hasPaa,
                        hasLocalPack:  s.serpData!.hasLocalPack,
                        hasVideo:      s.serpData!.hasVideo,
                        brandInAio:    s.serpData!.brandInAio,
                    })),
                });
                await Promise.all(
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
                );
            });
        }

        await step.run("dispatch-rank-webhooks", async () => {
            const todayMidnight = new Date();
            todayMidnight.setHours(0, 0, 0, 0);
            const lookbackStart = new Date(todayMidnight);
            lookbackStart.setDate(lookbackStart.getDate() - 14);

            const prevSnaps = await prisma.rankSnapshot.findMany({
                where: {
                    siteId,
                    keyword:    { in: snapshots.map((s) => s.keyword) },
                    recordedAt: { gte: lookbackStart, lt: todayMidnight },
                },
                select:   { keyword: true, position: true, recordedAt: true },
                orderBy:  { recordedAt: "desc" },
                take:     snapshots.length * 4,
                distinct: ["keyword"],
            });
            const prevMap = new Map(prevSnaps.map((p) => [p.keyword, p.position]));

            const siteRecord = await prisma.site.findUnique({
                where:  { id: siteId },
                select: { id: true, domain: true, slackWebhookUrl: true, zapierWebhookUrl: true },
            });
            if (!siteRecord) return;

            for (const snap of snapshots) {
                const prev = prevMap.get(snap.keyword);
                if (prev === undefined) continue;

                if (snap.position === 0 && prev > 0) {
                    await dispatchWebhooks(siteRecord, {
                        event:   "rank_drop",
                        summary: `"${snap.keyword}" dropped out of top 20 (was #${prev})`,
                        details: { keyword: snap.keyword, previousPos: prev, newPos: "Unranked (>20)", delta: 21 - prev },
                    });
                    continue;
                }
                if (snap.position === 0 || prev === 0) continue;

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
            const allTracked = snapshots.map((s) => ({
                position:     s.position,
                searchVolume: s.searchVolume,
            }));
            if (allTracked.length > 0) {
                await writeVisibilitySnapshot(siteId, allTracked);
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
