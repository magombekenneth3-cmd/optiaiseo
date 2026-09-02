/**
 * Phase D.2 — Eligibility Tests
 *
 * Tests 3, 4 from certification gates:
 *   3. Expired evidence never promotes
 *   4. Insufficient evidence never promotes
 *
 * Plus: rule ordering, threshold enforcement, decision reasons.
 */

import { describe, it, expect } from "vitest";
import { evaluateEligibility } from "@/lib/scoring/eligibility";
import type { ScoreComponents, ScoringInput, EligibilityConfig } from "@/lib/scoring/types";
import { DEFAULT_ELIGIBILITY } from "@/lib/scoring/types";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeComponents(overrides?: Partial<ScoreComponents>): ScoreComponents {
  return {
    impactScore: 60,
    confidenceScore: 55,
    evidenceScore: 50,
    urgencyScore: 45,
    effortScore: 30,
    riskScore: 20,
    ...overrides,
  };
}

function makeCandidate(overrides?: Partial<ScoringInput>): ScoringInput {
  return {
    opportunityId: "opp_1",
    siteId: "site_1",
    url: "/blog/test",
    primaryKeyword: "test keyword",
    category: "QUICK_WIN",
    action: "OPTIMIZE_TITLE",
    discoveryConfidence: 0.8,
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
    lastRefreshedAt: new Date(),
    primaryDiscoverySource: "GSC",
    evidenceItems: [],
    existingScore: null,
    metadata: {},
    ...overrides,
  };
}

// ── §1 Expired Evidence → DEFER ──────────────────────────────────────────────

describe("§1 — Expired evidence never promotes", () => {
  it("returns DEFER when evidence is expired", () => {
    const expired = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
    const result = evaluateEligibility(
      makeComponents(),
      80, // High score — would normally promote
      makeCandidate({ expiresAt: expired }),
    );

    expect(result.decision).toBe("DEFER");
    expect(result.reasons.some((r) => r.rule === "EVIDENCE_EXPIRED")).toBe(true);
  });

  it("does NOT promote even with perfect scores when expired", () => {
    const expired = new Date(Date.now() - 1000);
    const result = evaluateEligibility(
      makeComponents({ impactScore: 100, confidenceScore: 100, evidenceScore: 100 }),
      99,
      makeCandidate({ expiresAt: expired }),
    );

    expect(result.decision).toBe("DEFER");
  });
});

// ── §2 Insufficient Evidence → DEFER ────────────────────────────────────────

describe("§2 — Insufficient evidence never promotes", () => {
  it("returns DEFER when evidence score below minimum", () => {
    const result = evaluateEligibility(
      makeComponents({ evidenceScore: 10 }), // Below min (30)
      80,
      makeCandidate(),
    );

    expect(result.decision).toBe("DEFER");
    expect(result.reasons.some((r) => r.rule === "INSUFFICIENT_EVIDENCE")).toBe(true);
  });

  it("boundary: exactly at minimum is NOT insufficient", () => {
    const result = evaluateEligibility(
      makeComponents({ evidenceScore: 30 }),
      80,
      makeCandidate(),
    );

    expect(result.reasons.every((r) => r.rule !== "INSUFFICIENT_EVIDENCE")).toBe(true);
  });
});

// ── §3 Excessive Risk → REJECT ──────────────────────────────────────────────

describe("§3 — Excessive risk triggers REJECT", () => {
  it("returns REJECT when risk exceeds maximum", () => {
    const result = evaluateEligibility(
      makeComponents({ riskScore: 90 }), // Above max (80)
      80,
      makeCandidate(),
    );

    expect(result.decision).toBe("REJECT");
    expect(result.reasons.some((r) => r.rule === "EXCESSIVE_RISK")).toBe(true);
  });

  it("boundary: exactly at maximum is NOT excessive", () => {
    const result = evaluateEligibility(
      makeComponents({ riskScore: 80 }),
      80,
      makeCandidate(),
    );

    expect(result.reasons.every((r) => r.rule !== "EXCESSIVE_RISK")).toBe(true);
  });
});

// ── §4 Score Threshold → PROMOTE ────────────────────────────────────────────

describe("§4 — Score threshold triggers PROMOTE", () => {
  it("returns PROMOTE when final score meets threshold", () => {
    const result = evaluateEligibility(
      makeComponents(),
      50, // Exactly at threshold
      makeCandidate(),
    );

    expect(result.decision).toBe("PROMOTE");
    expect(result.reasons.some((r) => r.rule === "SCORE_THRESHOLD_MET")).toBe(true);
  });

  it("returns DEFER when below threshold", () => {
    const result = evaluateEligibility(
      makeComponents(),
      49,
      makeCandidate(),
    );

    expect(result.decision).toBe("DEFER");
    expect(result.reasons.some((r) => r.rule === "BELOW_THRESHOLD")).toBe(true);
  });
});

// ── §5 Rule Priority ────────────────────────────────────────────────────────

describe("§5 — Rule priority: expired > insufficient > risk > threshold", () => {
  it("expired takes precedence over insufficient evidence", () => {
    const expired = new Date(Date.now() - 1000);
    const result = evaluateEligibility(
      makeComponents({ evidenceScore: 10 }),
      80,
      makeCandidate({ expiresAt: expired }),
    );

    expect(result.decision).toBe("DEFER");
    // Both reasons present
    expect(result.reasons.some((r) => r.rule === "EVIDENCE_EXPIRED")).toBe(true);
    expect(result.reasons.some((r) => r.rule === "INSUFFICIENT_EVIDENCE")).toBe(true);
  });

  it("risk REJECT takes precedence over score PROMOTE", () => {
    // High score but excessive risk → first terminal rule wins (REJECT from risk)
    // BUT: risk is checked at rule 3, if no prior terminal decision
    const result = evaluateEligibility(
      makeComponents({ riskScore: 95 }),
      80,
      makeCandidate(),
    );

    expect(result.decision).toBe("REJECT");
  });
});

// ── §6 Custom Config ────────────────────────────────────────────────────────

describe("§6 — Custom eligibility config", () => {
  it("respects custom thresholds", () => {
    const strictConfig: EligibilityConfig = {
      minEvidenceScore: 60,
      maxRiskScore: 50,
      promotionThreshold: 80,
    };

    // Would pass default but fails strict
    const result = evaluateEligibility(
      makeComponents({ evidenceScore: 50 }),
      70,
      makeCandidate(),
      strictConfig,
    );

    expect(result.decision).toBe("DEFER");
    expect(result.reasons.some((r) => r.rule === "INSUFFICIENT_EVIDENCE")).toBe(true);
  });
});

// ── §7 All Reasons Captured ─────────────────────────────────────────────────

describe("§7 — Decision reasons are always populated", () => {
  it("PROMOTE includes reason", () => {
    const result = evaluateEligibility(makeComponents(), 80, makeCandidate());
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.every((r) => r.rule && r.details)).toBe(true);
  });

  it("DEFER includes reason", () => {
    const result = evaluateEligibility(makeComponents(), 30, makeCandidate());
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("REJECT includes reason", () => {
    const result = evaluateEligibility(
      makeComponents({ riskScore: 95 }),
      80,
      makeCandidate(),
    );
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
