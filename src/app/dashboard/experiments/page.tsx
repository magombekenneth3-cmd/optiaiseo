import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { ExperimentsDashboard } from "@/components/dashboard/ExperimentsDashboard";
import type { ExperimentRecord } from "@/lib/experiments/tracker";

export const metadata: Metadata = {
    title: "Experiments | OptiAISEO",
    description: "Track the impact of your SEO optimizations with 28-day before/after experiments.",
};

export const dynamic = "force-dynamic";

const REDIS_EXPERIMENT_KEY = "aiseo:experiments";

export default async function ExperimentsPage({
    searchParams,
}: {
    searchParams: Promise<{ siteId?: string }>;
}) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) redirect("/login");

    const { siteId } = await searchParams;
    const CUID_RE = /^[a-z0-9]{10,40}$/i;

    if (!siteId || !CUID_RE.test(siteId)) {
        const firstSite = await prisma.site.findFirst({
            where: { userId: session.user.id },
            select: { id: true },
            orderBy: { createdAt: "asc" },
        });
        if (firstSite) {
            redirect(`/dashboard/experiments?siteId=${firstSite.id}`);
        }
        redirect("/dashboard/settings");
    }

    const site = await prisma.site.findFirst({
        where: {
            id: siteId,
            OR: [{ userId: session.user.id }, { viewerId: session.user.id }],
        },
        select: { id: true, domain: true },
    });

    if (!site) redirect("/dashboard");

    const experiments: ExperimentRecord[] = [];

    try {
        const rows = await (prisma as any).experiment.findMany({
            where: { siteId },
            orderBy: { executedAt: "desc" },
        });
        for (const row of rows) {
            experiments.push({
                id: row.id,
                decisionId: row.decisionId,
                siteId: row.siteId,
                targetUrl: row.targetUrl,
                actionExecuted: row.actionExecuted,
                executedAt: new Date(row.executedAt),
                evaluationDate: new Date(row.evaluationDate),
                status: row.status,
                baseline: typeof row.baseline === "string" ? JSON.parse(row.baseline) : row.baseline,
                lift: row.lift ? (typeof row.lift === "string" ? JSON.parse(row.lift) : row.lift) : undefined,
            });
        }
    } catch { /* Fall back to Redis if DB fails */ }

    if (experiments.length === 0) {
        const redis = getRedis();
        if (redis) {
            try {
                const allRaw = await redis.hgetall<Record<string, string>>(REDIS_EXPERIMENT_KEY);
                if (allRaw) {
                    for (const value of Object.values(allRaw)) {
                        try {
                            const parsed = typeof value === "string" ? JSON.parse(value) : value;
                            if (parsed.siteId === siteId) {
                                parsed.executedAt = new Date(parsed.executedAt);
                                parsed.evaluationDate = new Date(parsed.evaluationDate);
                                experiments.push(parsed);
                            }
                        } catch { /* skip */ }
                    }
                }
            } catch { /* Redis unavailable */ }
        }
    }

    // 2. Fetch executed GrowthDecision records
    const executedDecisions = await prisma.growthDecision.findMany({
        where: {
            siteId,
            status: { in: ["APPROVED", "EXECUTED"] },
        },
        orderBy: { generatedAt: "desc" },
    });

    // 3. Build merged list
    const experimentMap = new Map(experiments.map((e) => [e.decisionId, e]));

    const mergedExperiments = executedDecisions.map((dec) => {
        const exp = experimentMap.get(dec.id);
        const score = typeof dec.score === "string" ? JSON.parse(dec.score) : dec.score;
        const impact = typeof dec.impact === "string" ? JSON.parse(dec.impact) : dec.impact;

        return {
            decisionId: dec.id,
            url: dec.url,
            primaryKeyword: dec.primaryKeyword,
            primaryCategory: dec.primaryCategory as string,
            action: dec.action as string,
            scoreFinal: score?.final ?? 0,
            trafficPotential: impact?.trafficPotential?.expected ?? 0,
            experiment: exp
                ? {
                    id: exp.id,
                    executedAt: exp.executedAt.toISOString(),
                    evaluationDate: exp.evaluationDate.toISOString(),
                    status: exp.status as string,
                    baseline: exp.baseline,
                    lift: exp.lift ?? null,
                    daysElapsed: Math.floor((Date.now() - exp.executedAt.getTime()) / (1000 * 60 * 60 * 24)),
                    daysRemaining: Math.max(0, Math.floor((exp.evaluationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
                    isReadyForEvaluation: exp.status !== "COMPLETED" && Date.now() >= exp.evaluationDate.getTime(),
                }
                : null,
        };
    });

    // 4. Compute summary
    const completed = experiments.filter((e) => e.status === "COMPLETED" && e.lift);
    const summary = {
        totalExecuted: mergedExperiments.length,
        completedEvaluations: completed.length,
        pendingEvaluations: mergedExperiments.filter((e) => e.experiment?.isReadyForEvaluation).length,
        inProgress: mergedExperiments.filter((e) => e.experiment && !e.experiment.isReadyForEvaluation && e.experiment.status !== "COMPLETED").length,
        avgPositionGain: completed.length > 0
            ? parseFloat((completed.reduce((s, e) => s + (e.lift?.positionDelta ?? 0), 0) / completed.length).toFixed(1))
            : 0,
        avgClicksLift: completed.length > 0
            ? parseFloat((completed.reduce((s, e) => s + (e.lift?.clicksLiftPercent ?? 0), 0) / completed.length).toFixed(1))
            : 0,
        totalRevenueLift: completed.reduce((s, e) => s + (e.lift?.revenueLiftAmount ?? 0), 0),
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8">
            <ExperimentsDashboard
                domain={site.domain}
                siteId={site.id}
                experiments={mergedExperiments}
                summary={summary}
            />
        </div>
    );
}
