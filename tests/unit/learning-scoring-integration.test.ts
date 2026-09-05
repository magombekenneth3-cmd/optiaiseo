/**
 * D.6.5 — Scoring Integration Tests
 *
 * Tests that D.6 learned signals are applied as additive adjustments
 * to D.2 score components, with fallback to defaults when no signals exist.
 */

import { describe, it, expect } from "vitest";
import {
  computeScoreComponents,
  calculateFinalScore,
} from "@/lib/scoring/score-calculator";
import type { ScoringInput } from "@/lib/scoring/types";
import type { LearnedSignalMap, LearnedSignalRecord } from "@/lib/learning/signal-registry";

function makeScoringInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    opportunityId: "opp-1",
    siteId: "site-1",
    url: "https://example.com/page-1",
    primaryKeyword: "seo tool",
    category: "QUICK_WIN",
    action: "OPTIMIZE_TITLE",
    discoveryConfidence: 0.8,
    expiresAt: null,
    lastRefreshedAt: new Date(),
    primaryDiscoverySource: "GSC",
    evidenceItems: [
      { sourceType: "GSC", metric: "position", value: "12", observedAt: new Date() },
      { sourceType: "GSC", metric: "clicks", value: "50", observedAt: new Date() },
      { sourceType: "CONTENT", metric: "freshness", value: "stale", observedAt: new Date() },
    ],
    existingScore: null,
    metadata: { impressions: 500, position: 12 },
    ...overrides,
  };
}

function makeSignalMap(entries: Array<[string, Partial<LearnedSignalRecord>]>): LearnedSignalMap {
  const map: LearnedSignalMap = new Map();
  for (const [key, partial] of entries) {
    map.set(key, {
      id: "sig-1",
      siteId: "site-1",
      signalType: key.split(":")[0],
      actionType: key.split(":")[1],
      adjustment: 0,
      magnitude: "MODERATE",
      derivedFrom: 10,
      winRate: 0.8,
      reason: "test signal",
      status: "ACTIVE",
      version: 1,
      activatedAt: new Date(),
      createdAt: new Date(),
      ...partial,
    });
  }
  return map;
}

// ── Backward Compatibility ──────────────────────────────────────────────────

describe("Backward compatibility", () => {
  it("produces identical scores when no signals are passed", () => {
    const input = makeScoringInput();
    const withoutSignals = computeScoreComponents(input);
    const withEmptySignals = computeScoreComponents(input, new Map());
    const withUndefined = computeScoreComponents(input, undefined);

    expect(withoutSignals).toEqual(withEmptySignals);
    expect(withoutSignals).toEqual(withUndefined);
  });

  it("produces identical scores when signal map has no matching action", () => {
    const input = makeScoringInput({ action: "OPTIMIZE_TITLE" });
    const signals = makeSignalMap([
      ["RISK_ADJUSTMENT:REFRESH_CONTENT", { adjustment: -15 }], // Wrong action
    ]);
    const withoutSignals = computeScoreComponents(input);
    const withSignals = computeScoreComponents(input, signals);

    expect(withSignals).toEqual(withoutSignals);
  });
});

// ── Risk Adjustment ─────────────────────────────────────────────────────────

describe("Risk signal integration", () => {
  it("negative risk adjustment decreases risk score", () => {
    const input = makeScoringInput();
    const baseline = computeScoreComponents(input);
    const signals = makeSignalMap([
      ["RISK_ADJUSTMENT:OPTIMIZE_TITLE", { adjustment: -10 }],
    ]);
    const adjusted = computeScoreComponents(input, signals);

    expect(adjusted.riskScore).toBeLessThan(baseline.riskScore);
  });

  it("positive risk adjustment increases risk score", () => {
    const input = makeScoringInput();
    const baseline = computeScoreComponents(input);
    const signals = makeSignalMap([
      ["RISK_ADJUSTMENT:OPTIMIZE_TITLE", { adjustment: 10 }],
    ]);
    const adjusted = computeScoreComponents(input, signals);

    expect(adjusted.riskScore).toBeGreaterThan(baseline.riskScore);
  });

  it("risk score is still clamped to 0-100", () => {
    const input = makeScoringInput();
    const signals = makeSignalMap([
      ["RISK_ADJUSTMENT:OPTIMIZE_TITLE", { adjustment: -100 }],
    ]);
    const adjusted = computeScoreComponents(input, signals);
    expect(adjusted.riskScore).toBeGreaterThanOrEqual(0);
    expect(adjusted.riskScore).toBeLessThanOrEqual(100);
  });
});

// ── Confidence Adjustment ───────────────────────────────────────────────────

