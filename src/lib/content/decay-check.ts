import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { differenceInMonths } from "date-fns";

function calcLinearTrend(values: number[]): number {
    const n = values.length;
    if (n < 2) return 0;

    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((acc, y, i) => acc + i * y, 0);
    const sumX2 = values.reduce((acc, _, i) => acc + i * i, 0);

    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return 0;

    return (n * sumXY - sumX * sumY) / denom;
}

export async function runDecayCheck(siteId: string): Promise<number> {
    // Query 1 — all published blogs that haven't been flagged yet
    const blogs = await prisma.blog.findMany({
        where: { siteId, status: "PUBLISHED", needsRefresh: false },
        select: { id: true, publishedAt: true, targetKeywords: true },
    });

    // Filter to only blogs >= 4 months old in memory (avoids extra DB param)
    const eligibleBlogs = blogs.filter(
        (b) => b.publishedAt && differenceInMonths(new Date(), b.publishedAt) >= 4
    );
    if (eligibleBlogs.length === 0) return 0;

    // Query 2 — all rank snapshots for every keyword across all eligible blogs
    const allKeywords = [...new Set(eligibleBlogs.flatMap((b) => b.targetKeywords))];
    const allSnapshots = await prisma.rankSnapshot.findMany({
        where: { siteId, keyword: { in: allKeywords } },
        orderBy: { recordedAt: "desc" },
    });

    // Group snapshots by keyword in memory — O(n) map build, O(1) lookups
    const byKeyword = new Map<string, typeof allSnapshots>();
    for (const snap of allSnapshots) {
        if (!byKeyword.has(snap.keyword)) byKeyword.set(snap.keyword, []);
        byKeyword.get(snap.keyword)!.push(snap);
    }

    const toFlag: string[] = [];

    for (const blog of eligibleBlogs) {
        // Gather the most recent 8 snapshots across all of this blog's keywords
        const snapshots = blog.targetKeywords
            .flatMap((kw) => byKeyword.get(kw) ?? [])
            .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
            .slice(0, 8);

        if (snapshots.length < 2) continue;

        const positionTrend = calcLinearTrend(snapshots.map((s) => s.position));
        const topPosition = snapshots[0].position;
        const isRankingAndStale = topPosition <= 20 && positionTrend > 1.5;

        if (isRankingAndStale) {
            toFlag.push(blog.id);
            logger.info("[ContentDecay] Flagging blog for refresh", {
                blogId: blog.id,
                topPosition,
                trend: positionTrend.toFixed(2),
            });
        }
    }

    if (toFlag.length === 0) return 0;

    // Query 3 — one bulk updateMany instead of N individual updates
    await prisma.blog.updateMany({
        where: { id: { in: toFlag } },
        data: { needsRefresh: true },
    });

    return toFlag.length;
}
