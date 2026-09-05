/**
 * Phase D.6.3 — Learned Signal Generation
 *
 * Derives scoring adjustments from aggregated action performance.
 * All rules are deterministic — no LLM, no external calls.
 *
 * INVARIANTS:
 * - No signals generated below maturity threshold (MIN_EXPERIMENTS_FOR_SIGNAL)
 * - Adjustments capped at ±MAX_ADJUSTMENT
 * - Signal direction is consistent with win rate
 * - This module NEVER writes to D.2/D.3 constants
 */

import {
  type ActionOutcomeAggregation,
  type SignalType,
  type SignalMagnitude,
  DEFAULT_LEARNING_LIMITS,
  MAGNITUDE_RANGES,
} from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

export interface GeneratedSignal {
  signalType: SignalType;
  actionType: string;
  adjustment: number;
  magnitude: SignalMagnitude;
  reason: string;
  derivedFrom: number;
  winRate: number;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Generates learned signals from aggregated experiment outcomes.
 *
 * Returns an empty array if the aggregation has not reached the maturity
 * threshold (default: 5 completed experiments with WIN/LOSS outcome).
 *
 * Signal derivation rules:
 *   Win Rate ≥ 80%  → Risk -15, Confidence +15 (MAJOR)
 *   Win Rate ≥ 60%  → Risk -10, Confidence +10 (MODERATE)
 *   Win Rate ≥ 40%  → No signal (insufficient evidence for direction)
 *   Win Rate < 40%  → Risk +10, Confidence -10 (MODERATE)
 *   Win Rate < 20%  → Risk +15, Confidence -15 (MAJOR)
 */
export function generateSignals(
  aggregation: ActionOutcomeAggregation,
  minExperiments: number = DEFAULT_LEARNING_LIMITS.minExperimentsForSignal,
  maxAdjustment: number = DEFAULT_LEARNING_LIMITS.maxAdjustment
): GeneratedSignal[] {
  // ── Maturity gate ─────────────────────────────────────────────────────
  const decidedCount = aggregation.wins + aggregation.losses;
  if (decidedCount < minExperiments) {
    return [];
  }

  if (aggregation.winRate === null) {
    return [];
  }

  const winRate = aggregation.winRate;
  const signals: GeneratedSignal[] = [];

  // ── Derive risk adjustment ────────────────────────────────────────────
  const riskSignal = deriveRiskAdjustment(winRate, aggregation, maxAdjustment);
  if (riskSignal) signals.push(riskSignal);

  // ── Derive confidence adjustment ──────────────────────────────────────
  const confSignal = deriveConfidenceAdjustment(winRate, aggregation, maxAdjustment);
  if (confSignal) signals.push(confSignal);

  return signals;
}

// ── Signal Derivation ───────────────────────────────────────────────────────

function deriveRiskAdjustment(
  winRate: number,
  agg: ActionOutcomeAggregation,
  maxAdj: number
): GeneratedSignal | null {
  let adjustment: number;
  let reason: string;

  if (winRate >= 0.8) {
    adjustment = -Math.min(15, maxAdj);
    reason = `${agg.actionType} has ${(winRate * 100).toFixed(0)}% win rate across ${agg.wins + agg.losses} experiments — significantly lower risk than default`;
  } else if (winRate >= 0.6) {
    adjustment = -Math.min(10, maxAdj);
    reason = `${agg.actionType} has ${(winRate * 100).toFixed(0)}% win rate — moderately lower risk`;
  } else if (winRate < 0.2) {
    adjustment = Math.min(15, maxAdj);
    reason = `${agg.actionType} has ${(winRate * 100).toFixed(0)}% win rate — significantly higher risk than default`;
  } else if (winRate < 0.4) {
    adjustment = Math.min(10, maxAdj);
    reason = `${agg.actionType} has ${(winRate * 100).toFixed(0)}% win rate — moderately higher risk`;
  } else {
    return null; // 40-60% win rate: no signal
  }

  return {
    signalType: "RISK_ADJUSTMENT",
    actionType: agg.actionType,
    adjustment,
    magnitude: classifyMagnitude(Math.abs(adjustment)),
    reason,
    derivedFrom: agg.wins + agg.losses,
    winRate,
  };
}

function deriveConfidenceAdjustment(
  winRate: number,
  agg: ActionOutcomeAggregation,
  maxAdj: number
): GeneratedSignal | null {
  let adjustment: number;
  let reason: string;

  if (winRate >= 0.8) {
    adjustment = Math.min(15, maxAdj);
    reason = `${agg.actionType} has ${(winRate * 100).toFixed(0)}% win rate — significantly higher confidence`;
  } else if (winRate >= 0.6) {
    adjustment = Math.min(10, maxAdj);
    reason = `${agg.actionType} has ${(winRate * 100).toFixed(0)}% win rate — moderately higher confidence`;
  } else if (winRate < 0.2) {
    adjustment = -Math.min(15, maxAdj);
    reason = `${agg.actionType} has ${(winRate * 100).toFixed(0)}% win rate — significantly lower confidence`;
  } else if (winRate < 0.4) {
    adjustment = -Math.min(10, maxAdj);
    reason = `${agg.actionType} has ${(winRate * 100).toFixed(0)}% win rate — moderately lower confidence`;
  } else {
    return null; // 40-60%: no signal
  }

  return {
    signalType: "CONFIDENCE_ADJUSTMENT",
    actionType: agg.actionType,
    adjustment,
    magnitude: classifyMagnitude(Math.abs(adjustment)),
    reason,
    derivedFrom: agg.wins + agg.losses,
    winRate,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function classifyMagnitude(absValue: number): SignalMagnitude {
  if (absValue >= MAGNITUDE_RANGES.MAJOR.min) return "MAJOR";
  if (absValue >= MAGNITUDE_RANGES.MODERATE.min) return "MODERATE";
  return "MINOR";
}
