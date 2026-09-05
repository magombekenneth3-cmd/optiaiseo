/**
 * Phase D.5.7 — Experiment Evaluation
 *
 * Deterministic outcome classification for completed experiments.
 *
 * Classification rules (applied in order):
 *   1. Experiment was manually or safety-aborted → ABORTED
 *   2. Treatment data < minDataDays AND control data < minDataDays → INCONCLUSIVE
 *   3. Treatment improvement ≥ successThreshold → WIN
 *   4. Treatment degradation ≥ -successThreshold → LOSS
 *   5. Difference within ±successThreshold → INCONCLUSIVE
 *
 * INVARIANT: This module does NOT:
 *   - Automatically rewrite scoring weights (D.6)
 *   - Automatically promote/demote action types (D.6)
 *   - Feed back into the strategy engine (D.6)
 */

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  type ExperimentOutcome,
  type SuccessMetric,
  type MetricSnapshot,
  DEFAULT_SAFETY_LIMITS,
} from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

export interface EvaluationResult {
  experimentId: string;
  outcome: ExperimentOutcome;
  confidence: number;
  details: {
    successMetric: string;
    successThreshold: number;
    controlBaseline: MetricSnapshot | null;
    controlPost: MetricSnapshot | null;
    treatmentBaseline: MetricSnapshot | null;
    treatmentPost: MetricSnapshot | null;
    delta: number | null;
    reason: string;
  };
}

// ── Core: Evaluate Experiment ───────────────────────────────────────────────

/**
 * Evaluates a completed or matured experiment.
 *
 * Transitions the experiment from RUNNING → COMPLETED with an outcome.
 * If the experiment is already COMPLETED or ABORTED, returns the existing outcome.
 */
export async function evaluateExperiment(
  experimentId: string
): Promise<EvaluationResult> {
  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: {
      variants: true,
      measurements: {
        orderBy: { measurementDay: "desc" },
      },
    },
  });

  if (!experiment) {
    throw new Error(`Experiment ${experimentId} not found`);
  }

  // Already evaluated or aborted — return existing outcome
  if (experiment.status === "COMPLETED" || experiment.status === "ABORTED") {
    return {
      experimentId,
      outcome: (experiment.outcome as ExperimentOutcome) ?? "ABORTED",
      confidence: experiment.outcomeConfidence ?? 0,
      details: (experiment.outcomeDetails as any) ?? {
        reason: `Experiment already in ${experiment.status} state`,
      },
    };
  }

  const control = experiment.variants.find(v => v.isControl);
  const treatment = experiment.variants.find(v => !v.isControl);

  if (!control || !treatment) {
    return finalize(experimentId, "INCONCLUSIVE", 0, {
      successMetric: experiment.successMetric,
      successThreshold: experiment.successThreshold,
      controlBaseline: null,
      controlPost: null,
      treatmentBaseline: null,
      treatmentPost: null,
      delta: null,
      reason: "Missing control or treatment variant — cannot evaluate",
    });
  }

  // Parse metric snapshots from variant JSON
  const controlBaseline = parseMetrics(control.baselineMetrics);
  const controlPost = parseMetrics(control.postMetrics);
  const treatmentBaseline = parseMetrics(treatment.baselineMetrics);
  const treatmentPost = parseMetrics(treatment.postMetrics);

  // ── Rule 1: Check data sufficiency ────────────────────────────────────
  const minDays = DEFAULT_SAFETY_LIMITS.minDataDays;

  const treatmentHasData = treatmentPost !== null && treatmentPost.dataDays >= minDays;
  const controlHasData = controlPost !== null && controlPost.dataDays >= minDays;

  if (!treatmentHasData && !controlHasData) {
    return finalize(experimentId, "INCONCLUSIVE", 0, {
      successMetric: experiment.successMetric,
      successThreshold: experiment.successThreshold,
      controlBaseline,
      controlPost,
      treatmentBaseline,
      treatmentPost,
      delta: null,
      reason: `Insufficient data: treatment has ${treatmentPost?.dataDays ?? 0} days, ` +
        `control has ${controlPost?.dataDays ?? 0} days (minimum: ${minDays})`,
    });
  }

  // ── Rule 2: Compute delta for success metric ──────────────────────────
  const metric = experiment.successMetric as SuccessMetric;
  const threshold = experiment.successThreshold;
  const delta = computeDelta(metric, controlBaseline, controlPost, treatmentBaseline, treatmentPost);

  if (delta === null) {
    return finalize(experimentId, "INCONCLUSIVE", 0.3, {
      successMetric: metric,
      successThreshold: threshold,
      controlBaseline,
      controlPost,
      treatmentBaseline,
      treatmentPost,
      delta: null,
      reason: "Unable to compute delta — missing metric values",
    });
  }

  // ── Rule 3: Classify outcome ──────────────────────────────────────────
  let outcome: ExperimentOutcome;
  let confidence: number;
  let reason: string;

  if (delta >= threshold) {
    outcome = "WIN";
    confidence = Math.min(1.0, 0.5 + (delta / threshold) * 0.25);
    reason = `Treatment improved ${metric} by ${delta.toFixed(1)} (threshold: ${threshold})`;
  } else if (delta <= -threshold) {
    outcome = "LOSS";
    confidence = Math.min(1.0, 0.5 + (Math.abs(delta) / threshold) * 0.25);
    reason = `Treatment degraded ${metric} by ${Math.abs(delta).toFixed(1)} (threshold: ${threshold})`;
  } else {
    outcome = "INCONCLUSIVE";
    confidence = 0.4;
    reason = `Delta of ${delta.toFixed(1)} is within ±${threshold} threshold — no clear signal`;
  }

  return finalize(experimentId, outcome, confidence, {
    successMetric: metric,
    successThreshold: threshold,
    controlBaseline,
    controlPost,
    treatmentBaseline,
    treatmentPost,
    delta,
    reason,
  });
}

