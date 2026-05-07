import { prisma } from "@/lib/prisma";
import { unstable_cache } from "next/cache";

export const getDashboardMetrics = async (siteIds: string[]) => {
    if (!siteIds || siteIds.length === 0) {
        return {
            audits: [],
            blogsThisWeek: 0,
            pendingPrsCount: 0,
            pendingBlogs: [],
        };
    }

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [audits, blogsThisWeek, pendingPrsCount, pendingBlogs] = await Promise.all([
        prisma.audit.findMany({
            where: { siteId: { in: siteIds } },
            select: { id: true, categoryScores: true, runTimestamp: true, issueList: true },
            orderBy: { runTimestamp: 'desc' },
            take: 30,
        }),
        prisma.blog.count({
            where: { siteId: { in: siteIds }, createdAt: { gte: oneWeekAgo } }
        }),
        prisma.selfHealingLog.count({
            where: { siteId: { in: siteIds }, status: "PENDING" }
        }),
        prisma.blog.findMany({
            where: { siteId: { in: siteIds }, status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: { id: true, title: true, pipelineType: true },
        }),
    ]);

    return {
        audits,
        blogsThisWeek,
        pendingPrsCount,
        pendingBlogs,
    };
};

// Helper wrapper to inject the dynamic user ID tag for targeted on-demand revalidation
export const getCachedDashboardMetricsForUser = async (userId: string, siteIds: string[]) => {
    const siteKey = siteIds.sort().join(',');
    const cachedFn = unstable_cache(
        async () => getDashboardMetrics(siteIds),
        [`dashboard-metrics-${userId}`, siteKey],
        {
            revalidate: 300,
            tags: [`dashboard-metrics-${userId}`, 'dashboard-metrics']
        }
    );
    return cachedFn();
};
