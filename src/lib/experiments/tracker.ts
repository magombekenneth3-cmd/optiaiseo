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
    status: "RECORDED" | "EVALUATING" | "COMPLETED" | "INSUFFICIENT_DATA";
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

// Redis-backed experiment cache (PostgreSQL is source of truth)
const REDIS_EXPERIMENT_KEY = "aiseo:experiments";

// Minimum number of days with GSC data required in a 28-day window
const MIN_DATA_DAYS = 14;

// ────────────────────────────────────────────────────────────────────────────
// Helpers: query real GSC performance from the persistent data layer
// ────────────────────────────────────────────────────────────────────────────

function dateFmt(d: Date): string {
    return d.toISOString().split("T")[0];
}

/**
 * Returns the start of a UTC day (00:00:00.000Z).
 */
function utcDayStart(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Adds `days` calendar days to a date (UTC).
 */
function addDays(d: Date, days: number): Date {
    const result = new Date(d);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}

/**
 * Aggregate GSC metrics for a URL over a date range from the persistent
 * GscDailyPerformance table. Returns null if no data is found.
 * Also returns the count of distinct days with data for minimum-data checks.
 */
async function getPerformanceForUrl(
    siteId: string,
    targetUrl: string,
    startDate: Date,
    endDate: Date
): Promise<{ position: number; clicks: number; impressions: number; ctr: number; dataDays: number } | null> {
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
            _count: { date: true },
        });

        const clicks = rows._sum.clicks ?? 0;
        const impressions = rows._sum.impressions ?? 0;
        const dataDays = rows._count.date ?? 0;

        if (impressions === 0) return null;

        return {
            position: parseFloat((rows._avg.position ?? 0).toFixed(1)),
            clicks,
            impressions,
            ctr: parseFloat((rows._avg.ctr ?? 0).toFixed(2)),
            dataDays,
        };
    } catch (err: unknown) {
        logger.warn("[ExperimentTracker] Failed to query GscDailyPerformance", {
            siteId, targetUrl, error: (err as Error)?.message,
        });
        return null;
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers: Redis cache read/write
// ────────────────────────────────────────────────────────────────────────────

async function cacheExperiment(exp: ExperimentRecord): Promise<void> {
    const redis = getRedis();
    if (redis) {
        try {
            await redis.hset(REDIS_EXPERIMENT_KEY, { [exp.id]: JSON.stringify(exp) });
        } catch { /* Fail open */ }
    }
}

async function readCachedExperiment(experimentId: string): Promise<ExperimentRecord | null> {
    const redis = getRedis();
    if (!redis) return null;
    try {
        const raw = await redis.hget<string>(REDIS_EXPERIMENT_KEY, experimentId);
        if (raw) {
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            parsed.executedAt = new Date(parsed.executedAt);
            parsed.evaluationDate = new Date(parsed.evaluationDate);
            return parsed;
        }
    } catch { /* Fall through */ }
    return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers: PostgreSQL read/write
// ────────────────────────────────────────────────────────────────────────────

function dbRowToExperiment(row: any): ExperimentRecord {
    return {
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
    };
}

async function readDbExperiment(experimentId: string): Promise<ExperimentRecord | null> {
    try {
        const row = await (prisma as any).experiment.findUnique({ where: { id: experimentId } });
        return row ? dbRowToExperiment(row) : null;
    } catch {
        return null;
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Core: Record baseline at T0 (when a growth decision is executed)
//
// 28-day window semantics (P0-4):
//   Baseline:  T-29d 00:00 UTC  →  T-1d 23:59 UTC  (28 complete days)
//   Post:      T+1d 00:00 UTC   →  T+29d 23:59 UTC  (28 complete days)
//   Execution day (T) is excluded from both windows.
// ────────────────────────────────────────────────────────────────────────────

export async function recordExperimentBaseline(
    decisionId: string,
    siteId: string,
    targetUrl: string,
    actionExecuted: string
): Promise<ExperimentRecord> {
    const executedAt = new Date();
    const executionDay = utcDayStart(executedAt);

    // Baseline: 28 complete days ending the day BEFORE execution
    const baselineEnd = addDays(executionDay, -1);
    const baselineStart = addDays(baselineEnd, -27); // 28 days inclusive

    // Evaluation date: 29 days after execution (T+1 through T+28 = 28 days)
    const evaluationDate = addDays(executionDay, 29);

    // Query real baseline
    const realMetrics = await getPerformanceForUrl(siteId, targetUrl, baselineStart, baselineEnd);

    const baseline: BaselineMetrics = realMetrics
        ? {
            position: realMetrics.position,
            clicks: realMetrics.clicks,
            impressions: realMetrics.impressions,
            ctr: realMetrics.ctr,
            monthlyRevenueEstimate: Math.round(realMetrics.clicks * 7),
            aeoCitationRate: 0,
        }
        : {
            // Graceful degradation: if no DB data exists yet, use zeros.
            // The UI should display "baseline pending".
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

    // P0-3: Persist to PostgreSQL FIRST (source of truth), then Redis (cache)
    try {
        await (prisma as any).experiment.create({
            data: {
                id: experiment.id,
                decisionId: experiment.decisionId,
                siteId: experiment.siteId,
                targetUrl: experiment.targetUrl,
                actionExecuted: experiment.actionExecuted,
                executedAt: experiment.executedAt,
                evaluationDate: experiment.evaluationDate,
                status: experiment.status,
                baseline: experiment.baseline as any,
            },
        });
    } catch (dbErr: unknown) {
        // If already exists (idempotent re-execution), just warn
        if ((dbErr as any)?.code === "P2002") {
            logger.warn("[ExperimentTracker] Experiment already exists (idempotent)", { id: experiment.id });
            const existing = await readDbExperiment(experiment.id);
            if (existing) return existing;
        } else {
            logger.error("[ExperimentTracker] Failed to persist experiment to DB", {
                id: experiment.id, error: (dbErr as Error)?.message,
            });
        }
    }

    // Cache in Redis
    await cacheExperiment(experiment);

    logger.info("[ExperimentTracker] Recorded T0 baseline metrics", {
        experimentId: experiment.id,
        siteId,
        targetUrl,
        baselinePosition: baseline.position,
        baselineClicks: baseline.clicks,
        hasRealData: !!realMetrics,
        dataDays: realMetrics?.dataDays ?? 0,
        baselineWindow: `${dateFmt(baselineStart)} → ${dateFmt(baselineEnd)}`,
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
    // Read from Redis → fall back to PostgreSQL
    let exp: ExperimentRecord | null = await readCachedExperiment(experimentId);
    if (!exp) {
        exp = await readDbExperiment(experimentId);
    }

    if (!exp) {
        logger.warn("[ExperimentTracker] Experiment not found", { experimentId });
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

    // P0-5: Atomic status guard — only evaluate RECORDED experiments
    // Prevents double-evaluation on retry
    if (exp.status === "COMPLETED" || exp.status === "INSUFFICIENT_DATA") {
        logger.info("[ExperimentTracker] Experiment already evaluated", { experimentId, status: exp.status });
        return exp;
    }

    // P0-4: Exact post-optimization window
    // Post: T+1d 00:00 UTC  →  T+29d 23:59 UTC  (28 complete days)
    const executionDay = utcDayStart(exp.executedAt);
    const postStart = addDays(executionDay, 1);
    const postEnd = addDays(executionDay, 28);

    const postMetrics = await getPerformanceForUrl(exp.siteId, exp.targetUrl, postStart, postEnd);

    // Check minimum data threshold
    if (!postMetrics || postMetrics.dataDays < MIN_DATA_DAYS) {
        logger.info("[ExperimentTracker] Insufficient post-optimization data", {
            experimentId,
            hasPostMetrics: !!postMetrics,
            dataDays: postMetrics?.dataDays ?? 0,
            required: MIN_DATA_DAYS,
        });

        // If past evaluation date and still insufficient, mark as INSUFFICIENT_DATA
        if (new Date() > addDays(exp.evaluationDate, 7)) {
            exp.status = "INSUFFICIENT_DATA";
            await persistExperimentUpdate(exp);
        } else {
            exp.status = "EVALUATING";
        }
        return exp;
    }

    if (exp.baseline.impressions === 0) {
        exp.status = "INSUFFICIENT_DATA";
        await persistExperimentUpdate(exp);
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
        aeoCitationLiftPercent: 0,
    };

    exp.lift = lift;
    exp.status = "COMPLETED";

    // Persist to both PostgreSQL and Redis
    await persistExperimentUpdate(exp);

    logger.info("[ExperimentTracker] Completed 28-day evaluation — observed changes after optimization", {
        experimentId,
        positionDelta: lift.positionDelta,
        clicksLift: `${lift.clicksLiftPercent}%`,
        revenueLift: lift.revenueLiftAmount,
        postWindow: `${dateFmt(postStart)} → ${dateFmt(postEnd)}`,
        dataDays: postMetrics.dataDays,
    });

    return exp;
}

/**
 * P0-3: Write experiment state to PostgreSQL (source of truth) + Redis (cache).
 * Uses upsert to handle both initial writes and updates idempotently.
 */
async function persistExperimentUpdate(exp: ExperimentRecord): Promise<void> {
    // PostgreSQL first
    try {
        await (prisma as any).experiment.upsert({
            where: { id: exp.id },
            update: {
                status: exp.status,
                lift: exp.lift ? (exp.lift as any) : undefined,
                updatedAt: new Date(),
            },
            create: {
                id: exp.id,
                decisionId: exp.decisionId,
                siteId: exp.siteId,
                targetUrl: exp.targetUrl,
                actionExecuted: exp.actionExecuted,
                executedAt: exp.executedAt,
                evaluationDate: exp.evaluationDate,
                status: exp.status,
                baseline: exp.baseline as any,
                lift: exp.lift ? (exp.lift as any) : undefined,
            },
        });
    } catch (dbErr: unknown) {
        logger.error("[ExperimentTracker] Failed to persist experiment update to DB", {
            id: exp.id, error: (dbErr as Error)?.message,
        });
    }

    // Redis cache
    await cacheExperiment(exp);
}

// ────────────────────────────────────────────────────────────────────────────
// Aggregation: site-level experiment summary
// P0-3: Read from PostgreSQL (durable) as primary source
// ────────────────────────────────────────────────────────────────────────────

export async function getSiteExperimentSummary(
    siteId: string
): Promise<SiteExperimentSummary> {
    let experiments: ExperimentRecord[] = [];

    // Read from PostgreSQL (source of truth)
    try {
        const rows = await (prisma as any).experiment.findMany({
            where: { siteId },
        });
        experiments = rows.map(dbRowToExperiment);
    } catch {
        // Fall back to Redis if DB fails
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
