export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { inngest } from "@/lib/inngest/client";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
    if (!isCronAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sites = await prisma.site.findMany({
        where: { user: { subscriptionTier: { in: ["PRO", "AGENCY"] } } },
        select: { id: true, domain: true, userId: true },
        orderBy: { updatedAt: "asc" },
    });

    await inngest.send(
        sites.map((site) => ({
            name: "rank.tracker.site" as const,
            data: { siteId: site.id, domain: site.domain, userId: site.userId },
        }))
    );

    logger.info("[RankTracker/Cron] Fan-out dispatched", { siteCount: sites.length });
    return NextResponse.json({ dispatched: sites.length });
}
