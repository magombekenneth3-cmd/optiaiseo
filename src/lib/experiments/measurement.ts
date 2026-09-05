/**
 * Phase D.5.5 — Experiment Measurement
 *
 * Periodic measurement engine that collects GSC metrics for running experiments.
 * Called by a daily cron job.
 *
 * For each RUNNING experiment:
 * 1. For each variant, queries GscDailyPerformance for the current window
 * 2. Records ExperimentMeasurement at day intervals (0, 7, 14, 21, 28)
 * 3. Updates variant baseline/post metrics
 *
 * INVARIANT: Measurement is read-only observation — it does NOT mutate
 * experiment status or trigger any actions.
 */

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { MetricSnapshot, MeasurementResult } from "./types";

// ── Constants ───────────────────────────────────────────────────────────────

/** Measurement intervals: days since experiment start */
const MEASUREMENT_DAYS = [0, 7, 14, 21, 28] as const;

/** Days before experiment start to use as baseline window */
const BASELINE_WINDOW_DAYS = 28;

// ── Core: Measure All Running Experiments ───────────────────────────────────

/**
 * Measures all RUNNING experiments and records metrics.
 * Designed to be called by a daily cron.
 *
 * Returns the list of measurements recorded in this run.
 */
export async function measureRunningExperiments(): Promise<MeasurementResult[]> {
  const experiments = await prisma.experiment.findMany({
    where: { status: "RUNNING" },
    include: {
      variants: true,
    },
  });

  if (experiments.length === 0) {
    logger.info("[ExperimentMeasurement] No running experiments to measure");
    return [];
  }

  const results: MeasurementResult[] = [];

  for (const exp of experiments) {
    if (!exp.startedAt) continue;

    const daysSinceStart = Math.floor(
      (Date.now() - exp.startedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Find which measurement day we should record
    const measurementDay = findMeasurementDay(daysSinceStart);
    if (measurementDay === null) continue;

    for (const variant of exp.variants) {
      try {
        // Check if this measurement already exists (idempotent)
        const existing = await prisma.experimentMeasurement.findUnique({
          where: {
            experimentId_variantKey_measurementDay: {
              experimentId: exp.id,
              variantKey: variant.variantKey,
              measurementDay,
            },
          },
        });

        if (existing) continue; // Already measured

        // Collect metrics
        const metrics = await collectMetrics(
          exp.siteId,
          variant.targetUrl,
          exp.startedAt,
          daysSinceStart
        );

        // Record measurement
        await prisma.experimentMeasurement.create({
          data: {
            experimentId: exp.id,
            variantKey: variant.variantKey,
            measurementDay,
            position: metrics.position,
            clicks: metrics.clicks,
            impressions: metrics.impressions,
            ctr: metrics.ctr,
            indexedStatus: metrics.indexedStatus,
          },
        });

        // Update variant baseline on day 0
        if (measurementDay === 0 && !variant.baselineMetrics) {
          const baselineStart = new Date(exp.startedAt);
          baselineStart.setUTCDate(baselineStart.getUTCDate() - BASELINE_WINDOW_DAYS);
          const baselineEnd = new Date(exp.startedAt);
          baselineEnd.setUTCDate(baselineEnd.getUTCDate() - 1);

          const baseline = await collectMetricsForWindow(
            exp.siteId,
            variant.targetUrl,
            baselineStart,
            baselineEnd
          );

          await prisma.experimentVariant.update({
            where: { id: variant.id },
            data: {
              baselineMetrics: baseline as any,
              baselineWindow: `${dateFmt(baselineStart)}:${dateFmt(baselineEnd)}`,
            },
          });
        }

        // Update variant post-metrics on final measurement
        if (measurementDay === 28) {
          const postStart = new Date(exp.startedAt);
          postStart.setUTCDate(postStart.getUTCDate() + 1);
          const postEnd = new Date(exp.startedAt);
          postEnd.setUTCDate(postEnd.getUTCDate() + 28);

          const postMetrics = await collectMetricsForWindow(
            exp.siteId,
            variant.targetUrl,
            postStart,
            postEnd
          );

          await prisma.experimentVariant.update({
            where: { id: variant.id },
            data: {
              postMetrics: postMetrics as any,
              postWindow: `${dateFmt(postStart)}:${dateFmt(postEnd)}`,
            },
          });
        }

        results.push({
          experimentId: exp.id,
          variantKey: variant.variantKey as any,
          measurementDay,
          metrics,
        });

        logger.info("[ExperimentMeasurement] Recorded", {
          experimentId: exp.id,
          variantKey: variant.variantKey,
          measurementDay,
          position: metrics.position,
          clicks: metrics.clicks,
        });
      } catch (err) {
        // Non-critical — log and continue to next variant
        logger.warn("[ExperimentMeasurement] Failed for variant", {
          experimentId: exp.id,
          variantKey: variant.variantKey,
          error: (err as Error)?.message,
        });
      }
    }
  }

  logger.info("[ExperimentMeasurement] Measurement run complete", {
    experimentsChecked: experiments.length,
    measurementsRecorded: results.length,
  });

  return results;
}

// ── Metrics Collection ──────────────────────────────────────────────────────

/**
 * Collects current-day metrics from GscDailyPerformance.
 */
async function collectMetrics(
  siteId: string,
  targetUrl: string,
  startedAt: Date,
  daysSinceStart: number
): Promise<MetricSnapshot> {
  // Query the last 7 days for a smoother signal
  const windowEnd = new Date();
  const windowStart = new Date();
  windowStart.setUTCDate(windowStart.getUTCDate() - 7);

  return collectMetricsForWindow(siteId, targetUrl, windowStart, windowEnd);
}

/**
 * Aggregates GSC metrics for a URL over a date range.
 */
async function collectMetricsForWindow(
  siteId: string,
  targetUrl: string,
  startDate: Date,
  endDate: Date
): Promise<MetricSnapshot> {
  const cleanUrl = targetUrl.split("?")[0].replace(/\/$/, "");

  try {
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

    return {
      position: rows._avg.position ? parseFloat(rows._avg.position.toFixed(1)) : null,
      clicks: rows._sum.clicks ?? null,
      impressions: rows._sum.impressions ?? null,
      ctr: rows._avg.ctr ? parseFloat(rows._avg.ctr.toFixed(4)) : null,
      indexedStatus: null, // Would require separate API call
      dataDays: rows._count.date ?? 0,
    };
  } catch (err) {
    logger.warn("[ExperimentMeasurement] GSC query failed", {
      siteId,
      targetUrl,
      error: (err as Error)?.message,
    });
    return {
      position: null,
      clicks: null,
      impressions: null,
      ctr: null,
      indexedStatus: null,
      dataDays: 0,
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function dateFmt(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Returns the measurement day to record, or null if we're not at a measurement interval.
 * Allows ±1 day tolerance for cron scheduling variance.
 */
function findMeasurementDay(daysSinceStart: number): number | null {
  for (const day of MEASUREMENT_DAYS) {
    if (Math.abs(daysSinceStart - day) <= 1) {
      return day;
    }
  }
  return null;
}
