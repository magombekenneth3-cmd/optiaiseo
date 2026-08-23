import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface ActionInsight {
    action: string;
    totalExperiments: number;
    completedExperiments: number;
    avgPositionDelta: number;
    avgClicksLiftPercent: number;
    avgCtrLiftPercent: number;
    totalRevenueLift: number;
    successRate: number; // % of experiments with positive clicks lift
    label: string;       // human-readable insight
}

export interface CrossExperimentInsights {
    siteId: string;
    totalExperiments: number;
    totalCompleted: number;
    byAction: ActionInsight[];
    bestAction: ActionInsight | null;
    worstAction: ActionInsight | null;
    recentTrend: "improving" | "stable" | "declining" | "insufficient_data";
    recentTrendLabel: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Core: Generate cross-experiment insights from PostgreSQL
// ────────────────────────────────────────────────────────────────────────────

export async function getCrossExperimentInsights(
    siteId: string
): Promise<CrossExperimentInsights> {
    try {
        const experiments = await (prisma as any).experiment.findMany({
            where: { siteId },
            orderBy: { executedAt: "desc" },
        });

        if (experiments.length === 0) {
            return {
                siteId,
                totalExperiments: 0,
                totalCompleted: 0,
                byAction: [],
                bestAction: null,
                worstAction: null,
                recentTrend: "insufficient_data",
                recentTrendLabel: "Not enough experiments to determine trend",
            };
        }

        const completed = experiments.filter((e: any) => e.status === "COMPLETED" && e.lift);

        // Group by action type
        const actionMap = new Map<string, { lifts: any[]; total: number }>();
        for (const exp of experiments) {
            const key = exp.actionExecuted;
            if (!actionMap.has(key)) {
                actionMap.set(key, { lifts: [], total: 0 });
            }
            const group = actionMap.get(key)!;
            group.total++;
            if (exp.status === "COMPLETED" && exp.lift) {
                const lift = typeof exp.lift === "string" ? JSON.parse(exp.lift) : exp.lift;
                group.lifts.push(lift);
            }
        }

        const byAction: ActionInsight[] = [];
        for (const [action, data] of actionMap.entries()) {
            const lifts = data.lifts;
            const completedCount = lifts.length;

            if (completedCount === 0) {
                byAction.push({
                    action,
                    totalExperiments: data.total,
                    completedExperiments: 0,
                    avgPositionDelta: 0,
                    avgClicksLiftPercent: 0,
                    avgCtrLiftPercent: 0,
                    totalRevenueLift: 0,
                    successRate: 0,
                    label: `${formatAction(action)}: ${data.total} experiment${data.total === 1 ? "" : "s"} in progress`,
                });
                continue;
            }

            const avgPosDelta = avg(lifts.map((l) => l.positionDelta ?? 0));
            const avgClicksLift = avg(lifts.map((l) => l.clicksLiftPercent ?? 0));
            const avgCtrLift = avg(lifts.map((l) => l.ctrLiftPercent ?? 0));
            const totalRev = lifts.reduce((s: number, l: any) => s + (l.revenueLiftAmount ?? 0), 0);
            const positiveCount = lifts.filter((l) => (l.clicksLiftPercent ?? 0) > 0).length;
            const successRate = round((positiveCount / completedCount) * 100);

            const label = successRate >= 70
                ? `${formatAction(action)} shows strong results: ${successRate}% success rate, avg +${avgClicksLift}% clicks`
                : successRate >= 40
                    ? `${formatAction(action)} shows mixed results: ${successRate}% success rate`
                    : `${formatAction(action)} underperforming: only ${successRate}% of experiments showed improvement`;

            byAction.push({
                action,
                totalExperiments: data.total,
                completedExperiments: completedCount,
                avgPositionDelta: avgPosDelta,
                avgClicksLiftPercent: avgClicksLift,
                avgCtrLiftPercent: avgCtrLift,
                totalRevenueLift: totalRev,
                successRate,
                label,
            });
        }

        // Sort by success rate descending
        byAction.sort((a, b) => b.successRate - a.successRate);

        const completedActions = byAction.filter((a) => a.completedExperiments > 0);
        const bestAction = completedActions.length > 0 ? completedActions[0] : null;
        const worstAction = completedActions.length > 1 ? completedActions[completedActions.length - 1] : null;

        // Recent trend: compare last 5 completed experiments vs previous 5
        const { trend, label: trendLabel } = computeRecentTrend(completed);

        return {
            siteId,
            totalExperiments: experiments.length,
            totalCompleted: completed.length,
            byAction,
            bestAction,
            worstAction,
            recentTrend: trend,
            recentTrendLabel: trendLabel,
        };
    } catch (err: unknown) {
        logger.error("[CrossExperimentInsights] Failed", { siteId, error: (err as Error)?.message });
        return {
            siteId,
            totalExperiments: 0,
            totalCompleted: 0,
            byAction: [],
            bestAction: null,
            worstAction: null,
            recentTrend: "insufficient_data",
            recentTrendLabel: "Unable to compute insights",
        };
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Prioritization weights based on historical experiment success
// ────────────────────────────────────────────────────────────────────────────

export interface ActionWeight {
    action: string;
    weight: number; // 0.0 to 2.0 multiplier
    reason: string;
}

/**
 * Returns scoring multipliers for each action type based on historical
 * experiment outcomes. Actions with higher success rates get a boost;
 * actions that underperform get a penalty.
 */
export async function getActionWeights(siteId: string): Promise<ActionWeight[]> {
    const insights = await getCrossExperimentInsights(siteId);

    if (insights.totalCompleted < 3) {
        // Not enough data — return neutral weights
        return [];
    }

    return insights.byAction
        .filter((a) => a.completedExperiments >= 2)
        .map((a) => {
            let weight: number;
            let reason: string;

            if (a.successRate >= 75) {
                weight = 1.5;
                reason = `${formatAction(a.action)} has ${a.successRate}% success rate — boosted`;
            } else if (a.successRate >= 50) {
                weight = 1.1;
                reason = `${formatAction(a.action)} has ${a.successRate}% success rate — slightly boosted`;
            } else if (a.successRate >= 25) {
                weight = 0.8;
                reason = `${formatAction(a.action)} has ${a.successRate}% success rate — slightly deprioritized`;
            } else {
                weight = 0.5;
                reason = `${formatAction(a.action)} has ${a.successRate}% success rate — deprioritized`;
            }

            return { action: a.action, weight, reason };
        });
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function avg(nums: number[]): number {
    if (nums.length === 0) return 0;
    return round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function round(n: number): number {
    return parseFloat(n.toFixed(1));
}

function formatAction(action: string): string {
    return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function computeRecentTrend(
    completedExperiments: any[]
): { trend: "improving" | "stable" | "declining" | "insufficient_data"; label: string } {
    if (completedExperiments.length < 4) {
        return { trend: "insufficient_data", label: "Need at least 4 completed experiments to determine trend" };
    }

    // Sort by executedAt descending (most recent first)
    const sorted = [...completedExperiments].sort(
        (a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime()
    );

    const recentHalf = sorted.slice(0, Math.ceil(sorted.length / 2));
    const olderHalf = sorted.slice(Math.ceil(sorted.length / 2));

    const recentAvg = avg(recentHalf.map((e: any) => {
        const lift = typeof e.lift === "string" ? JSON.parse(e.lift) : e.lift;
        return lift?.clicksLiftPercent ?? 0;
    }));

    const olderAvg = avg(olderHalf.map((e: any) => {
        const lift = typeof e.lift === "string" ? JSON.parse(e.lift) : e.lift;
        return lift?.clicksLiftPercent ?? 0;
    }));

    const diff = recentAvg - olderAvg;

    if (diff > 5) {
        return {
            trend: "improving",
            label: `Recent experiments show stronger results (+${round(diff)}pp avg clicks lift vs earlier experiments)`,
        };
    } else if (diff < -5) {
        return {
            trend: "declining",
            label: `Recent experiments show weaker results (${round(diff)}pp avg clicks lift vs earlier experiments)`,
        };
    } else {
        return {
            trend: "stable",
            label: `Experiment effectiveness is consistent across recent and earlier optimizations`,
        };
    }
}