// ── Cron: Evaluate All Matured Experiments ──────────────────────────────────

/**
 * Evaluates all experiments that have reached their end date.
 * Designed to be called by a daily cron.
 */
export async function evaluateMaturedExperiments(): Promise<{
  evaluated: number;
  outcomes: Record<ExperimentOutcome, number>;
}> {
  const matured = await prisma.experiment.findMany({
    where: {
      status: "RUNNING",
      endsAt: { lte: new Date() },
    },
    select: { id: true },
  });

  const outcomes: Record<ExperimentOutcome, number> = {
    WIN: 0,
    LOSS: 0,
    INCONCLUSIVE: 0,
    ABORTED: 0,
  };

  for (const exp of matured) {
    try {
      const result = await evaluateExperiment(exp.id);
      outcomes[result.outcome]++;
    } catch (err) {
      logger.warn("[ExperimentEvaluator] Evaluation failed", {
        experimentId: exp.id,
        error: (err as Error)?.message,
      });
    }
  }

  logger.info("[ExperimentEvaluator] Evaluation run complete", {
    evaluated: matured.length,
    outcomes,
  });

  return { evaluated: matured.length, outcomes };
}

// ── Delta Computation ───────────────────────────────────────────────────────

/**
 * Computes the improvement delta for a given metric.
 *
 * For position_delta: improvement = baseline_position - post_position (lower is better)
 * For lift metrics: improvement = (post - baseline) / baseline * 100
 *
 * Compares treatment's change vs control's change (difference-in-differences).
 */
function computeDelta(
  metric: SuccessMetric,
  controlBaseline: MetricSnapshot | null,
  controlPost: MetricSnapshot | null,
  treatmentBaseline: MetricSnapshot | null,
  treatmentPost: MetricSnapshot | null
): number | null {
  switch (metric) {
    case "position_delta":
      return computePositionDelta(controlBaseline, controlPost, treatmentBaseline, treatmentPost);
    case "clicks_lift":
      return computeLiftDelta("clicks", controlBaseline, controlPost, treatmentBaseline, treatmentPost);
    case "ctr_lift":
      return computeAbsoluteDelta("ctr", controlBaseline, controlPost, treatmentBaseline, treatmentPost);
    case "impressions_lift":
      return computeLiftDelta("impressions", controlBaseline, controlPost, treatmentBaseline, treatmentPost);
    default:
      return null;
  }
}

