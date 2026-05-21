export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/cron/competitor-velocity
 *
 * Weekly cron: compare current vs previous competitor keyword positions.
 * If a competitor gains >5 positions on >=10 mutual keywords where the
 * host also ranks, create a CompetitorAlert record.
 *
 * Schedule: 0 4 * * 0  (04:00 UTC every Sunday)
 */
export async function GET(req: NextRequest) {
    if (!isCronAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const sites = await prisma.site.findMany({
            where: {
                user: { subscriptionTier: { in: ["STARTER", "PRO", "AGENCY"] } },
            },
            include: {
                competitors: {
                    where: { deletedAt: null },
                    select: { id: true, domain: true },
                },
            },
        });

        let alertsCreated = 0;

        for (const site of sites) {
            for (const competitor of site.competitors) {
                try {
                    const now = new Date();
                    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

                    // Current week keywords
                    const currentKws = await prisma.competitorKeyword.findMany({
                        where: {
                            competitorId: competitor.id,
                            fetchedAt: { gte: oneWeekAgo },
                        },
                        select: { keyword: true, position: true },
                    });

                    // Previous week keywords
                    const previousKws = await prisma.competitorKeyword.findMany({
                        where: {
                            competitorId: competitor.id,
                            fetchedAt: { gte: twoWeeksAgo, lt: oneWeekAgo },
                        },
                        select: { keyword: true, position: true },
                    });

                    if (currentKws.length === 0 || previousKws.length === 0) continue;

                    const prevMap = new Map(previousKws.map(k => [k.keyword, k.position ?? 100]));
                    const currMap = new Map(currentKws.map(k => [k.keyword, k.position ?? 100]));

                    // Find host site's tracked keywords for mutual comparison
                    const siteKeywords = await prisma.rankSnapshot.findMany({
                        where: {
                            siteId: site.id,
                            recordedAt: { gte: oneWeekAgo },
                        },
                        distinct: ["keyword"],
                        select: { keyword: true, position: true },
                    });
                    const siteKwSet = new Set(siteKeywords.map(k => k.keyword.toLowerCase()));

                    // Detect significant gains (position number decreased = rank improved)
                    const significantGains: { keyword: string; oldPos: number; newPos: number; delta: number }[] = [];
                    for (const [keyword, currPos] of currMap) {
                        const prevPos = prevMap.get(keyword);
                        if (!prevPos) continue;
                        const delta = prevPos - currPos; // positive = improved
                        if (delta > 5 && siteKwSet.has(keyword.toLowerCase())) {
                            significantGains.push({ keyword, oldPos: prevPos, newPos: currPos, delta });
                        }
                    }

                    if (significantGains.length < 10) continue;

                    // Check if we already alerted for this within 7 days
                    const recentAlert = await prisma.competitorAlert.findFirst({
                        where: {
                            siteId: site.id,
                            competitor: competitor.domain,
                            createdAt: { gte: oneWeekAgo },
                        },
                    });
                    if (recentAlert) continue;

                    await prisma.competitorAlert.create({
                        data: {
                            siteId: site.id,
                            competitor: competitor.domain,
                            gainedCount: significantGains.length,
                            message: `${competitor.domain} gained significant rankings on ${significantGains.length} keywords you both target — review your content strategy.`,
                            details: significantGains.slice(0, 20),
                        },
                    });
                    alertsCreated++;
                } catch (err) {
                    logger.warn("[Cron/CompetitorVelocity] Failed for competitor", {
                        siteId: site.id,
                        competitor: competitor.domain,
                        error: (err as Error)?.message,
                    });
                }
            }
        }

        logger.info("[Cron/CompetitorVelocity] Done", { alertsCreated, sitesProcessed: sites.length });
        return NextResponse.json({ success: true, alertsCreated, sitesProcessed: sites.length });
    } catch (error: unknown) {
        logger.error("[Cron/CompetitorVelocity] Fatal:", { error: (error as Error)?.message });
        return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
    }
}
