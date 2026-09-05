/**
 * Phase D.6 — Learning Loop Types & Constants
 *
 * INVARIANT: D.6 types describe learned signals and their lifecycle.
 * They NEVER include scoring weights, planning parameters, or mutation fields.
 * D.6 produces signals; D.2/D.3 consume them as read-only inputs.
 */

// ── Version ─────────────────────────────────────────────────────────────────

export const LEARNING_VERSION = "d6-v1";

// ── Outcome Aggregation ─────────────────────────────────────────────────────

/**
 * Aggregated experiment outcomes for a single action type on a single site.
 *
 * winRate and metric averages are computed from WIN + LOSS experiments only.
 * INCONCLUSIVE and ABORTED are counted but excluded from averages.
 */
export interface ActionOutcomeAggregation {
  actionType: string;
  siteId: string;

  // Counts (all completed experiments)
  totalExperiments: number;
  wins: number;
  losses: number;
  inconclusive: number;
  aborted: number;

  // Metrics (WIN + LOSS only)
  winRate: number | null;          // wins / (wins + losses) — null if denominator is 0
  avgPositionDelta: number | null; // Average treatment-vs-control position delta
  avgClicksLift: number | null;   // Average treatment-vs-control clicks % lift
  avgCtrLift: number | null;      // Average treatment-vs-control CTR absolute lift
  avgConfidence: number | null;    // Average outcomeConfidence from D.5

  // Provenance
  lastOutcomeAt: Date | null;     // Most recent experiment completion timestamp
  experimentIds: string[];         // All contributing experiment IDs
}

// ── Signal Types ────────────────────────────────────────────────────────────

export type SignalType =
  | "RISK_ADJUSTMENT"
  | "CONFIDENCE_ADJUSTMENT"
  | "EFFORT_ADJUSTMENT";

export const SIGNAL_TYPES: readonly SignalType[] = [
  "RISK_ADJUSTMENT",
  "CONFIDENCE_ADJUSTMENT",
  "EFFORT_ADJUSTMENT",
] as const;

// ── Signal Magnitude ────────────────────────────────────────────────────────

export type SignalMagnitude = "MINOR" | "MODERATE" | "MAJOR";

/** Magnitude ranges (inclusive) */
export const MAGNITUDE_RANGES: Record<SignalMagnitude, { min: number; max: number }> = {
  MINOR:    { min: 1, max: 5 },
  MODERATE: { min: 6, max: 10 },
  MAJOR:    { min: 11, max: 15 },
};

// ── Signal Status ───────────────────────────────────────────────────────────

export type SignalStatus = "PROPOSED" | "ACTIVE" | "SUPERSEDED" | "REVOKED";

export const SIGNAL_STATUS_TRANSITIONS: Record<SignalStatus, SignalStatus[]> = {
  PROPOSED:   ["ACTIVE", "REVOKED"],
  ACTIVE:     ["SUPERSEDED", "REVOKED"],
  SUPERSEDED: [],  // Terminal
  REVOKED:    [],  // Terminal
};

// ── Safety Limits ───────────────────────────────────────────────────────────

export interface LearningSafetyLimits {
  /** Minimum completed experiments before generating signals */
  minExperimentsForSignal: number;
  /** Maximum absolute adjustment value (hard cap) */
  maxAdjustment: number;
}

export const DEFAULT_LEARNING_LIMITS: Readonly<LearningSafetyLimits> = {
  minExperimentsForSignal: 5,
  maxAdjustment: 15,
} as const;

// ── Decay Configuration ─────────────────────────────────────────────────────

/**
 * DESIGN DECISION PENDING:
 *
 * The plan proposes a 90-day half-life for experiment outcome decay,
 * but this has NOT been implemented in the aggregator.
 *
 * Current aggregation uses **equal weight** for all experiments.
 *
 * When a decay policy is chosen, it will be applied here:
 *   - EQUAL_WEIGHT:     All experiments contribute equally (current)
 *   - EXPONENTIAL_DECAY: Half-life in days — older experiments fade
 *   - WINDOW_CUTOFF:    Only experiments within N days are considered
 *
 * The aggregator exposes a DecayPolicy parameter so the decision
 * can be made without modifying aggregation logic.
 */
export type DecayPolicy =
  | { type: "EQUAL_WEIGHT" }
  | { type: "EXPONENTIAL_DECAY"; halfLifeDays: number }
  | { type: "WINDOW_CUTOFF"; windowDays: number };

export const DEFAULT_DECAY_POLICY: DecayPolicy = {
  type: "EQUAL_WEIGHT",
};
