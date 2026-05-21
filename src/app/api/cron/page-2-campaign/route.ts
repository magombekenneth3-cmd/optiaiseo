export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/cron/page-2-campaign
 *
 * Daily cron: for each paid-tier site, find all keywords currently ranked
 * in positions 11-25 ("page 2"), group them into a Campaign record, and
 * fire an Inngest event so the AI can generate page-level improvement tasks.
 *
 * Skips sites that already have a PENDING / ACTIVE campaign created today.
 *
 * Schedule: 0 5 * * *  (05:00 UTC daily)
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

        let campaignsCreated = 0;
        let skipped = 0;

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);

        for (const site of sites) {
            try {
                // Skip if an active page-2 campaign was already created today
                const existingCampaign = await prisma.campaign.findFirst({
                    where: {
                        siteId: site.id,
                        type: "PAGE_2_PUSH",
                        status: { in: ["PENDING", "ACTIVE"] },
                        createdAt: { gte: todayStart },
                    },
                });
                if (existingCampaign) { skipped++; continue; }

                // Fetch page-2 keywords from the last 7 days of rank snapshots
                const page2Keywords = await prisma.rankSnapshot.findMany({
                    where: {
                        siteId: site.id,
                        position: { gte: 11, lte: 25 },
                        recordedAt: { gte: sevenDaysAgo },
                    },
                    orderBy: { recordedAt: "desc" },
                    distinct: ["keyword"],
                    take: 30,
                    select: { keyword: true, position: true, url: true, searchVolume: true },
                });

                if (page2Keywords.length === 0) { skipped++; continue; }

                // Prioritise by impressions (highest opportunity first)
                const sorted = page2Keywords.sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0));

                // Group by landing URL for efficient content work
                const urlGroups = new Map<string, typeof sorted>();
                for (const kw of sorted) {
                    const u = kw.url ?? `https://${site.domain}`;
                    if (!urlGroups.has(u)) urlGroups.set(u, []);
                    urlGroups.get(u)!.push(kw);
                }

                // Create Campaign
                const campaign = await prisma.campaign.create({
                    data: {
                        siteId: site.id,
                        userId: site.userId,
                        type: "PAGE_2_PUSH",
                        status: "PENDING",
                        name: `Page-2 Push — ${new Date().toLocaleDateString("en-GB", { month: "short", day: "numeric" })}`,
                        keywordCount: page2Keywords.length,
                        urlCount: urlGroups.size,
                        keywords: sorted.map(k => ({
                            keyword: k.keyword,
                            position: k.position,
                            url: k.url,
                            searchVolume: k.searchVolume,
                        })),
                    },
                });

                // Fire Inngest event so the AI planner can generate content tasks
                const { inngest } = await import("@/lib/inngest");
                await inngest.send({
                    name: "campaign/page-2-push/requested",
                    data: {
                        campaignId: campaign.id,
                        siteId: site.id,
                        userId: site.userId,
                        domain: site.domain,
                        topUrls: Array.from(urlGroups.entries())
                            .slice(0, 5)
                            .map(([url, kws]) => ({
                                url,
                                keywords: kws.slice(0, 5).map(k => k.keyword),
                                avgPosition: Math.round(kws.reduce((s, k) => s + (k.position ?? 20), 0) / kws.length),
                                totalSearchVolume: kws.reduce((s, k) => s + (k.searchVolume ?? 0), 0),
                            })),
                    },
                });

                campaignsCreated++;
            } catch (err) {
                logger.warn("[Cron/Page2Campaign] Failed for site", {
                    siteId: site.id,
                    error: (err as Error)?.message,
                });
                skipped++;
            }
        }

        logger.info("[Cron/Page2Campaign] Done", { campaignsCreated, skipped, total: sites.length });
        return NextResponse.json({ success: true, campaignsCreated, skipped, total: sites.length });
    } catch (error: unknown) {
        logger.error("[Cron/Page2Campaign] Fatal:", { error: (error as Error)?.message });
        return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
    }
}
