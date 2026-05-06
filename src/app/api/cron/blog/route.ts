export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { inngest } from "@/lib/inngest/client";

export async function GET(request: Request) {
    if (!isCronAuthorized(request)) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    const { default: prisma } = await import("@/lib/prisma");

    const sites = await prisma.site.findMany({
        where: { user: { subscriptionTier: { in: ["PRO", "AGENCY"] } } },
        select: {
            id: true,
            domain: true,
            userId: true,
            coreServices: true,
        },
    });

    const events: Array<{ name: "blog.generate"; data: Record<string, unknown> }> = [];

    for (const site of sites) {
        const topCompKeyword = await prisma.competitorKeyword.findFirst({
            where: { competitor: { siteId: site.id } },
            orderBy: { searchVolume: "desc" },
            select: {
                keyword: true,
                searchVolume: true,
                difficulty: true,
                competitor: { select: { domain: true } },
            },
        });

        if (topCompKeyword?.competitor) {
            events.push({
                name: "blog.generate",
                data: {
                    siteId:           site.id,
                    pipelineType:     "COMPETITOR_GAP",
                    keyword:          topCompKeyword.keyword,
                    competitorDomain: topCompKeyword.competitor.domain,
                    searchVolume:     topCompKeyword.searchVolume ?? 0,
                    difficulty:       topCompKeyword.difficulty ?? 0,
                    userId:           site.userId,
                },
            });
            continue;
        }

        const primaryService = (site.coreServices as string | null)?.split(",")[0]?.trim();
        if (!primaryService) {
            logger.warn(`[Cron/Blog] Site ${site.domain} has no coreServices — skipping`);
            continue;
        }

        events.push({
            name: "blog.generate",
            data: {
                siteId:       site.id,
                pipelineType: "TRENDING",
                keyword:      primaryService,
                userId:       site.userId,
            },
        });
    }

    if (events.length > 0) {
        await inngest.send(events);
    }

    logger.debug(`[Cron/Blog] Queued ${events.length} blog jobs for ${sites.length} sites`);
    return NextResponse.json({ success: true, queued: events.length, sites: sites.length });
}