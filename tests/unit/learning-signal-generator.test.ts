/**
 * D.6.3 — Signal Generator Tests
 *
 * Tests deterministic signal derivation from experiment aggregations.
 */

import { describe, it, expect } from "vitest";
import { generateSignals, classifyMagnitude } from "@/lib/learning/signal-generator";
import type { ActionOutcomeAggregation } from "@/lib/learning/types";

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
    lastOutcomeAt: new Date("2026-09-01"),
    experimentIds: ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10"],
    ...overrides,
  };
}

// ── Maturity Gate ───────────────────────────────────────────────────────────

describe("Maturity Gate", () => {
  it("generates no signals below 5 decided experiments", () => {
    const agg = makeAgg({ wins: 3, losses: 1, winRate: 0.75, totalExperiments: 4 });
    expect(generateSignals(agg)).toEqual([]);
  });

  it("generates signals at exactly 5 decided experiments", () => {
    const agg = makeAgg({ wins: 4, losses: 1, winRate: 0.8, totalExperiments: 5 });
    expect(generateSignals(agg).length).toBeGreaterThan(0);
  });

  it("generates no signals when winRate is null", () => {
    const agg = makeAgg({ wins: 0, losses: 0, winRate: null, totalExperiments: 10, inconclusive: 10 });
    expect(generateSignals(agg)).toEqual([]);
  });
});

// ── High Win Rate (≥80%) ────────────────────────────────────────────────────

describe("High win rate (≥80%)", () => {
  const agg = makeAgg({ wins: 8, losses: 2, winRate: 0.8 });
  const signals = generateSignals(agg);

  it("generates RISK_ADJUSTMENT = -15 (MAJOR)", () => {
    const risk = signals.find(s => s.signalType === "RISK_ADJUSTMENT");
    expect(risk).toBeDefined();
    expect(risk!.adjustment).toBe(-15);
    expect(risk!.magnitude).toBe("MAJOR");
  });

  it("generates CONFIDENCE_ADJUSTMENT = +15 (MAJOR)", () => {
    const conf = signals.find(s => s.signalType === "CONFIDENCE_ADJUSTMENT");
    expect(conf).toBeDefined();
    expect(conf!.adjustment).toBe(15);
    expect(conf!.magnitude).toBe("MAJOR");
  });

  it("generates exactly 2 signals", () => {
    expect(signals).toHaveLength(2);
  });
});

// ── Moderate Win Rate (60-79%) ──────────────────────────────────────────────

describe("Moderate win rate (60-79%)", () => {
  const agg = makeAgg({ wins: 7, losses: 3, winRate: 0.7 });
  const signals = generateSignals(agg);

  it("generates RISK_ADJUSTMENT = -10 (MODERATE)", () => {
    const risk = signals.find(s => s.signalType === "RISK_ADJUSTMENT");
    expect(risk!.adjustment).toBe(-10);
    expect(risk!.magnitude).toBe("MODERATE");
  });

  it("generates CONFIDENCE_ADJUSTMENT = +10 (MODERATE)", () => {
    const conf = signals.find(s => s.signalType === "CONFIDENCE_ADJUSTMENT");
    expect(conf!.adjustment).toBe(10);
    expect(conf!.magnitude).toBe("MODERATE");
  });
});

// ── Dead Zone (40-59%) ──────────────────────────────────────────────────────

describe("Dead zone (40-59%)", () => {
  it("generates NO signals at 50% win rate", () => {
    const agg = makeAgg({ wins: 5, losses: 5, winRate: 0.5 });
    expect(generateSignals(agg)).toEqual([]);
  });

  it("generates NO signals at 40% win rate", () => {
    const agg = makeAgg({ wins: 4, losses: 6, winRate: 0.4 });
    expect(generateSignals(agg)).toEqual([]);
  });

  it("generates NO signals at 59% win rate", () => {
    const agg = makeAgg({ wins: 59, losses: 41, winRate: 0.59, totalExperiments: 100 });
    expect(generateSignals(agg)).toEqual([]);
  });
});

