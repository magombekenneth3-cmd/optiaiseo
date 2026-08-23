import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OpportunityWorkspace } from "@/components/dashboard/OpportunityWorkspace";

export const metadata: Metadata = {
    title: "Opportunity Workspace | OptiAISEO",
    description: "Review evidence, analyse SERP gaps, and take action on a search opportunity.",
};

export const dynamic = "force-dynamic";

export default async function OpportunityWorkspacePage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) redirect("/login");

    const { id: decisionId } = await params;

    // 1. Fetch GrowthDecision with ownership check
    const decision = await prisma.growthDecision.findUnique({
        where: { id: decisionId },
        include: {
            site: {
                select: {
                    id: true,
                    userId: true,
                    viewerId: true,
                    domain: true,
                },
            },
        },
    });

    if (!decision) notFound();
    if (decision.site.userId !== session.user.id && decision.site.viewerId !== session.user.id) {
        redirect("/dashboard");
    }

    // 2. Fetch most recent SerpGapAnalysis for this keyword
    const serpAnalysis = await prisma.serpGapAnalysis.findFirst({
        where: {
            siteId: decision.siteId,
            keyword: decision.primaryKeyword,
        },
        orderBy: { createdAt: "desc" },
    });

    // 3. Fetch 30-day GSC performance trend for this URL
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString().split("T")[0];

    const gscRows = await (prisma as any).gscDailyPerformance.findMany({
        where: {
            siteId: decision.siteId,
            url: decision.url,
            date: { gte: dateStr },
            device: "ALL",
        },
        orderBy: { date: "asc" },
        select: {
            date: true,
            clicks: true,
            impressions: true,
            position: true,
        },
    });

    // Aggregate by date
    const dailyMap = new Map<string, { clicks: number; impressions: number; totalPos: number; count: number }>();
    for (const row of gscRows) {
        const existing = dailyMap.get(row.date);
        if (existing) {
            existing.clicks += row.clicks;
            existing.impressions += row.impressions;
            existing.totalPos += row.position;
            existing.count += 1;
        } else {
            dailyMap.set(row.date, { clicks: row.clicks, impressions: row.impressions, totalPos: row.position, count: 1 });
        }
    }

    const performanceTrend = [...dailyMap.entries()].map(([date, d]) => ({
        date,
        clicks: d.clicks,
        impressions: d.impressions,
        position: Math.round((d.totalPos / d.count) * 10) / 10,
    }));

    // Parse JSON fields
    const score = typeof decision.score === "string" ? JSON.parse(decision.score) : decision.score;
    const whyNow = typeof decision.whyNow === "string" ? JSON.parse(decision.whyNow) : decision.whyNow;
    const impact = typeof decision.impact === "string" ? JSON.parse(decision.impact) : decision.impact;
    const executionPlan = typeof decision.executionPlan === "string" ? JSON.parse(decision.executionPlan) : decision.executionPlan;

    return (
        <div className="p-4 sm:p-6 lg:p-8">
            <OpportunityWorkspace
                decision={{
                    id: decision.id,
                    siteId: decision.siteId,
                    url: decision.url,
                    primaryKeyword: decision.primaryKeyword,
                    primaryCategory: decision.primaryCategory as string,
                    opportunityCategories: decision.opportunityCategories as string[],
                    action: decision.action as string,
                    status: decision.status as string,
                    score,
                    whyNow,
                    impact,
                    executionPlan,
                }}
                domain={decision.site.domain}
                serpAnalysis={serpAnalysis ? {
                    id: serpAnalysis.id,
                    status: serpAnalysis.status,
                    gapReport: serpAnalysis.gapReport as any,
                    implementationPlan: serpAnalysis.implementationPlan as any,
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
                    completedAt: serpAnalysis.completedAt?.toISOString() ?? null,
                    createdAt: serpAnalysis.createdAt.toISOString(),
                } : null}
                performanceTrend={performanceTrend}
            />
        </div>
    );
}
