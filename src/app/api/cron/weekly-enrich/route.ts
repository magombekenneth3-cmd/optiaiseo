export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import { fetchTrendingTopics } from "@/lib/trending/fetch-trending";
import { runDecayCheck } from "@/lib/content/decay-check";
import { proposeRefreshForDecayedBlogs } from "@/lib/content/decay-to-mutation";
import { runFullEvictionSweep } from "@/lib/cache/eviction";
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
        let refreshProposed = 0;

        const CONCURRENCY = 5;
        for (let i = 0; i < sites.length; i += CONCURRENCY) {
            const batch = sites.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(
                batch.map(async (site) => {
                    if (site.niche) {
                        await fetchTrendingTopics(site.niche, site.location ?? "us");
                    }
                    const flagged = await runDecayCheck(site.id);
                    // Bridge: propose BLOG_REFRESH mutations for all newly flagged blogs
                    if (flagged > 0) {
                        const mutations = await proposeRefreshForDecayedBlogs(site.id);
                        return { flagged, proposed: mutations.proposed.length };
                    }
                    return { flagged, proposed: 0 };
                })
            );

            for (const r of results) {
                if (r.status === "fulfilled") {
                    decayFlagged += r.value.flagged;
                    refreshProposed += r.value.proposed;
                } else {
                    logger.warn("[Cron/WeeklyEnrich] Site batch error:", { reason: String(r.reason) });
                }
            }
            trendingFetched += batch.filter((s) => s.niche).length;
        }

        const eviction = await runFullEvictionSweep();

        logger.info("[Cron/WeeklyEnrich] Done", { trendingFetched, decayFlagged, refreshProposed, eviction });
        return NextResponse.json({ success: true, trendingFetched, decayFlagged, refreshProposed, cacheEvicted: eviction.totalEvicted });
    } catch (error: unknown) {
        logger.error("[Cron/WeeklyEnrich] Fatal:", { error: (error as Error)?.message || String(error) });
        return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
    }
}