// ── Low Win Rate (20-39%) ───────────────────────────────────────────────────

describe("Low win rate (20-39%)", () => {
  const agg = makeAgg({ wins: 3, losses: 7, winRate: 0.3 });
  const signals = generateSignals(agg);

  it("generates RISK_ADJUSTMENT = +10 (MODERATE)", () => {
    const risk = signals.find(s => s.signalType === "RISK_ADJUSTMENT");
    expect(risk!.adjustment).toBe(10);
    expect(risk!.magnitude).toBe("MODERATE");
  });

  it("generates CONFIDENCE_ADJUSTMENT = -10 (MODERATE)", () => {
    const conf = signals.find(s => s.signalType === "CONFIDENCE_ADJUSTMENT");
    expect(conf!.adjustment).toBe(-10);
    expect(conf!.magnitude).toBe("MODERATE");
  });
});

// ── Very Low Win Rate (<20%) ────────────────────────────────────────────────

describe("Very low win rate (<20%)", () => {
  const agg = makeAgg({ wins: 1, losses: 9, winRate: 0.1 });
  const signals = generateSignals(agg);

  it("generates RISK_ADJUSTMENT = +15 (MAJOR)", () => {
    const risk = signals.find(s => s.signalType === "RISK_ADJUSTMENT");
    expect(risk!.adjustment).toBe(15);
    expect(risk!.magnitude).toBe("MAJOR");
  });

  it("generates CONFIDENCE_ADJUSTMENT = -15 (MAJOR)", () => {
    const conf = signals.find(s => s.signalType === "CONFIDENCE_ADJUSTMENT");
    expect(conf!.adjustment).toBe(-15);
    expect(conf!.magnitude).toBe("MAJOR");
  });
});

// ── Magnitude Classification ────────────────────────────────────────────────

describe("classifyMagnitude", () => {
  it("1-5 is MINOR", () => {
    expect(classifyMagnitude(1)).toBe("MINOR");
    expect(classifyMagnitude(5)).toBe("MINOR");
  });

  it("6-10 is MODERATE", () => {
    expect(classifyMagnitude(6)).toBe("MODERATE");
    expect(classifyMagnitude(10)).toBe("MODERATE");
  });

  it("11-15 is MAJOR", () => {
    expect(classifyMagnitude(11)).toBe("MAJOR");
    expect(classifyMagnitude(15)).toBe("MAJOR");
  });

  it("0 is MINOR", () => {
    expect(classifyMagnitude(0)).toBe("MINOR");
  });
});

// ── Max Adjustment Cap ──────────────────────────────────────────────────────

describe("Max adjustment cap", () => {
  it("respects custom maxAdjustment", () => {
    const agg = makeAgg({ wins: 9, losses: 1, winRate: 0.9 });
    const signals = generateSignals(agg, 5, 8); // cap at ±8

    const risk = signals.find(s => s.signalType === "RISK_ADJUSTMENT");
    expect(Math.abs(risk!.adjustment)).toBeLessThanOrEqual(8);
  });
});

// ── Signal Provenance ───────────────────────────────────────────────────────

describe("Signal provenance", () => {
  it("carries derivedFrom count", () => {
    const agg = makeAgg({ wins: 8, losses: 2, winRate: 0.8 });
    const signals = generateSignals(agg);
    for (const s of signals) {
      expect(s.derivedFrom).toBe(10); // wins + losses
    }
  });

  it("carries winRate", () => {
    const agg = makeAgg({ wins: 8, losses: 2, winRate: 0.8 });
    const signals = generateSignals(agg);
    for (const s of signals) {
      expect(s.winRate).toBe(0.8);
    }
  });

  it("carries actionType", () => {
    const agg = makeAgg({ actionType: "REFRESH_CONTENT" });
    const signals = generateSignals(agg);
    for (const s of signals) {
      expect(s.actionType).toBe("REFRESH_CONTENT");
    }
  });
});