/**
 * Position delta: uses difference-in-differences.
 * treatment_improvement = (treatment_baseline_pos - treatment_post_pos)
 * control_improvement = (control_baseline_pos - control_post_pos)
 * net delta = treatment_improvement - control_improvement
 */
function computePositionDelta(
  cBase: MetricSnapshot | null,
  cPost: MetricSnapshot | null,
  tBase: MetricSnapshot | null,
  tPost: MetricSnapshot | null
): number | null {
  if (tBase?.position == null || tPost?.position == null) return null;

  const treatmentImprovement = tBase.position - tPost.position;

  // If we have control data, use DiD
  if (cBase?.position != null && cPost?.position != null) {
    const controlImprovement = cBase.position - cPost.position;
    return parseFloat((treatmentImprovement - controlImprovement).toFixed(1));
  }

  // No control data — use raw treatment improvement
  return parseFloat(treatmentImprovement.toFixed(1));
}

/**
 * Lift delta for count metrics (clicks, impressions): % change comparison.
 */
function computeLiftDelta(
  field: "clicks" | "impressions",
  cBase: MetricSnapshot | null,
  cPost: MetricSnapshot | null,
  tBase: MetricSnapshot | null,
  tPost: MetricSnapshot | null
): number | null {
  const tBaseVal = tBase?.[field];
  const tPostVal = tPost?.[field];

  if (tBaseVal == null || tPostVal == null || tBaseVal === 0) return null;

  const treatmentLift = ((tPostVal - tBaseVal) / tBaseVal) * 100;

  // If we have control data, use DiD
  const cBaseVal = cBase?.[field];
  const cPostVal = cPost?.[field];
  if (cBaseVal != null && cPostVal != null && cBaseVal > 0) {
    const controlLift = ((cPostVal - cBaseVal) / cBaseVal) * 100;
    return parseFloat((treatmentLift - controlLift).toFixed(1));
  }

  return parseFloat(treatmentLift.toFixed(1));
}

/**
 * Absolute delta for rate metrics (CTR): absolute difference comparison.
 */
function computeAbsoluteDelta(
  field: "ctr",
  cBase: MetricSnapshot | null,
  cPost: MetricSnapshot | null,
  tBase: MetricSnapshot | null,
  tPost: MetricSnapshot | null
): number | null {
  const tBaseVal = tBase?.[field];
  const tPostVal = tPost?.[field];

  if (tBaseVal == null || tPostVal == null) return null;

  const treatmentDelta = tPostVal - tBaseVal;

  // If we have control data, use DiD
  const cBaseVal = cBase?.[field];
  const cPostVal = cPost?.[field];
  if (cBaseVal != null && cPostVal != null) {
    const controlDelta = cPostVal - cBaseVal;
    return parseFloat((treatmentDelta - controlDelta).toFixed(4));
  }

  return parseFloat(treatmentDelta.toFixed(4));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseMetrics(json: any): MetricSnapshot | null {
  if (!json) return null;
  const parsed = typeof json === "string" ? JSON.parse(json) : json;
  return {
    position: parsed.position ?? null,
    clicks: parsed.clicks ?? null,
    impressions: parsed.impressions ?? null,
    ctr: parsed.ctr ?? null,
    indexedStatus: parsed.indexedStatus ?? null,
    dataDays: parsed.dataDays ?? 0,
  };
}

async function finalize(
  experimentId: string,
  outcome: ExperimentOutcome,
  confidence: number,
  details: EvaluationResult["details"]
): Promise<EvaluationResult> {
  // Persist outcome
  await prisma.experiment.update({
    where: { id: experimentId },
    data: {
      status: "COMPLETED",
      outcome,
      outcomeConfidence: confidence,
      outcomeDetails: details as any,
      completedAt: new Date(),
    },
  });

  logger.info("[ExperimentEvaluator] Experiment evaluated", {
    experimentId,
    outcome,
    confidence,
    delta: details.delta,
    reason: details.reason,
  });

  return { experimentId, outcome, confidence, details };
}
