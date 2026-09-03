/**
 * Phase D.3 — Planning Evidence Fence Tests
 *
 * Test 8: Changed evidence invalidates plan
 */

import { describe, it, expect } from "vitest";
import { verifyPlanningEvidenceFence } from "@/lib/planning/planning-fence";
import type { PlanningInput } from "@/lib/planning/types";
import { hashScoringEvidence } from "@/lib/scoring/evidence-fencing";
import type { ScoringInput } from "@/lib/scoring/types";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(overrides?: Partial<PlanningInput>): PlanningInput {
  return {
    opportunity: {
      id: "opp_1",
      siteId: "site_1",
      url: "/blog/test",
      primaryKeyword: "test keyword",
      category: "QUICK_WIN",
      action: "OPTIMIZE_TITLE",
      opportunityStatus: "OPEN",
      expiresAt: new Date("2025-01-15T00:00:00Z"),
      discoveryConfidence: 0.8,
      ...(overrides?.opportunity as any),
    },
    scoreRecord: {
      id: "score_1",
      finalScore: 75,
      decision: "PROMOTE",
      evidenceHash: "will-be-computed",
      scoringVersion: "d2-v1",
      impactScore: 60,
      confidenceScore: 55,
      urgencyScore: 45,
      ...(overrides?.scoreRecord as any),
    },
    evidence: overrides?.evidence ?? [
      {
        id: "ev_1",
        sourceType: "GSC",
        metric: "position",
        value: "8.5",
        observedAt: new Date("2025-01-01T12:00:00Z"),
      },
    ],
    site: {
      id: "site_1",
      domain: "example.com",
      ...(overrides?.site as any),
    },
    ...overrides,
  };
}

function computeExpectedHash(input: PlanningInput): string {
  const scoringInput: ScoringInput = {
    opportunityId: input.opportunity.id,
    siteId: input.opportunity.siteId,
    url: input.opportunity.url,
    primaryKeyword: input.opportunity.primaryKeyword,
    category: input.opportunity.category,
    action: input.opportunity.action,
    discoveryConfidence: input.opportunity.discoveryConfidence,
    expiresAt: input.opportunity.expiresAt,
    lastRefreshedAt: null,
    primaryDiscoverySource: "GSC",
    evidenceItems: input.evidence.map((e) => ({
      sourceType: e.sourceType,
      metric: e.metric,
      value: e.value,
      observedAt: e.observedAt,
    })),
    existingScore: null,
    metadata: {},
  };
  return hashScoringEvidence(scoringInput);
}

// ── §1 — Valid evidence fence ───────────────────────────────────────────────

describe("§1 — Evidence fence passes when evidence unchanged", () => {
  it("returns valid when hashes match", () => {
    const input = makeInput();
    const expectedHash = computeExpectedHash(input);

    const result = verifyPlanningEvidenceFence(input, expectedHash);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.currentHash).toBe(expectedHash);
  });
});

// ── §2 — Invalid evidence fence ─────────────────────────────────────────────

describe("§2 — Evidence fence fails when evidence changed", () => {
  it("returns invalid when hashes differ", () => {
    const input = makeInput();
    const staleHash = "0000000000000000000000000000000000000000000000000000000000000000";

    const result = verifyPlanningEvidenceFence(input, staleHash);

    expect(result.valid).toBe(false);
    expect(result.reason).not.toBeNull();
    expect(result.reason!.rule).toBe("EVIDENCE_CHANGED");
  });

  it("detects evidence item changes", () => {
    const originalInput = makeInput();
    const originalHash = computeExpectedHash(originalInput);

    // Change evidence
    const modifiedInput = makeInput({
      evidence: [{
        id: "ev_2",
        sourceType: "AUDIT",
        metric: "finding",
        value: "different",
        observedAt: new Date("2025-01-02T00:00:00Z"),
      }],
    });

    const result = verifyPlanningEvidenceFence(modifiedInput, originalHash);

    expect(result.valid).toBe(false);
    expect(result.reason!.rule).toBe("EVIDENCE_CHANGED");
  });

  it("detects confidence changes", () => {
    const originalInput = makeInput();
    const originalHash = computeExpectedHash(originalInput);

    const modifiedInput = makeInput({
      opportunity: { discoveryConfidence: 0.99 } as any,
    });

    const result = verifyPlanningEvidenceFence(modifiedInput, originalHash);
    expect(result.valid).toBe(false);
  });
});

// ── §3 — Fence result structure ─────────────────────────────────────────────

describe("§3 — Fence result always contains both hashes", () => {
  it("valid result contains matching hashes", () => {
    const input = makeInput();
    const expectedHash = computeExpectedHash(input);
    const result = verifyPlanningEvidenceFence(input, expectedHash);

    expect(result.currentHash).toBe(expectedHash);
    expect(result.expectedHash).toBe(expectedHash);
  });

  it("invalid result contains both hashes for debugging", () => {
    const input = makeInput();
    const result = verifyPlanningEvidenceFence(input, "wrong-hash");

    expect(result.currentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.expectedHash).toBe("wrong-hash");
  });
});
