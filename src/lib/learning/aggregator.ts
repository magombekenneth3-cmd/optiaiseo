/**
 * Phase D.6.1 — Outcome Aggregation
 *
 * Reads D.5 experiment outcomes and aggregates by (site, action type).
 *
 * INVARIANTS:
 * - Read-only: never writes to scoring weights, planning parameters, or constants
 * - Deterministic: same inputs → same outputs
 * - WIN + LOSS experiments contribute to win rate and metric averages
 * - INCONCLUSIVE + ABORTED are counted but excluded from averages
 * - Treatment vs control deltas extracted from ExperimentVariant.postMetrics/baselineMetrics
 *
 * DECAY POLICY:
 *   Currently uses EQUAL_WEIGHT (all experiments contribute equally).
 *   The DecayPolicy parameter is accepted but only EQUAL_WEIGHT is implemented.
 *   Exponential decay or window cutoff are pending a design decision.
 */

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  type ActionOutcomeAggregation,
  type DecayPolicy,
  DEFAULT_DECAY_POLICY,
} from "./types";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Aggregates D.5 experiment outcomes by action type for a site.
 *
 * Returns one ActionOutcomeAggregation per distinct action type that
 * has at least one completed experiment (any outcome).
 *
 * @param siteId - The site to aggregate outcomes for
 * @param decayPolicy - How to weight older experiments (default: EQUAL_WEIGHT)
 * @returns Array of aggregations, one per action type, sorted by totalExperiments desc
 */
export async function aggregateOutcomesByAction(
  siteId: string,
  decayPolicy: DecayPolicy = DEFAULT_DECAY_POLICY
): Promise<ActionOutcomeAggregation[]> {
  // ── 1. Load all D.5 experiments with variants ─────────────────────────
  const experiments = await (prisma as any).experiment.findMany({
    where: {
      siteId,
      // D.5 experiments have an outcome field; legacy experiments do not
      outcome: { not: null },
    },
    select: {
      id: true,
      outcome: true,
      outcomeConfidence: true,
      completedAt: true,
      successMetric: true,
      outcomeDetails: true,
      variants: {
        select: {
          variantKey: true,
          isControl: true,
          actionType: true,
          baselineMetrics: true,
          postMetrics: true,
        },
      },
    },
    orderBy: { completedAt: "desc" },
  });

  if (experiments.length === 0) {
    logger.info("[LearningAggregator] No D.5 experiments with outcomes for site", { siteId });
    return [];
  }

  // ── 2. Group by action type ───────────────────────────────────────────
  const groups = new Map<string, ExperimentGroup>();

  for (const exp of experiments) {
    // Find the treatment variant to determine action type
    const treatment = exp.variants?.find((v: any) => !v.isControl);
    if (!treatment?.actionType) continue;

    const actionType = treatment.actionType as string;

    if (!groups.has(actionType)) {
      groups.set(actionType, {
        actionType,
        experiments: [],
      });
    }

    groups.get(actionType)!.experiments.push({
      id: exp.id,
      outcome: exp.outcome as string,
      outcomeConfidence: exp.outcomeConfidence as number | null,
      completedAt: exp.completedAt ? new Date(exp.completedAt) : null,
      treatment: {
        baselineMetrics: parseMetrics(treatment.baselineMetrics),
        postMetrics: parseMetrics(treatment.postMetrics),
      },
      control: (() => {
        const ctrl = exp.variants?.find((v: any) => v.isControl);
        if (!ctrl) return null;
        return {
          baselineMetrics: parseMetrics(ctrl.baselineMetrics),
          postMetrics: parseMetrics(ctrl.postMetrics),
        };
      })(),
    });
  }

  // ── 3. Aggregate each group ───────────────────────────────────────────
  const results: ActionOutcomeAggregation[] = [];

  for (const [actionType, group] of groups) {
    const aggregation = aggregateGroup(siteId, actionType, group.experiments, decayPolicy);
    results.push(aggregation);
  }

  // Sort by totalExperiments descending
  results.sort((a, b) => b.totalExperiments - a.totalExperiments);

  logger.info("[LearningAggregator] Aggregation complete", {
    siteId,
    actionTypes: results.length,
    totalExperiments: results.reduce((sum, r) => sum + r.totalExperiments, 0),
  });

  return results;
}

// ── Group Aggregation ───────────────────────────────────────────────────────

interface ExperimentGroup {
  actionType: string;
  experiments: GroupedExperiment[];
}

interface GroupedExperiment {
  id: string;
  outcome: string;
  outcomeConfidence: number | null;
  completedAt: Date | null;
  treatment: {
    baselineMetrics: MetricValues | null;
    postMetrics: MetricValues | null;
  };
  control: {
    baselineMetrics: MetricValues | null;
    postMetrics: MetricValues | null;
  } | null;
}

interface MetricValues {
  position: number | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
}

