/**
 * Phase D.6.4 — Signal Validation
 *
 * Validates proposed signals before they can be activated.
 * All validation rules are deterministic.
 *
 * INVARIANTS:
 * - Adjustment magnitude capped at ±MAX_ADJUSTMENT
 * - Signal direction must be consistent with win rate
 * - Magnitude classification must match adjustment range
 * - Minimum experiment count enforced
 */

import {
  type ActionOutcomeAggregation,
  type SignalMagnitude,
  DEFAULT_LEARNING_LIMITS,
  MAGNITUDE_RANGES,
} from "./types";
import type { GeneratedSignal } from "./signal-generator";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  violations: string[];
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Validates a generated signal against safety and consistency rules.
 *
 * A signal must pass ALL rules to be valid:
 * 1. derivedFrom >= minExperimentsForSignal
 * 2. |adjustment| <= maxAdjustment
 * 3. Direction consistency: high win rate → decrease risk / increase confidence
 * 4. Magnitude matches adjustment range
 */
export function validateSignal(
  signal: GeneratedSignal,
  aggregation: ActionOutcomeAggregation,
  limits = DEFAULT_LEARNING_LIMITS
): ValidationResult {
  const violations: string[] = [];

  // ── Rule 1: Minimum experiment count ──────────────────────────────────
  if (signal.derivedFrom < limits.minExperimentsForSignal) {
    violations.push(
      `Insufficient experiments: ${signal.derivedFrom} < minimum ${limits.minExperimentsForSignal}`
    );
  }

  // ── Rule 2: Adjustment cap ────────────────────────────────────────────
  if (Math.abs(signal.adjustment) > limits.maxAdjustment) {
    violations.push(
      `Adjustment |${signal.adjustment}| exceeds cap of ±${limits.maxAdjustment}`
    );
  }

  // ── Rule 3: Direction consistency ─────────────────────────────────────
  if (signal.signalType === "RISK_ADJUSTMENT") {
    // High win rate → risk should DECREASE (negative adjustment)
    if (signal.winRate >= 0.6 && signal.adjustment > 0) {
      violations.push(
        `Direction inconsistency: win rate ${(signal.winRate * 100).toFixed(0)}% but risk adjustment is positive (+${signal.adjustment})`
      );
    }
    // Low win rate → risk should INCREASE (positive adjustment)
    if (signal.winRate < 0.4 && signal.adjustment < 0) {
      violations.push(
        `Direction inconsistency: win rate ${(signal.winRate * 100).toFixed(0)}% but risk adjustment is negative (${signal.adjustment})`
      );
    }
  }

  if (signal.signalType === "CONFIDENCE_ADJUSTMENT") {
    // High win rate → confidence should INCREASE (positive adjustment)
    if (signal.winRate >= 0.6 && signal.adjustment < 0) {
      violations.push(
        `Direction inconsistency: win rate ${(signal.winRate * 100).toFixed(0)}% but confidence adjustment is negative (${signal.adjustment})`
      );
    }
    // Low win rate → confidence should DECREASE (negative adjustment)
    if (signal.winRate < 0.4 && signal.adjustment > 0) {
      violations.push(
        `Direction inconsistency: win rate ${(signal.winRate * 100).toFixed(0)}% but confidence adjustment is positive (+${signal.adjustment})`
      );
    }
  }

  // ── Rule 4: Magnitude classification ──────────────────────────────────
  const expectedMagnitude = classifyFromAbsValue(Math.abs(signal.adjustment));
  if (signal.magnitude !== expectedMagnitude) {
    violations.push(
      `Magnitude mismatch: adjustment |${signal.adjustment}| should be ${expectedMagnitude} but got ${signal.magnitude}`
    );
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function classifyFromAbsValue(absValue: number): SignalMagnitude {
  if (absValue >= MAGNITUDE_RANGES.MAJOR.min) return "MAJOR";
  if (absValue >= MAGNITUDE_RANGES.MODERATE.min) return "MODERATE";
  return "MINOR";
}
