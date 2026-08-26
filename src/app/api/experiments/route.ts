import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getCrossExperimentInsights } from "@/lib/experiments/insights";
import { getGscHealthStatus } from "@/lib/gsc/health-monitor";
import type { ExperimentRecord } from "@/lib/experiments/tracker";

/**
 * GET /api/experiments?siteId=xxx
 *
 * Returns all experiment records for a site plus their associated
 * GrowthDecision metadata and GSC performance trends.
 *
 * PostgreSQL is the sole source of truth — no Redis fallback.
 */
export async function GET(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const siteId = req.nextUrl.searchParams.get("siteId");
        if (!siteId) {
            return NextResponse.json({ error: "siteId is required" }, { status: 400 });
        }

        // Ownership check
        const site = await prisma.site.findFirst({
            where: {
                id: siteId,
                OR: [{ userId: session.user.id }, { viewerId: session.user.id }],
            },
            select: { id: true, domain: true },
        });

        if (!site) {
            return NextResponse.json({ error: "Site not found or unauthorized" }, { status: 403 });
        }

        // 1. Fetch experiment records from PostgreSQL (sole source of truth)
        let experiments: ExperimentRecord[] = [];
        try {
            const dbRows = await (prisma as any).experiment.findMany({
                where: { siteId },
                orderBy: { executedAt: "desc" },
            });
            experiments = dbRows.map((row: any) => ({
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
            }));
        } catch (dbErr: unknown) {
            logger.error("[ExperimentsAPI] PostgreSQL read failed", {
                siteId, error: (dbErr as Error)?.message,
            });
            return NextResponse.json(
                { error: "Experiment data temporarily unavailable" },
                { status: 503 }
            );
        }

        // 2. Also fetch GrowthDecision records with status APPROVED/EXECUTED
        const executedDecisions = await prisma.growthDecision.findMany({
            where: {
                siteId,
                status: { in: ["APPROVED", "EXECUTED"] },
            },
            orderBy: { generatedAt: "desc" },
        });

        // 3. Build merged experiment list
        // Match decisions to experiments by decisionId
        const experimentMap = new Map(experiments.map((e) => [e.decisionId, e]));

        const mergedExperiments = executedDecisions.map((dec) => {
            const exp = experimentMap.get(dec.id);

            // Parse JSON fields
            const score = typeof dec.score === "string" ? JSON.parse(dec.score) : dec.score;
            const whyNow = typeof dec.whyNow === "string" ? JSON.parse(dec.whyNow) : dec.whyNow;
            const impact = typeof dec.impact === "string" ? JSON.parse(dec.impact) : dec.impact;

            return {
                decisionId: dec.id,
                url: dec.url,
                primaryKeyword: dec.primaryKeyword,
                primaryCategory: dec.primaryCategory,
                action: dec.action,
                status: dec.status,
                score,
                whyNow,
                impact,
                experiment: exp
                    ? {
                        id: exp.id,
                        executedAt: exp.executedAt.toISOString(),
                        evaluationDate: exp.evaluationDate.toISOString(),
                        status: exp.status,
                        baseline: exp.baseline,
                        lift: exp.lift ?? null,
                        daysElapsed: Math.floor(
                            (Date.now() - exp.executedAt.getTime()) / (1000 * 60 * 60 * 24)
                        ),
                        daysRemaining: Math.max(
                            0,
                            Math.floor(
                                (exp.evaluationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                            )
                        ),
                        isReadyForEvaluation:
                            exp.status !== "COMPLETED" &&
                            Date.now() >= exp.evaluationDate.getTime(),
                    }
                    : null,
            };
        });

        // Also include experiments that have no matching GrowthDecision (edge case)
        for (const exp of experiments) {
            if (!executedDecisions.find((d) => d.id === exp.decisionId)) {
                mergedExperiments.push({
                    decisionId: exp.decisionId,
                    url: exp.targetUrl,
                    primaryKeyword: "Unknown",
                    primaryCategory: "UNKNOWN",
                    action: exp.actionExecuted,
                    status: "EXECUTED",
                    score: null,
                    whyNow: null,
                    impact: null,
                    experiment: {
                        id: exp.id,
                        executedAt: exp.executedAt.toISOString(),
                        evaluationDate: exp.evaluationDate.toISOString(),
                        status: exp.status,
                        baseline: exp.baseline,
                        lift: exp.lift ?? null,
                        daysElapsed: Math.floor(
                            (Date.now() - exp.executedAt.getTime()) / (1000 * 60 * 60 * 24)
                        ),
                        daysRemaining: Math.max(
                            0,
                            Math.floor(
                                (exp.evaluationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                            )
                        ),
                        isReadyForEvaluation:
                            exp.status !== "COMPLETED" &&
                            Date.now() >= exp.evaluationDate.getTime(),
                    },
                });
            }
        }

        // 4. Compute summary
        const completed = experiments.filter((e) => e.status === "COMPLETED" && e.lift);
        const summary = {
            totalExecuted: mergedExperiments.length,
            completedEvaluations: completed.length,
            pendingEvaluations: mergedExperiments.filter(
                (e) => e.experiment && e.experiment.isReadyForEvaluation
            ).length,
            inProgress: mergedExperiments.filter(
                (e) => e.experiment && !e.experiment.isReadyForEvaluation && e.experiment.status !== "COMPLETED"
            ).length,
            avgPositionGain:
                completed.length > 0
                    ? parseFloat(
                        (
                            completed.reduce((s, e) => s + (e.lift?.positionDelta ?? 0), 0) /
                            completed.length
                        ).toFixed(1)
                    )
                    : 0,
            avgClicksLift:
                completed.length > 0
                    ? parseFloat(
                        (
                            completed.reduce((s, e) => s + (e.lift?.clicksLiftPercent ?? 0), 0) /
                            completed.length
                        ).toFixed(1)
                    )
                    : 0,
            totalRevenueLift: completed.reduce(
                (s, e) => s + (e.lift?.revenueLiftAmount ?? 0),
                0
            ),
        };

        // 5. Fetch cross-experiment insights and GSC health
        const [insights, gscHealth] = await Promise.all([
            getCrossExperimentInsights(siteId),
            getGscHealthStatus(siteId),
        ]);

        return NextResponse.json({
            domain: site.domain,
            experiments: mergedExperiments,
            summary,
            insights,
            gscHealth,
        });
    } catch (err: unknown) {
        logger.error("[ExperimentsAPI] Fetch failed", {
            error: (err as Error)?.message || String(err),
        });
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
