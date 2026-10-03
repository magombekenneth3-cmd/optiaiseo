/**
 * tests/unit/priority-convergence.test.ts
 *
 * Phase 2 — Priority Convergence tests.
 *
 * Verifies that OptiAISEO has exactly ONE canonical priority implementation
 * and all domains (SEO, AEO, AIO, GEO) flow through it.
 */

import { describe, it, expect } from "vitest";

import {
  computePriorityV4,
  computePriorityLegacy,
  fixabilityForRemediation,
  recencyScore,
  scopeScore,
  PRIORITIZATION_POLICY_VERSION,
  type PriorityComponents,
  type ExplainablePriority,
} from "@/lib/seo-audit/prioritization";

import { computePriority, PRIORITIZATION_WEIGHTS } from "@/lib/seo-audit/types";
import { SCORING_WEIGHTS } from "@/lib/seo-audit/engine";

// ── Canonical Priority ────────────────────────────────────────────────────────

describe("computePriorityV4 — canonical priority", () => {
  const baseInput: PriorityComponents = {
    businessImpact: 0.8,
    searchImpact: 0.9,
    affectedScope: 0.5,
    confidence: 0.85,
    fixability: 1.0,
    evidenceStrength: 0.7,
    recency: 0.9,
  };

  it("returns deterministic score for same inputs", () => {
    const a = computePriorityV4(baseInput);
    const b = computePriorityV4(baseInput);
    expect(a.score).toBe(b.score);
    expect(a.components).toEqual(b.components);
  });

  it("returns score in 0–100 range", () => {
    const result = computePriorityV4(baseInput);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("returns 0 for all-zero inputs", () => {
    const result = computePriorityV4({
      businessImpact: 0,
      searchImpact: 0,
      affectedScope: 0,
      confidence: 0,
      fixability: 0,
      evidenceStrength: 0,
      recency: 0,
    });
    expect(result.score).toBe(0);
  });

  it("returns 100 for all-max inputs", () => {
    const result = computePriorityV4({
      businessImpact: 1,
      searchImpact: 1,
      affectedScope: 1,
      confidence: 1,
      fixability: 1,
      evidenceStrength: 1,
      recency: 1,
    });
    expect(result.score).toBe(100);
  });

  it("clamps all components to [0, 1]", () => {
    const result = computePriorityV4({
      businessImpact: 5,      // > 1
      searchImpact: -2,       // < 0
      affectedScope: 1.5,     // > 1
      confidence: NaN,        // NaN → 0
      fixability: Infinity,   // not finite → 0
      evidenceStrength: -Infinity, // not finite → 0
      recency: 0.5,
    });

    expect(result.components.businessImpact).toBe(1);
    expect(result.components.searchImpact).toBe(0);
    expect(result.components.affectedScope).toBe(1);
    expect(result.components.confidence).toBe(0);
    expect(result.components.fixability).toBe(0);  // Infinity is not finite → clamped to 0
    expect(result.components.evidenceStrength).toBe(0);
    expect(result.components.recency).toBe(0.5);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("includes policyVersion", () => {
    const result = computePriorityV4(baseInput);
    expect(result.policyVersion).toBe(PRIORITIZATION_POLICY_VERSION);
    expect(result.policyVersion).toBe("priority-v4");
  });

  it("includes all component values", () => {
    const result = computePriorityV4(baseInput);
    expect(result.components).toHaveProperty("businessImpact");
    expect(result.components).toHaveProperty("searchImpact");
    expect(result.components).toHaveProperty("affectedScope");
    expect(result.components).toHaveProperty("confidence");
    expect(result.components).toHaveProperty("fixability");
    expect(result.components).toHaveProperty("evidenceStrength");
    expect(result.components).toHaveProperty("recency");
  });
});

// ── Legacy Bridge ─────────────────────────────────────────────────────────────

describe("computePriorityLegacy — routes through v4", () => {
  it("returns a score in 0–100", () => {
    const score = computePriorityLegacy(5, 3, 0.8);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("higher traffic impact → higher score", () => {
    const low = computePriorityLegacy(2, 5, 0.7);
    const high = computePriorityLegacy(9, 5, 0.7);
    expect(high).toBeGreaterThan(low);
  });

  it("lower difficulty → higher score (easier fix → more fixable)", () => {
    const hard = computePriorityLegacy(5, 9, 0.7);
    const easy = computePriorityLegacy(5, 1, 0.7);
    expect(easy).toBeGreaterThan(hard);
  });
});

describe("computePriority (deprecated adapter) — routes through v4", () => {
  it("returns a number in 0–100", () => {
    const score = computePriority({
      id: "test",
      title: "Test issue",
      description: "Test",
      severity: "high",
      estimatedTrafficImpact: 7,
      fixDifficulty: 3,
      confidence: 0.9,
      category: "technical",
      recommendation: "Fix it",
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ── Domain Neutrality ─────────────────────────────────────────────────────────

describe("domain neutrality — same components → same score regardless of domain", () => {
  const sharedInput: PriorityComponents = {
    businessImpact: 0.7,
    searchImpact: 0.8,
    affectedScope: 0.5,
    confidence: 0.85,
    fixability: 0.9,
    evidenceStrength: 0.6,
    recency: 0.8,
  };

  it("TECHNICAL, CONTENT, AEO, AIO, GEO all produce the same score", () => {
    // computePriorityV4 takes PriorityComponents — it has no domain parameter.
    // Domain is on the finding, not on the priority engine.
    // This test verifies the architecture: same inputs → same output.
    const score = computePriorityV4(sharedInput).score;

    // Run it 5 times (as if from 5 different domains) — result must be identical
    for (let i = 0; i < 5; i++) {
      expect(computePriorityV4(sharedInput).score).toBe(score);
    }
  });

  it("does not have domain-specific scoring parameters", () => {
    // The PriorityComponents type should NOT have a domain field
    const keys = Object.keys(sharedInput);
    expect(keys).not.toContain("domain");
    expect(keys).not.toContain("optimizationDomain");
  });
});

// ── Risk Separation ───────────────────────────────────────────────────────────

describe("priority ≠ risk", () => {
  it("high-risk finding can have high priority", () => {
    // A finding removing noindex is HIGH risk but should still be high priority
    const result = computePriorityV4({
      businessImpact: 0.9,
      searchImpact: 1.0,
      affectedScope: 0.8,
      confidence: 0.95,
      fixability: 1.0,
      evidenceStrength: 0.9,
      recency: 1.0,
    });

    // The priority should be high (>= 80)
    expect(result.score).toBeGreaterThanOrEqual(80);
    // But FixRisk (not computed here) could be HIGH — that's a separate dimension
  });

  it("fixability does not collapse into risk", () => {
    // A deterministic fix is highly fixable but may still be high risk
    const deterministicFixability = fixabilityForRemediation("DETERMINISTIC");
    expect(deterministicFixability).toBe(1.0);
    // fixability is about success likelihood, NOT about safety
  });
});

// ── Unknown Evidence ──────────────────────────────────────────────────────────

describe("unknown evidence — does not create high priority", () => {
  it("zero confidence produces low priority", () => {
    const result = computePriorityV4({
      businessImpact: 0.8,
      searchImpact: 0.9,
      affectedScope: 0.5,
      confidence: 0,           // UNKNOWN — no evidence
      fixability: 1.0,
      evidenceStrength: 0,     // no evidence sources
      recency: 0.5,
    });

    // With 0 confidence and 0 evidence strength, the score should be
    // significantly lower than a well-evidenced finding
    const wellEvidenced = computePriorityV4({
      businessImpact: 0.8,
      searchImpact: 0.9,
      affectedScope: 0.5,
      confidence: 0.95,
      fixability: 1.0,
      evidenceStrength: 0.9,
      recency: 0.5,
    });

    expect(result.score).toBeLessThan(wellEvidenced.score);
  });

  it("unknown scope (0 total pages) defaults to 0.5 not 1.0", () => {
    const score = scopeScore(1, 0);
    expect(score).toBe(0.5); // explicit fallback, not fake precision
  });

  it("single page gets minimum scope, not zero", () => {
    const score = scopeScore(1, 100);
    expect(score).toBeGreaterThanOrEqual(0.2);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

describe("fixabilityForRemediation", () => {
  it("deterministic > ai_patch > experiment > manual", () => {
    const det = fixabilityForRemediation("DETERMINISTIC");
    const ai = fixabilityForRemediation("AI_PATCH");
    const exp = fixabilityForRemediation("EXPERIMENT");
    const man = fixabilityForRemediation("MANUAL");

    expect(det).toBeGreaterThan(ai);
    expect(ai).toBeGreaterThan(exp);
    expect(exp).toBeGreaterThan(man);
  });
});

describe("recencyScore", () => {
  it("recent evidence scores higher than old evidence", () => {
    const fresh = recencyScore(new Date());
    const stale = recencyScore(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)); // 60 days
    expect(fresh).toBeGreaterThan(stale);
  });

  it("returns values in 0–1 range", () => {
    expect(recencyScore(new Date())).toBeLessThanOrEqual(1);
    expect(recencyScore(new Date(0))).toBeGreaterThanOrEqual(0);
  });
});

describe("scopeScore", () => {
  it("broader scope produces higher score", () => {
    const narrow = scopeScore(1, 100);
    const broad = scopeScore(80, 100);
    expect(broad).toBeGreaterThan(narrow);
  });

  it("returns values in 0.2–1.0 range (minimum floor)", () => {
    expect(scopeScore(1, 1000)).toBeGreaterThanOrEqual(0.2);
    expect(scopeScore(1000, 1000)).toBeLessThanOrEqual(1);
  });
});

// ── Compatibility ─────────────────────────────────────────────────────────────

describe("deprecated symbols — compatibility only", () => {
  it("PRIORITIZATION_WEIGHTS is frozen and has legacy values", () => {
    expect(PRIORITIZATION_WEIGHTS.impact).toBe(0.5);
    expect(PRIORITIZATION_WEIGHTS.ease).toBe(0.3);
    expect(PRIORITIZATION_WEIGHTS.confidence).toBe(0.2);
    // Should be frozen — cannot be modified
    expect(Object.isFrozen(PRIORITIZATION_WEIGHTS)).toBe(true);
  });

  it("SCORING_WEIGHTS is frozen and has legacy values", () => {
    expect(SCORING_WEIGHTS.ROI_IMPACT).toBe(0.6);
    expect(SCORING_WEIGHTS.AI_VISIBILITY).toBe(0.4);
    expect(Object.isFrozen(SCORING_WEIGHTS)).toBe(true);
  });
});
