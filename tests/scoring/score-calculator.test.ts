/**
 * Phase D.2 — Score Calculator Tests
 *
 * Tests 5, 6, 7 from certification gates:
 *   5. Same inputs + scoring version produce same result
 *   6. Scores are bounded (0–100)
 *   7. Discovery confidence is not treated as impact score
 */

import { describe, it, expect } from "vitest";
import {
  computeScoreComponents,
  calculateFinalScore,
} from "@/lib/scoring/score-calculator";
import { DEFAULT_WEIGHTS } from "@/lib/scoring/types";
import type { ScoringInput } from "@/lib/scoring/types";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(overrides?: Partial<ScoringInput>): ScoringInput {
  return {
    opportunityId: "opp_1",
    siteId: "site_1",
    url: "/blog/test",
    primaryKeyword: "test keyword",
    category: "QUICK_WIN",
    action: "OPTIMIZE_TITLE",
    discoveryConfidence: 0.8,
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    lastRefreshedAt: new Date(),
    primaryDiscoverySource: "GSC",
    evidenceItems: [
      {
        sourceType: "GSC",
        metric: "position",
        value: "8.5",
        observedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      },
    ],
    existingScore: null,
    metadata: { impressions: 500, position: 8 },
    ...overrides,
  };
}

// ── §1 Component Score Bounds ───────────────────────────────────────────────

