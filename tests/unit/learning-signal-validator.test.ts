/**
 * D.6.4 — Signal Validator Tests
 *
 * Tests validation rules: experiment count, adjustment cap, direction
 * consistency, and magnitude classification.
 */

import { describe, it, expect } from "vitest";
import { validateSignal } from "@/lib/learning/signal-validator";
import type { GeneratedSignal } from "@/lib/learning/signal-generator";
import type { ActionOutcomeAggregation } from "@/lib/learning/types";

function makeSignal(overrides: Partial<GeneratedSignal> = {}): GeneratedSignal {
  return {
    signalType: "RISK_ADJUSTMENT",
    actionType: "OPTIMIZE_TITLE",
    adjustment: -10,
    magnitude: "MODERATE",
    reason: "80% win rate — lower risk",
    derivedFrom: 10,
    winRate: 0.8,
    ...overrides,
  };
}

function makeAgg(overrides: Partial<ActionOutcomeAggregation> = {}): ActionOutcomeAggregation {
  return {
    actionType: "OPTIMIZE_TITLE",
    siteId: "site-1",
    totalExperiments: 10,
    wins: 8,
    losses: 2,
    inconclusive: 0,
    aborted: 0,
    winRate: 0.8,
    avgPositionDelta: 3.0,
    avgClicksLift: 20.0,
    avgCtrLift: 1.5,
    avgConfidence: 0.7,
    lastOutcomeAt: new Date(),
    experimentIds: Array.from({ length: 10 }, (_, i) => `e-${i}`),
    ...overrides,
  };
}

// ── Valid Signals ───────────────────────────────────────────────────────────

describe("Valid signals", () => {
  it("passes a well-formed RISK_ADJUSTMENT signal", () => {
    const result = validateSignal(makeSignal(), makeAgg());
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("passes a well-formed CONFIDENCE_ADJUSTMENT signal", () => {
    const signal = makeSignal({
      signalType: "CONFIDENCE_ADJUSTMENT",
      adjustment: 10,
    });
    const result = validateSignal(signal, makeAgg());
    expect(result.valid).toBe(true);
  });
});

// ── Rule 1: Minimum Experiment Count ────────────────────────────────────────

describe("Rule 1: Minimum experiment count", () => {
  it("fails when derivedFrom < minimum", () => {
    const signal = makeSignal({ derivedFrom: 3 });
    const result = validateSignal(signal, makeAgg());
    expect(result.valid).toBe(false);
    expect(result.violations[0]).toContain("Insufficient experiments");
  });

  it("passes at exactly the minimum", () => {
    const signal = makeSignal({ derivedFrom: 5 });
    const result = validateSignal(signal, makeAgg());
    expect(result.valid).toBe(true);
  });
});

// ── Rule 2: Adjustment Cap ─────────────────────────────────────────────────

describe("Rule 2: Adjustment cap", () => {
  it("fails when |adjustment| > maxAdjustment", () => {
    const signal = makeSignal({ adjustment: -20 });
    const result = validateSignal(signal, makeAgg());
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("exceeds cap"))).toBe(true);
  });

  it("passes at exactly ±15", () => {
    const signal = makeSignal({ adjustment: -15, magnitude: "MAJOR" });
    const result = validateSignal(signal, makeAgg());
    expect(result.valid).toBe(true);
  });
});

// ── Rule 3: Direction Consistency ───────────────────────────────────────────

describe("Rule 3: Direction consistency (RISK_ADJUSTMENT)", () => {
  it("fails: high win rate but positive risk adjustment", () => {
    const signal = makeSignal({
      signalType: "RISK_ADJUSTMENT",
      winRate: 0.8,
      adjustment: 10,
      magnitude: "MODERATE",
    });
    const result = validateSignal(signal, makeAgg());
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("Direction inconsistency"))).toBe(true);
  });

  it("fails: low win rate but negative risk adjustment", () => {
    const signal = makeSignal({
      signalType: "RISK_ADJUSTMENT",
      winRate: 0.2,
      adjustment: -10,
      magnitude: "MODERATE",
    });
    const result = validateSignal(signal, makeAgg({ winRate: 0.2 }));
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("Direction inconsistency"))).toBe(true);
  });

  it("passes: high win rate with negative risk adjustment", () => {
    const signal = makeSignal({
      signalType: "RISK_ADJUSTMENT",
      winRate: 0.8,
      adjustment: -10,
      magnitude: "MODERATE",
    });
    const result = validateSignal(signal, makeAgg());
    expect(result.valid).toBe(true);
  });
});

describe("Rule 3: Direction consistency (CONFIDENCE_ADJUSTMENT)", () => {
  it("fails: high win rate but negative confidence", () => {
    const signal = makeSignal({
      signalType: "CONFIDENCE_ADJUSTMENT",
      winRate: 0.8,
      adjustment: -10,
      magnitude: "MODERATE",
    });
    const result = validateSignal(signal, makeAgg());
    expect(result.valid).toBe(false);
  });

  it("fails: low win rate but positive confidence", () => {
    const signal = makeSignal({
      signalType: "CONFIDENCE_ADJUSTMENT",
      winRate: 0.2,
      adjustment: 10,
      magnitude: "MODERATE",
    });
    const result = validateSignal(signal, makeAgg({ winRate: 0.2 }));
    expect(result.valid).toBe(false);
  });

  it("passes: high win rate with positive confidence", () => {
    const signal = makeSignal({
      signalType: "CONFIDENCE_ADJUSTMENT",
      winRate: 0.8,
      adjustment: 10,
      magnitude: "MODERATE",
    });
    const result = validateSignal(signal, makeAgg());
    expect(result.valid).toBe(true);
  });
});

// ── Rule 4: Magnitude Classification ────────────────────────────────────────

describe("Rule 4: Magnitude classification", () => {
  it("fails: adjustment=10 classified as MAJOR", () => {
    const signal = makeSignal({ adjustment: -10, magnitude: "MAJOR" });
    const result = validateSignal(signal, makeAgg());
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("Magnitude mismatch"))).toBe(true);
  });

  it("fails: adjustment=15 classified as MINOR", () => {
    const signal = makeSignal({ adjustment: -15, magnitude: "MINOR" });
    const result = validateSignal(signal, makeAgg());
    expect(result.valid).toBe(false);
  });

  it("passes: adjustment=5 classified as MINOR", () => {
    const signal = makeSignal({ adjustment: -5, magnitude: "MINOR" });
    const result = validateSignal(signal, makeAgg());
    expect(result.valid).toBe(true);
  });
});

// ── Multiple Violations ─────────────────────────────────────────────────────

describe("Multiple violations", () => {
  it("reports all violations at once", () => {
    const signal = makeSignal({
      derivedFrom: 2,         // Below minimum
      adjustment: -20,        // Over cap
      magnitude: "MINOR",     // Wrong magnitude for |20|
    });
    const result = validateSignal(signal, makeAgg());
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });
});
