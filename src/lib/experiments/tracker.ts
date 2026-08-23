import { logger } from "@/lib/logger";
import { getRedis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";

export interface BaselineMetrics {
    position: number;
    clicks: number;
    impressions: number;
    ctr: number;
    monthlyRevenueEstimate: number;
    aeoCitationRate: number;
}

export interface LiftMetrics {
    positionDelta: number;
    clicksLiftPercent: number;
    impressionsLiftPercent: number;
    ctrLiftPercent: number;
    revenueLiftAmount: number;
    aeoCitationLiftPercent: number;
}

export interface ExperimentRecord {
    id: string;
    decisionId: string;
    siteId: string;
    targetUrl: string;
    actionExecuted: string;
    executedAt: Date;
    evaluationDate: Date;
    status: "RECORDED" | "EVALUATING" | "COMPLETED";
    baseline: BaselineMetrics;
    lift?: LiftMetrics;
}

export interface SiteExperimentSummary {
    siteId: string;
    totalExperimentsExecuted: number;
    completedExperiments: number;
    averagePositionGain: number;
    averageCtrLiftPercent: number;
    totalRevenueGenerated: number;
    averageCitationLiftPercent: number;
}

// Redis-backed experiment store (DB-backed baseline metrics)
const REDIS_EXPERIMENT_KEY = "aiseo:experiments";

// ────────────────────────────────────────────────────────────────────────────
// Helpers: query real GSC performance from the persistent data layer
// ────────────────────────────────────────────────────────────────────────────

function dateFmt(d: Date): string {
    return d.toISOString().split("T")[0];
}

/**
 * Aggregate GSC metrics for a URL over a date range from the persistent
 * GscDailyPerformance table. Returns null if no data is found.
 */
async function getPerformanceForUrl(
    siteId: string,
    targetUrl: string,
    startDate: Date,
    endDate: Date
): Promise<{ position: number; clicks: number; impressions: number; ctr: number } | null> {
    try {
        // Normalize URL for matching (strip trailing slash and query params)
        const cleanUrl = targetUrl.split("?")[0].replace(/\/$/, "");

        const rows = await prisma.gscDailyPerformance.aggregate({
            where: {
                siteId,
                url: cleanUrl,
                device: "ALL",
                date: { gte: dateFmt(startDate), lte: dateFmt(endDate) },
            },
            _sum: { clicks: true, impressions: true },
            _avg: { position: true, ctr: true },
        });

        const clicks = rows._sum.clicks ?? 0;
        const impressions = rows._sum.impressions ?? 0;

        if (impressions === 0) return null;

        return {
            position: parseFloat((rows._avg.position ?? 0).toFixed(1)),
            clicks,
            impressions,
            ctr: parseFloat((rows._avg.ctr ?? 0).toFixed(2)),
        };
    } catch (err: unknown) {
        logger.warn("[ExperimentTracker] Failed to query GscDailyPerformance", {
            siteId, targetUrl, error: (err as Error)?.message,
        });
        return null;
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Core: Record baseline at T0 (when a growth decision is executed)
// ────────────────────────────────────────────────────────────────────────────

export async function recordExperimentBaseline(
    decisionId: string,
    siteId: string,
    targetUrl: string,
    actionExecuted: string
): Promise<ExperimentRecord> {
    const executedAt = new Date();
    const evaluationDate = new Date(executedAt.getTime() + 28 * 24 * 60 * 60 * 1000);

    // Query real baseline: 28 days of performance data BEFORE the action
    const baselineStart = new Date(executedAt.getTime() - 28 * 24 * 60 * 60 * 1000);
    const realMetrics = await getPerformanceForUrl(siteId, targetUrl, baselineStart, executedAt);

    const baseline: BaselineMetrics = realMetrics
        ? {
            position: realMetrics.position,
            clicks: realMetrics.clicks,
            impressions: realMetrics.impressions,
            ctr: realMetrics.ctr,
            // Revenue estimate: conservative $7 per click assumption for commercial pages
            monthlyRevenueEstimate: Math.round(realMetrics.clicks * 7),
            // AEO citation rate: will be populated when AEO integration is added
            aeoCitationRate: 0,
        }
        : {
            // Graceful degradation: if no DB data exists yet, use zeros instead
            // of hardcoded mock values. The UI should display "baseline pending".
            position: 0,
            clicks: 0,
            impressions: 0,
            ctr: 0,
            monthlyRevenueEstimate: 0,
            aeoCitationRate: 0,
        };

    const experiment: ExperimentRecord = {
        id: `exp-${decisionId}`,
        decisionId,
        siteId,
        targetUrl,
        actionExecuted,
        executedAt,
        evaluationDate,
        status: "RECORDED",
        baseline,
    };

    // Persist to Redis for cross-request access
    const redis = getRedis();
    if (redis) {
        try {
            await redis.hset(REDIS_EXPERIMENT_KEY, { [experiment.id]: JSON.stringify(experiment) });
        } catch { /* Fail open */ }
    }

    logger.info("[ExperimentTracker] Recorded T0 baseline metrics", {
        experimentId: experiment.id,
        siteId,
        targetUrl,
        baselinePosition: baseline.position,
        baselineClicks: baseline.clicks,
        hasRealData: !!realMetrics,
        evaluationDate,
    });

    return experiment;
}

// ────────────────────────────────────────────────────────────────────────────
// Core: Evaluate 28-day lift (after the optimization has had time to work)
// ────────────────────────────────────────────────────────────────────────────

export async function evaluate28DayExperimentLift(
    experimentId: string
): Promise<ExperimentRecord> {
    // Retrieve the experiment record from Redis
    let exp: ExperimentRecord | null = null;

    const redis = getRedis();
    if (redis) {
        try {
            const raw = await redis.hget<string>(REDIS_EXPERIMENT_KEY, experimentId);
            if (raw) {
                const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
                parsed.executedAt = new Date(parsed.executedAt);
                parsed.evaluationDate = new Date(parsed.evaluationDate);
                exp = parsed;
            }
        } catch { /* Fall through */ }
    }

    if (!exp) {
        logger.warn("[ExperimentTracker] Experiment not found, returning empty evaluation", { experimentId });
        return {
            id: experimentId,
            decisionId: experimentId.replace(/^exp-/, ""),
            siteId: "unknown",
            targetUrl: "/",
            actionExecuted: "UNKNOWN",
            executedAt: new Date(),
            evaluationDate: new Date(),
            status: "COMPLETED",
            baseline: { position: 0, clicks: 0, impressions: 0, ctr: 0, monthlyRevenueEstimate: 0, aeoCitationRate: 0 },
        };
    }

    // Query real post-optimization metrics: 28 days AFTER the action
    const postStart = exp.executedAt;
    const postEnd = new Date(exp.executedAt.getTime() + 28 * 24 * 60 * 60 * 1000);
    const postMetrics = await getPerformanceForUrl(exp.siteId, exp.targetUrl, postStart, postEnd);

    if (!postMetrics || exp.baseline.impressions === 0) {
        // Not enough data yet — mark as evaluating, not completed
        logger.info("[ExperimentTracker] Insufficient post-optimization data", {
            experimentId,
            hasPostMetrics: !!postMetrics,
            baselineImpressions: exp.baseline.impressions,
        });
        exp.status = "EVALUATING";
        return exp;
    }

    // Calculate real lift metrics
    // NOTE: Use careful language. A positive positionDelta means the position
    // number decreased (improved). We report "observed improvement" not causation.
    const positionDelta = parseFloat((exp.baseline.position - postMetrics.position).toFixed(1));
    const clicksLiftPercent = exp.baseline.clicks > 0
        ? parseFloat((((postMetrics.clicks - exp.baseline.clicks) / exp.baseline.clicks) * 100).toFixed(1))
        : 0;
    const impressionsLiftPercent = exp.baseline.impressions > 0
        ? parseFloat((((postMetrics.impressions - exp.baseline.impressions) / exp.baseline.impressions) * 100).toFixed(1))
        : 0;
    const ctrLiftPercent = parseFloat((postMetrics.ctr - exp.baseline.ctr).toFixed(2));
    const postRevenue = Math.round(postMetrics.clicks * 7);
    const revenueLiftAmount = postRevenue - exp.baseline.monthlyRevenueEstimate;

    const lift: LiftMetrics = {
        positionDelta,
        clicksLiftPercent,
        impressionsLiftPercent,
        ctrLiftPercent,
        revenueLiftAmount,
        // AEO citation lift: will be populated when AEO integration is added
        aeoCitationLiftPercent: 0,
    };

    exp.lift = lift;
    exp.status = "COMPLETED";

    // Update in Redis
    if (redis) {
        try {
            await redis.hset(REDIS_EXPERIMENT_KEY, { [exp.id]: JSON.stringify(exp) });
        } catch { /* Fail open */ }
    }

    logger.info("[ExperimentTracker] Completed 28-day evaluation — observed changes after optimization", {
        experimentId,
        positionDelta: lift.positionDelta,
        clicksLift: `${lift.clicksLiftPercent}%`,
        revenueLift: lift.revenueLiftAmount,
    });

    return exp;
}

// ────────────────────────────────────────────────────────────────────────────
// Aggregation: site-level experiment summary
// ────────────────────────────────────────────────────────────────────────────

export async function getSiteExperimentSummary(
    siteId: string
): Promise<SiteExperimentSummary> {
    // Collect all experiments for this site from Redis
    const experiments: ExperimentRecord[] = [];

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
                    } catch { /* skip malformed entries */ }
                }
            }
        } catch { /* Fail open */ }
    }

    if (experiments.length === 0) {
        return {
            siteId,
            totalExperimentsExecuted: 0,
            completedExperiments: 0,
            averagePositionGain: 0,
            averageCtrLiftPercent: 0,
            totalRevenueGenerated: 0,
            averageCitationLiftPercent: 0,
        };
    }

    const completed = experiments.filter((e) => e.status === "COMPLETED" && e.lift);

    const avgPositionGain = completed.length > 0
        ? parseFloat((completed.reduce((sum, e) => sum + (e.lift?.positionDelta ?? 0), 0) / completed.length).toFixed(1))
        : 0;

    const avgCtrLift = completed.length > 0
        ? parseFloat((completed.reduce((sum, e) => sum + (e.lift?.ctrLiftPercent ?? 0), 0) / completed.length).toFixed(1))
        : 0;

    const totalRevenue = completed.reduce((sum, e) => sum + (e.lift?.revenueLiftAmount ?? 0), 0);

    const avgCitationLift = completed.length > 0
        ? parseFloat((completed.reduce((sum, e) => sum + (e.lift?.aeoCitationLiftPercent ?? 0), 0) / completed.length).toFixed(1))
        : 0;

    return {
        siteId,
        totalExperimentsExecuted: experiments.length,
        completedExperiments: completed.length,
        averagePositionGain: avgPositionGain,
        averageCtrLiftPercent: avgCtrLift,
        totalRevenueGenerated: totalRevenue,
        averageCitationLiftPercent: avgCitationLift,
    };
}