function aggregateGroup(
  siteId: string,
  actionType: string,
  experiments: GroupedExperiment[],
  _decayPolicy: DecayPolicy // Reserved for future decay implementation
): ActionOutcomeAggregation {
  // ── Count outcomes ────────────────────────────────────────────────────
  let wins = 0;
  let losses = 0;
  let inconclusive = 0;
  let aborted = 0;

  for (const exp of experiments) {
    switch (exp.outcome) {
      case "WIN": wins++; break;
      case "LOSS": losses++; break;
      case "INCONCLUSIVE": inconclusive++; break;
      case "ABORTED": aborted++; break;
    }
  }

  // ── Win rate (WIN + LOSS only) ────────────────────────────────────────
  const decidedCount = wins + losses;
  const winRate = decidedCount > 0 ? wins / decidedCount : null;

  // ── Metric deltas (WIN + LOSS only) ───────────────────────────────────
  const decidedExperiments = experiments.filter(
    e => e.outcome === "WIN" || e.outcome === "LOSS"
  );

  const positionDeltas: number[] = [];
  const clicksLifts: number[] = [];
  const ctrLifts: number[] = [];
  const confidences: number[] = [];

  for (const exp of decidedExperiments) {
    // Position delta: treatment improvement vs control improvement (DiD)
    const posDelta = computePositionDelta(exp);
    if (posDelta !== null) positionDeltas.push(posDelta);

    // Clicks lift: % change difference-in-differences
    const clicksLift = computePercentLift(exp, "clicks");
    if (clicksLift !== null) clicksLifts.push(clicksLift);

    // CTR lift: absolute difference-in-differences
    const ctrLift = computeAbsoluteDelta(exp, "ctr");
    if (ctrLift !== null) ctrLifts.push(ctrLift);

    // Outcome confidence
    if (exp.outcomeConfidence !== null) {
      confidences.push(exp.outcomeConfidence);
    }
  }

  // ── Latest outcome timestamp ──────────────────────────────────────────
  const completedDates = experiments
    .map(e => e.completedAt)
    .filter((d): d is Date => d !== null);
  const lastOutcomeAt = completedDates.length > 0
    ? new Date(Math.max(...completedDates.map(d => d.getTime())))
    : null;

  return {
    actionType,
    siteId,
    totalExperiments: experiments.length,
    wins,
    losses,
    inconclusive,
    aborted,
    winRate,
    avgPositionDelta: safeAvg(positionDeltas),
    avgClicksLift: safeAvg(clicksLifts),
    avgCtrLift: safeAvg(ctrLifts),
    avgConfidence: safeAvg(confidences),
    lastOutcomeAt,
    experimentIds: experiments.map(e => e.id),
  };
}

// ── Metric Computation ──────────────────────────────────────────────────────

/**
 * Position delta using difference-in-differences.
 *
 * treatment_improvement = baseline_position - post_position (lower = better)
 * control_improvement   = baseline_position - post_position
 * net_delta = treatment_improvement - control_improvement
 *
 * Positive result = treatment improved more than control.
 */
function computePositionDelta(exp: GroupedExperiment): number | null {
  const tBase = exp.treatment.baselineMetrics?.position;
  const tPost = exp.treatment.postMetrics?.position;

  if (tBase == null || tPost == null) return null;

  const treatmentImprovement = tBase - tPost;

  // If control data available, use DiD
  if (exp.control) {
    const cBase = exp.control.baselineMetrics?.position;
    const cPost = exp.control.postMetrics?.position;
    if (cBase != null && cPost != null) {
      const controlImprovement = cBase - cPost;
      return round(treatmentImprovement - controlImprovement, 1);
    }
  }

  return round(treatmentImprovement, 1);
}

/**
 * Percent lift for count metrics (clicks, impressions).
 * Uses difference-in-differences when control data is available.
 */
function computePercentLift(
  exp: GroupedExperiment,
  field: "clicks" | "impressions"
): number | null {
  const tBase = exp.treatment.baselineMetrics?.[field];
  const tPost = exp.treatment.postMetrics?.[field];

  if (tBase == null || tPost == null || tBase === 0) return null;

  const treatmentLift = ((tPost - tBase) / tBase) * 100;

  if (exp.control) {
    const cBase = exp.control.baselineMetrics?.[field];
    const cPost = exp.control.postMetrics?.[field];
    if (cBase != null && cPost != null && cBase > 0) {
      const controlLift = ((cPost - cBase) / cBase) * 100;
      return round(treatmentLift - controlLift, 1);
    }
  }

  return round(treatmentLift, 1);
}

/**
 * Absolute delta for rate metrics (CTR).
 * Uses difference-in-differences when control data is available.
 */
function computeAbsoluteDelta(
  exp: GroupedExperiment,
  field: "ctr"
): number | null {
  const tBase = exp.treatment.baselineMetrics?.[field];
  const tPost = exp.treatment.postMetrics?.[field];

  if (tBase == null || tPost == null) return null;

  const treatmentDelta = tPost - tBase;

  if (exp.control) {
    const cBase = exp.control.baselineMetrics?.[field];
    const cPost = exp.control.postMetrics?.[field];
    if (cBase != null && cPost != null) {
      const controlDelta = cPost - cBase;
      return round(treatmentDelta - controlDelta, 4);
    }
  }

  return round(treatmentDelta, 4);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseMetrics(json: unknown): MetricValues | null {
  if (!json) return null;
  const parsed = typeof json === "string" ? JSON.parse(json) : json;
  return {
    position: parsed.position ?? null,
    clicks: parsed.clicks ?? null,
    impressions: parsed.impressions ?? null,
    ctr: parsed.ctr ?? null,
  };
}

function safeAvg(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return round(sum / values.length, 2);
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
