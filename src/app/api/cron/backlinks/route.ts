export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import { inngest } from "@/lib/inngest/client";

export async function GET(req: NextRequest) {
    if (!isCronAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!process.env.DATAFORSEO_LOGIN && !process.env.AHREFS_API_KEY) {
        logger.warn("[Cron/Backlinks] No backlink credentials configured — skipping");
        return NextResponse.json({ success: true, skipped: true, reason: "no_credentials" });
    }

    const sites = await prisma.site.findMany({
        where: { user: { subscriptionTier: { in: ["PRO", "AGENCY"] } } },
        select: { id: true, domain: true },
    });

    if (sites.length > 0) {
        await inngest.send(
            sites.map((site) => ({
                name: "backlinks.check.site" as const,
                data: { siteId: site.id, domain: site.domain },
            }))
        );
    }

    logger.debug(`[Cron/Backlinks] Queued ${sites.length} sites`);
    return NextResponse.json({ success: true, queued: sites.length });
}
