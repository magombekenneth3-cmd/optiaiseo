export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import { fetchTrendingTopics } from "@/lib/trending/fetch-trending";
import { runDecayCheck } from "@/lib/content/decay-check";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
    if (!isCronAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const sites = await prisma.site.findMany({
            where: {
                user: { subscriptionTier: { in: ["PRO", "AGENCY"] } },
                niche: { not: null },
            },
            select: { id: true, domain: true, niche: true, location: true },
        });

        let trendingFetched = 0;
        let decayFlagged = 0;

        const CONCURRENCY = 5;
        for (let i = 0; i < sites.length; i += CONCURRENCY) {
            const batch = sites.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(
                batch.map(async (site) => {
                    if (site.niche) {
                        await fetchTrendingTopics(site.niche, site.location ?? "us");
                    }
                    return runDecayCheck(site.id);
                })
            );

            for (const r of results) {
                if (r.status === "fulfilled") {
                    decayFlagged += r.value;
                } else {
                    logger.warn("[Cron/WeeklyEnrich] Site batch error:", { reason: String(r.reason) });
                }
            }
            trendingFetched += batch.filter((s) => s.niche).length;
        }

        logger.info("[Cron/WeeklyEnrich] Done", { trendingFetched, decayFlagged });
        return NextResponse.json({ success: true, trendingFetched, decayFlagged });
    } catch (error: unknown) {
        logger.error("[Cron/WeeklyEnrich] Fatal:", { error: (error as Error)?.message || String(error) });
        return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
    }
}
