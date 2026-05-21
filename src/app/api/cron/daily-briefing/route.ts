export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/cron/daily-briefing
 *
 * Daily cron: fetch yesterday's GSC traffic, detect anomalies vs 7-day
 * average, surface the top 3 quick wins, and persist a DailyBriefing row.
 *
 * Schedule: 0 6 * * *  (06:00 UTC daily)
 */
export async function GET(req: NextRequest) {
    if (!isCronAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const sites = await prisma.site.findMany({
            where: {
                user: {
                    gscConnected: true,
                    subscriptionTier: { in: ["STARTER", "PRO", "AGENCY"] },
                },
            },
            select: { id: true, userId: true, domain: true },
        });

        let processed = 0;
        let failed = 0;

        for (const site of sites) {
            try {
                const { getUserGscToken } = await import("@/app/actions/keywords");
                const { fetchGSCKeywordsByDateRange, normaliseSiteUrl } = await import("@/lib/gsc");

                const accessToken = await getUserGscToken(site.userId);
                const siteUrl = normaliseSiteUrl(site.domain);

                // Yesterday's window
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 8);

                // Fetch yesterday
                const todayRows = await fetchGSCKeywordsByDateRange(
                    accessToken, siteUrl, yesterday, yesterday
                );
                const yesterdayTraffic = todayRows.reduce((s, r) => s + r.clicks, 0);
                const organicImpressions = todayRows.reduce((s, r) => s + r.impressions, 0);

                // Fetch prior 7 days for baseline
                const priorRows = await fetchGSCKeywordsByDateRange(
                    accessToken, siteUrl, sevenDaysAgo,
                    new Date(yesterday.getTime() - 86400000)
                );
                const priorAvgTraffic = priorRows.length > 0
                    ? priorRows.reduce((s, r) => s + r.clicks, 0) / 7
                    : 0;

                // Detect anomalies (traffic drop > 30% vs average)
                const anomalies: { type: string; detail: string }[] = [];
                if (priorAvgTraffic > 0) {
                    const dropPct = ((priorAvgTraffic - yesterdayTraffic) / priorAvgTraffic) * 100;
                    if (dropPct > 30) {
                        anomalies.push({
                            type: "traffic_drop",
                            detail: `Traffic dropped ${Math.round(dropPct)}% vs 7-day avg (${yesterdayTraffic} vs ${Math.round(priorAvgTraffic)})`,
                        });
                    } else if (dropPct < -30) {
                        anomalies.push({
                            type: "traffic_spike",
                            detail: `Traffic spiked ${Math.round(Math.abs(dropPct))}% above 7-day avg`,
                        });
                    }
                }

                // Top performing keyword yesterday
                const topKw = todayRows.sort((a, b) => b.clicks - a.clicks)[0];

                // Quick wins: keywords ranked 4-20 with high impressions
                const quickWins = todayRows
                    .filter(r => r.position >= 4 && r.position <= 20 && r.impressions > 50)
                    .sort((a, b) => b.impressions - a.impressions)
                    .slice(0, 3)
                    .map(r => ({
                        keyword: r.keyword,
                        position: Math.round(r.position),
                        impressions: r.impressions,
                        potentialClicks: Math.round(r.impressions * 0.1),
                    }));

                // Upsert DailyBriefing (one per site per day)
                const dateKey = new Date(yesterday);
                dateKey.setUTCHours(0, 0, 0, 0);

                await prisma.dailyBriefing.upsert({
                    where: {
                        // Use composite approach: delete today's if exists, then create
                        id: `${site.id}-${dateKey.toISOString().slice(0, 10)}`,
                    },
                    update: {
                        yesterdayTraffic,
                        organicImpressions,
                        topPerformingKeyword: topKw?.keyword ?? null,
                        topPerformingKeywordVolume: topKw?.impressions ?? null,
                        topPerformingKeywordPosition: topKw ? Math.round(topKw.position) : null,
                        anomaliesFound: anomalies.length > 0 ? anomalies : null,
                        quickWins: quickWins.length > 0 ? quickWins : null,
                    },
                    create: {
                        id: `${site.id}-${dateKey.toISOString().slice(0, 10)}`,
                        siteId: site.id,
                        userId: site.userId,
                        date: dateKey,
                        yesterdayTraffic,
                        organicImpressions,
                        topPerformingKeyword: topKw?.keyword ?? null,
                        topPerformingKeywordVolume: topKw?.impressions ?? null,
                        topPerformingKeywordPosition: topKw ? Math.round(topKw.position) : null,
                        anomaliesFound: anomalies.length > 0 ? anomalies : null,
                        quickWins: quickWins.length > 0 ? quickWins : null,
                    },
                });

                processed++;
            } catch (err) {
                logger.warn("[Cron/DailyBriefing] Failed for site", {
                    siteId: site.id,
                    error: (err as Error)?.message,
                });
                failed++;
            }
        }

        logger.info("[Cron/DailyBriefing] Done", { processed, failed, total: sites.length });
        return NextResponse.json({ success: true, processed, failed, total: sites.length });
    } catch (error: unknown) {
        logger.error("[Cron/DailyBriefing] Fatal:", { error: (error as Error)?.message });
        return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
    }
}
