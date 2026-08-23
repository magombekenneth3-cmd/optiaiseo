import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * GET /api/recommendations/[id]
 *
 * Returns the full opportunity detail for the workspace page:
 *  1. GrowthDecision record (score, whyNow, executionPlan)
 *  2. SerpGapAnalysis record if one exists for this keyword
 *  3. 30-day GscDailyPerformance trend for the target URL
 */
export async function GET(
    _req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id: decisionId } = await context.params;

        // 1. Fetch GrowthDecision with ownership check
        const decision = await prisma.growthDecision.findUnique({
            where: { id: decisionId },
            include: {
                site: {
                    select: {
                        id: true,
                        userId: true,
                        domain: true,
                        viewerId: true,
                    },
                },
            },
        });

        if (!decision) {
            return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
        }

        if (decision.site.userId !== session.user.id && decision.site.viewerId !== session.user.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        // 2. Fetch existing SerpGapAnalysis for this keyword (most recent)
        const serpAnalysis = await prisma.serpGapAnalysis.findFirst({
            where: {
                siteId: decision.siteId,
                keyword: decision.primaryKeyword,
            },
            orderBy: { createdAt: "desc" },
        });

        // 3. Fetch 30-day GscDailyPerformance trend for the target URL
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const dateStr = thirtyDaysAgo.toISOString().split("T")[0];

        const gscTrend = await (prisma as any).gscDailyPerformance.findMany({
            where: {
                siteId: decision.siteId,
                url: decision.url,
                date: { gte: dateStr },
                device: "ALL",
            },
            orderBy: { date: "asc" },
            select: {
                date: true,
                keyword: true,
                clicks: true,
                impressions: true,
                ctr: true,
                position: true,
            },
        });

        // Aggregate GSC data by date (sum across all keywords for this URL)
        const dailyMap = new Map<string, { date: string; clicks: number; impressions: number; avgPosition: number; posCount: number }>();
        for (const row of gscTrend) {
            const existing = dailyMap.get(row.date);
            if (existing) {
                existing.clicks += row.clicks;
                existing.impressions += row.impressions;
                existing.avgPosition += row.position;
                existing.posCount += 1;
            } else {
                dailyMap.set(row.date, {
                    date: row.date,
                    clicks: row.clicks,
                    impressions: row.impressions,
                    avgPosition: row.position,
                    posCount: 1,
                });
            }
        }

        const performanceTrend = [...dailyMap.values()].map((d) => ({
            date: d.date,
            clicks: d.clicks,
            impressions: d.impressions,
            position: Math.round((d.avgPosition / d.posCount) * 10) / 10,
        }));

        // Parse JSON fields from the decision
        const score = typeof decision.score === "string" ? JSON.parse(decision.score) : decision.score;
        const whyNow = typeof decision.whyNow === "string" ? JSON.parse(decision.whyNow) : decision.whyNow;
        const impact = typeof decision.impact === "string" ? JSON.parse(decision.impact) : decision.impact;
        const executionPlan = typeof decision.executionPlan === "string" ? JSON.parse(decision.executionPlan) : decision.executionPlan;

        return NextResponse.json({
            decision: {
                id: decision.id,
                siteId: decision.siteId,
                url: decision.url,
                primaryKeyword: decision.primaryKeyword,
                primaryCategory: decision.primaryCategory,
                opportunityCategories: decision.opportunityCategories,
                action: decision.action,
                status: decision.status,
                score,
                whyNow,
                impact,
                executionPlan,
                generatedAt: decision.generatedAt,
            },
            domain: decision.site.domain,
            serpAnalysis: serpAnalysis
                ? {
                    id: serpAnalysis.id,
                    status: serpAnalysis.status,
                    gapReport: serpAnalysis.gapReport,
                    implementationPlan: serpAnalysis.implementationPlan,
                    serpFormat: serpAnalysis.serpFormat,
                    serpHasAiOverview: serpAnalysis.serpHasAiOverview,
                    serpHasFeaturedSnippet: serpAnalysis.serpHasFeaturedSnippet,
                    gapCount: serpAnalysis.gapCount,
                    criticalGapCount: serpAnalysis.criticalGapCount,
                    competitorAvgWordCount: serpAnalysis.competitorAvgWordCount,
                    estimatedPositionGain: serpAnalysis.estimatedPositionGain,
                    executiveSummary: serpAnalysis.executiveSummary,
                    topPriority: serpAnalysis.topPriority,
                    taskCount: serpAnalysis.taskCount,
                    automatedTaskCount: serpAnalysis.automatedTaskCount,
                    errorMessage: serpAnalysis.errorMessage,
                    completedAt: serpAnalysis.completedAt,
                    createdAt: serpAnalysis.createdAt,
                }
                : null,
            performanceTrend,
        });
    } catch (err: unknown) {
        logger.error("[RecommendationsAPI] Detail fetch failed", { error: (err as Error)?.message || String(err) });
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
