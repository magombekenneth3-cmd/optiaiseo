/**
 * Phase D.5 — Experiment Types & Contracts
 *
 * Defines the experimentation contract: statuses, outcomes, state machine,
 * success metrics, safety limits, and configuration schema.
 *
 * INVARIANT: No D.5 type includes mutation execution fields.
 * Experiments gate Phase C — they do not replace it.
 */

import type { ActionType } from "@/lib/proposals/types";

// ── Experiment Status ───────────────────────────────────────────────────────

export type ExperimentStatus =
  | "DRAFT"      // Created, variants assigned, baselines not yet captured
  | "RUNNING"    // Baselines captured, treatment executing or executed
  | "PAUSED"     // Temporarily halted (manual or safety)
  | "COMPLETED"  // Evaluation finished — outcome populated
  | "ABORTED";   // Terminated early — safety, kill switch, or manual

export const EXPERIMENT_STATUSES: readonly ExperimentStatus[] = [
  "DRAFT", "RUNNING", "PAUSED", "COMPLETED", "ABORTED",
] as const;

/** Valid state transitions for Experiment lifecycle */
export const VALID_EXPERIMENT_TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  DRAFT:     ["RUNNING", "ABORTED"],
  RUNNING:   ["PAUSED", "COMPLETED", "ABORTED"],
  PAUSED:    ["RUNNING", "ABORTED"],
  COMPLETED: [],  // Terminal
  ABORTED:   [],  // Terminal
};

export const TERMINAL_EXPERIMENT_STATUSES: ExperimentStatus[] = [
  "COMPLETED", "ABORTED",
];

// ── Experiment Outcome ──────────────────────────────────────────────────────

export type ExperimentOutcome =
  | "WIN"           // Treatment beat control by ≥ successThreshold
  | "LOSS"          // Treatment degraded by ≥ successThreshold
  | "INCONCLUSIVE"  // Difference within ±successThreshold or insufficient data
  | "ABORTED";      // Experiment was terminated before evaluation

// ── Success Metric ──────────────────────────────────────────────────────────

export type SuccessMetric =
  | "position_delta"     // Improvement in average position (lower = better)
  | "clicks_lift"        // % increase in clicks
  | "ctr_lift"           // Absolute CTR increase (e.g., 0.02 = +2pp)
  | "impressions_lift";  // % increase in impressions

export const SUCCESS_METRICS: readonly SuccessMetric[] = [
  "position_delta", "clicks_lift", "ctr_lift", "impressions_lift",
] as const;

/** Default thresholds per metric — minimum delta to declare WIN */
export const DEFAULT_SUCCESS_THRESHOLDS: Record<SuccessMetric, number> = {
  position_delta: 3.0,       // 3 position improvement
  clicks_lift: 10.0,         // 10% increase
  ctr_lift: 0.5,             // +0.5pp absolute CTR
  impressions_lift: 15.0,    // 15% increase
};

// ── Variant Key ─────────────────────────────────────────────────────────────

export type VariantKey = "control" | "treatment_a" | "treatment_b";

export const VARIANT_KEYS: readonly VariantKey[] = [
  "control", "treatment_a", "treatment_b",
] as const;

// ── Safety Limits ───────────────────────────────────────────────────────────

export interface ExperimentSafetyLimits {
  /** Maximum experiment duration in days */
  maxDurationDays: number;
  /** Maximum mutations per experiment */
  maxMutationCount: number;
  /** Maximum budget units per experiment */
  maxBudgetUnits: number;
  /** Maximum concurrent RUNNING experiments per site */
  maxConcurrentPerSite: number;
  /** Maximum overlapping experiments targeting the same URL */
  maxOverlappingPerUrl: number;
  /** Position drop that triggers auto-abort (negative = worse) */
  autoAbortPositionDrop: number;
  /** Days past endsAt before marking stale evidence */
  staleEvidenceGraceDays: number;
  /** Minimum data days in a 28-day window for significance */
  minDataDays: number;
}

export const DEFAULT_SAFETY_LIMITS: ExperimentSafetyLimits = {
  maxDurationDays: 28,
  maxMutationCount: 1,
  maxBudgetUnits: 1,
  maxConcurrentPerSite: 5,
  maxOverlappingPerUrl: 1,
  autoAbortPositionDrop: -10,
  staleEvidenceGraceDays: 7,
  minDataDays: 14,
};

// ── Experiment Config ───────────────────────────────────────────────────────

/**
 * Immutable experiment configuration — sealed at creation time.
 * The configHash is a SHA-256 of the canonical JSON representation.
 * Any attempt to modify config after creation is a contract violation.
 */
export interface ExperimentConfig {
  opportunityId: string;
  siteId: string;
  hypothesis: string;
  successMetric: SuccessMetric;
  successThreshold: number;
  maxDurationDays: number;
  maxMutationCount: number;
  maxBudgetUnits: number;
  configVersion: string;
}

// ── Variant Input ───────────────────────────────────────────────────────────

export interface ExperimentVariantInput {
  variantKey: VariantKey;
  isControl: boolean;
  targetUrl: string;
  targetKeyword: string | null;
  actionType: ActionType | null;
  actionParameters: Record<string, unknown> | null;
}

// ── Measurement ─────────────────────────────────────────────────────────────

export interface MetricSnapshot {
  position: number | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  indexedStatus: boolean | null;
  dataDays: number;
}

export interface MeasurementResult {
  experimentId: string;
  variantKey: VariantKey;
  measurementDay: number;
  metrics: MetricSnapshot;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class ExperimentConflictError extends Error {
  constructor(
    public readonly siteId: string,
    public readonly targetUrl: string,
    public readonly existingExperimentId: string
  ) {
    super(
      `URL "${targetUrl}" already has a running experiment (${existingExperimentId}) on site ${siteId}`
    );
    this.name = "ExperimentConflictError";
  }
}

export class ExperimentLimitError extends Error {
  constructor(
    public readonly siteId: string,
    public readonly limit: number,
    public readonly current: number
  ) {
    super(
      `Site ${siteId} has reached the concurrent experiment limit (${current}/${limit})`
    );
    this.name = "ExperimentLimitError";
  }
}

export class ExperimentConfigMutationError extends Error {
  constructor(experimentId: string) {
    super(
      `Experiment ${experimentId} config is immutable — cannot modify after creation`
    );
    this.name = "ExperimentConfigMutationError";
  }
}

export class ExperimentTransitionError extends Error {
  constructor(
    experimentId: string,
    from: ExperimentStatus,
    to: ExperimentStatus
  ) {
    super(
      `Invalid experiment transition: ${from} → ${to} for experiment ${experimentId}. ` +
      `Allowed: ${(VALID_EXPERIMENT_TRANSITIONS[from] ?? []).join(", ")}`
    );
    this.name = "ExperimentTransitionError";
  }
}
