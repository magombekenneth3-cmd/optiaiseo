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
 * Schedule (vercel.json / upstash): 0 3 * * 1  (03:00 UTC every Monday)
 */
export async function GET(req: NextRequest) {
    if (!isCronAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        // Only bust caches for sites belonging to active subscribers —
        // free-tier users are rate-limited on GSC anyway.
        const sites = await prisma.site.findMany({
            where: {
                user: { subscriptionTier: { in: ["STARTER", "PRO", "AGENCY"] } },
            },
            select: { id: true },
        });

        let busted = 0;
        for (const site of sites) {
            try {
                revalidateTag(`gsc-keywords-${site.id}`);
                busted++;
            } catch (err) {
                logger.warn("[Cron/GscCacheRefresh] Failed to bust cache for site", {
                    siteId: site.id,
                    error: (err as Error)?.message,
                });
            }
        }

        logger.info("[Cron/GscCacheRefresh] Done", { busted, total: sites.length });
        return NextResponse.json({ success: true, busted, total: sites.length });
    } catch (error: unknown) {
        logger.error("[Cron/GscCacheRefresh] Fatal:", { error: (error as Error)?.message });
        return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
    }
}