describe("§1 — All component scores are bounded 0–100", () => {
  it("standard input produces scores within bounds", () => {
    const components = computeScoreComponents(makeInput());

    expect(components.impactScore).toBeGreaterThanOrEqual(0);
    expect(components.impactScore).toBeLessThanOrEqual(100);
    expect(components.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(components.confidenceScore).toBeLessThanOrEqual(100);
    expect(components.evidenceScore).toBeGreaterThanOrEqual(0);
    expect(components.evidenceScore).toBeLessThanOrEqual(100);
    expect(components.urgencyScore).toBeGreaterThanOrEqual(0);
    expect(components.urgencyScore).toBeLessThanOrEqual(100);
    expect(components.effortScore).toBeGreaterThanOrEqual(0);
    expect(components.effortScore).toBeLessThanOrEqual(100);
    expect(components.riskScore).toBeGreaterThanOrEqual(0);
    expect(components.riskScore).toBeLessThanOrEqual(100);
  });

  it("extreme high values still bounded", () => {
    const components = computeScoreComponents(makeInput({
      category: "DECLINING",
      metadata: { impressions: 100000, position: 1 },
      evidenceItems: Array.from({ length: 20 }, (_, i) => ({
        sourceType: ["GSC", "AUDIT", "CONTENT", "CRAWL"][i % 4],
        metric: "position",
        value: "1",
        observedAt: new Date(),
      })),
    }));

    for (const [, score] of Object.entries(components)) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("minimal input (no evidence, no metadata) still bounded", () => {
    const components = computeScoreComponents(makeInput({
      evidenceItems: [{
        sourceType: "GSC",
        observedAt: new Date(),
      }],
      metadata: {},
      discoveryConfidence: null,
      expiresAt: null,
    }));

    for (const [, score] of Object.entries(components)) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

// ── §2 Final Score ──────────────────────────────────────────────────────────

describe("§2 — Final score calculation", () => {
  it("final score is bounded 0–100", () => {
    const components = computeScoreComponents(makeInput());
    const final = calculateFinalScore(components);

    expect(final).toBeGreaterThanOrEqual(0);
    expect(final).toBeLessThanOrEqual(100);
  });

  it("weights sum to 1.0 (positive and negative cancel out)", () => {
    const w = DEFAULT_WEIGHTS;
    // impact + confidence + evidence + urgency = positive
    // effort + risk = negative (subtracted)
    const positiveSum = w.impact + w.confidence + w.evidence + w.urgency;
    const negativeSum = w.effort + w.risk;
    expect(positiveSum + negativeSum).toBeCloseTo(1.0, 10);
  });

  it("higher impact score increases final score", () => {
    const low = computeScoreComponents(makeInput({ metadata: {} }));
    const high = computeScoreComponents(makeInput({ metadata: { impressions: 5000, position: 5 } }));

    const lowFinal = calculateFinalScore(low);
    const highFinal = calculateFinalScore(high);

    expect(highFinal).toBeGreaterThan(lowFinal);
  });
});

// ── §3 Determinism ──────────────────────────────────────────────────────────

describe("§3 — Same inputs produce same result", () => {
  it("identical inputs produce identical scores", () => {
    const input = makeInput();
    const r1 = computeScoreComponents(input);
    const r2 = computeScoreComponents(input);

    expect(r1).toEqual(r2);
  });

  it("identical inputs produce identical final scores", () => {
    const input = makeInput();
    const c1 = computeScoreComponents(input);
    const c2 = computeScoreComponents(input);

    expect(calculateFinalScore(c1)).toBe(calculateFinalScore(c2));
  });

  it("scores are integers (clamped and rounded)", () => {
    const components = computeScoreComponents(makeInput());
    for (const [, score] of Object.entries(components)) {
      expect(Number.isInteger(score)).toBe(true);
    }
  });
});

// ── §4 Discovery Confidence Separation ──────────────────────────────────────

describe("§4 — Discovery confidence is NOT treated as impact score", () => {
  it("discoveryConfidence does NOT directly set impactScore", () => {
    const highDiscConf = computeScoreComponents(makeInput({ discoveryConfidence: 0.99 }));
    const lowDiscConf = computeScoreComponents(makeInput({ discoveryConfidence: 0.01 }));

    // Impact should be the same regardless of discoveryConfidence
    // (discoveryConfidence only influences confidenceScore, slightly)
    expect(highDiscConf.impactScore).toBe(lowDiscConf.impactScore);
  });

  it("discoveryConfidence contributes to confidenceScore but does not dominate", () => {
    const withConf = computeScoreComponents(makeInput({ discoveryConfidence: 1.0 }));
    const withoutConf = computeScoreComponents(makeInput({ discoveryConfidence: 0.0 }));

    // Difference should be at most 15 points (the cap in score-calculator)
    expect(withConf.confidenceScore - withoutConf.confidenceScore).toBeLessThanOrEqual(15);
  });

  it("null discoveryConfidence is handled gracefully", () => {
    const components = computeScoreComponents(makeInput({ discoveryConfidence: null }));
    expect(components.confidenceScore).toBeGreaterThan(0);
  });
});

// ── §5 Category-Specific Scoring ────────────────────────────────────────────

describe("§5 — Category-specific impact", () => {
  it("DECLINING has higher impact than DEAD_WEIGHT", () => {
    const declining = computeScoreComponents(makeInput({ category: "DECLINING" }));
    const deadWeight = computeScoreComponents(makeInput({ category: "DEAD_WEIGHT" }));

    expect(declining.impactScore).toBeGreaterThan(deadWeight.impactScore);
  });

  it("DECLINING has higher urgency than STALE", () => {
    const declining = computeScoreComponents(makeInput({ category: "DECLINING" }));
    const stale = computeScoreComponents(makeInput({ category: "STALE" }));

    expect(declining.urgencyScore).toBeGreaterThan(stale.urgencyScore);
  });
});

// ── §6 Action-Specific Scoring ──────────────────────────────────────────────

describe("§6 — Action-specific effort and risk", () => {
  it("OPTIMIZE_TITLE has lower effort than CREATE_NEW_CONTENT", () => {
    const title = computeScoreComponents(makeInput({ action: "OPTIMIZE_TITLE" }));
    const create = computeScoreComponents(makeInput({ action: "CREATE_NEW_CONTENT" }));

    expect(title.effortScore).toBeLessThan(create.effortScore);
  });

  it("DEINDEX_OR_REDIRECT has higher risk than BUILD_INTERNAL_LINKS", () => {
    const deindex = computeScoreComponents(makeInput({ action: "DEINDEX_OR_REDIRECT" }));
    const links = computeScoreComponents(makeInput({ action: "BUILD_INTERNAL_LINKS" }));

    expect(deindex.riskScore).toBeGreaterThan(links.riskScore);
  });
});