describe("Confidence signal integration", () => {
  it("positive confidence adjustment increases confidence score", () => {
    const input = makeScoringInput();
    const baseline = computeScoreComponents(input);
    const signals = makeSignalMap([
      ["CONFIDENCE_ADJUSTMENT:OPTIMIZE_TITLE", { adjustment: 15 }],
    ]);
    const adjusted = computeScoreComponents(input, signals);

    expect(adjusted.confidenceScore).toBeGreaterThan(baseline.confidenceScore);
  });

  it("negative confidence adjustment decreases confidence score", () => {
    const input = makeScoringInput();
    const baseline = computeScoreComponents(input);
    const signals = makeSignalMap([
      ["CONFIDENCE_ADJUSTMENT:OPTIMIZE_TITLE", { adjustment: -15 }],
    ]);
    const adjusted = computeScoreComponents(input, signals);

    expect(adjusted.confidenceScore).toBeLessThan(baseline.confidenceScore);
  });

  it("confidence score is still clamped to 0-100", () => {
    const input = makeScoringInput();
    const signals = makeSignalMap([
      ["CONFIDENCE_ADJUSTMENT:OPTIMIZE_TITLE", { adjustment: 200 }],
    ]);
    const adjusted = computeScoreComponents(input, signals);
    expect(adjusted.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(adjusted.confidenceScore).toBeLessThanOrEqual(100);
  });
});

// ── Combined Signals ────────────────────────────────────────────────────────

describe("Combined signals", () => {
  it("both risk and confidence signals apply simultaneously", () => {
    const input = makeScoringInput();
    const baseline = computeScoreComponents(input);
    const signals = makeSignalMap([
      ["RISK_ADJUSTMENT:OPTIMIZE_TITLE", { adjustment: -10 }],
      ["CONFIDENCE_ADJUSTMENT:OPTIMIZE_TITLE", { adjustment: 10 }],
    ]);
    const adjusted = computeScoreComponents(input, signals);

    expect(adjusted.riskScore).toBeLessThan(baseline.riskScore);
    expect(adjusted.confidenceScore).toBeGreaterThan(baseline.confidenceScore);
    // Other components unchanged
    expect(adjusted.impactScore).toBe(baseline.impactScore);
    expect(adjusted.evidenceScore).toBe(baseline.evidenceScore);
    expect(adjusted.urgencyScore).toBe(baseline.urgencyScore);
    expect(adjusted.effortScore).toBe(baseline.effortScore);
  });

  it("combined signals improve final score (lower risk + higher confidence)", () => {
    const input = makeScoringInput();
    const baseline = computeScoreComponents(input);
    const signals = makeSignalMap([
      ["RISK_ADJUSTMENT:OPTIMIZE_TITLE", { adjustment: -15 }],
      ["CONFIDENCE_ADJUSTMENT:OPTIMIZE_TITLE", { adjustment: 15 }],
    ]);
    const adjusted = computeScoreComponents(input, signals);

    const baselineScore = calculateFinalScore(baseline);
    const adjustedScore = calculateFinalScore(adjusted);

    expect(adjustedScore).toBeGreaterThan(baselineScore);
  });
});

// ── Unaffected Components ───────────────────────────────────────────────────

describe("Unaffected components", () => {
  it("impact score is never modified by signals", () => {
    const input = makeScoringInput();
    const baseline = computeScoreComponents(input);
    const signals = makeSignalMap([
      ["RISK_ADJUSTMENT:OPTIMIZE_TITLE", { adjustment: -15 }],
      ["CONFIDENCE_ADJUSTMENT:OPTIMIZE_TITLE", { adjustment: 15 }],
    ]);
    const adjusted = computeScoreComponents(input, signals);
    expect(adjusted.impactScore).toBe(baseline.impactScore);
  });

  it("evidence score is never modified by signals", () => {
    const input = makeScoringInput();
    const baseline = computeScoreComponents(input);
    const signals = makeSignalMap([
      ["RISK_ADJUSTMENT:OPTIMIZE_TITLE", { adjustment: -15 }],
    ]);
    const adjusted = computeScoreComponents(input, signals);
    expect(adjusted.evidenceScore).toBe(baseline.evidenceScore);
  });

  it("urgency score is never modified by signals", () => {
    const input = makeScoringInput();
    const baseline = computeScoreComponents(input);
    const signals = makeSignalMap([
      ["CONFIDENCE_ADJUSTMENT:OPTIMIZE_TITLE", { adjustment: 15 }],
    ]);
    const adjusted = computeScoreComponents(input, signals);
    expect(adjusted.urgencyScore).toBe(baseline.urgencyScore);
  });

  it("effort score is never modified by signals", () => {
    const input = makeScoringInput();
    const baseline = computeScoreComponents(input);
    const signals = makeSignalMap([
      ["RISK_ADJUSTMENT:OPTIMIZE_TITLE", { adjustment: -15 }],
    ]);
    const adjusted = computeScoreComponents(input, signals);
    expect(adjusted.effortScore).toBe(baseline.effortScore);
  });
});
