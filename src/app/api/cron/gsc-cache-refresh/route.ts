export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { revalidateTag } from "next/cache";

/**
 * GET /api/cron/gsc-cache-refresh
 *
 * Weekly cron: bust the GSC keyword cache for every active site so the
 * Planner opportunity panel always shows fresh data.
 *
 * Also auto-queues SERP gap analyses for the top 15 page-2 opportunities
 * (positions 11-25) per paid-tier site that has GSC connected.
 *
 * Schedule (vercel.json / upstash): 0 3 * * 1  (03:00 UTC every Monday)
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
            select: { id: true, userId: true, domain: true },
        });

        let busted = 0;
        let serpGapsQueued = 0;

        for (const site of sites) {
            // 1. Bust GSC cache tag
            try {
                revalidateTag(`gsc-keywords-${site.id}`);
                busted++;
            } catch (err) {
                logger.warn("[Cron/GscCacheRefresh] Failed to bust cache for site", {
                    siteId: site.id,
                    error: (err as Error)?.message,
                });
            }

            // 2. Auto-queue SERP gap for page-2 keywords (positions 11-25)
            try {
                // Find rank snapshots in page-2 range from the last 7 days
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

                const page2Keywords = await prisma.rankSnapshot.findMany({
                    where: {
                        siteId: site.id,
                        position: { gte: 11, lte: 25 },
                        recordedAt: { gte: sevenDaysAgo },
                    },
                    orderBy: { recordedAt: "desc" },
                    distinct: ["keyword"],
                    take: 15,
                    select: { keyword: true, position: true, url: true },
                });

                if (page2Keywords.length === 0) continue;

                // Check existing analyses to avoid duplicates
                const existingKeywords = await prisma.serpGapAnalysis.findMany({
                    where: {
                        siteId: site.id,
                        keyword: { in: page2Keywords.map(k => k.keyword) },
                        status: { in: ["PENDING", "SCRAPING", "PLANNING", "COMPLETED"] },
                        createdAt: { gte: sevenDaysAgo },
                    },
                    select: { keyword: true },
                });
                const existingSet = new Set(existingKeywords.map(e => e.keyword));

                const toQueue = page2Keywords.filter(k => !existingSet.has(k.keyword));
                if (toQueue.length === 0) continue;

                // Check credit balance — require at least 5 credits
                const user = await prisma.user.findUnique({
                    where: { id: site.userId },
                    select: { credits: true },
                });
                if (!user || user.credits < 5) continue;

                const { inngest } = await import("@/lib/inngest");

                for (const kw of toQueue.slice(0, 5)) {
                    const analysis = await prisma.serpGapAnalysis.create({
                        data: {
                            siteId: site.id,
                            userId: site.userId,
                            keyword: kw.keyword,
                            clientUrl: kw.url ?? `https://${site.domain}`,
                            clientPosition: kw.position,
                            status: "PENDING",
                            autoQueued: true,
                        },
                    });

                    await inngest.send({
                        name: "serp-gap/requested",
                        data: { analysisId: analysis.id, siteId: site.id, userId: site.userId },
                    });
                    serpGapsQueued++;
                }
            } catch (err) {
                logger.warn("[Cron/GscCacheRefresh] SERP gap auto-queue failed for site", {
                    siteId: site.id,
                    error: (err as Error)?.message,
                });
            }
        }

        logger.info("[Cron/GscCacheRefresh] Done", { busted, serpGapsQueued, total: sites.length });
        return NextResponse.json({ success: true, busted, serpGapsQueued, total: sites.length });
    } catch (error: unknown) {
        logger.error("[Cron/GscCacheRefresh] Fatal:", { error: (error as Error)?.message });
        return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
    }
}
