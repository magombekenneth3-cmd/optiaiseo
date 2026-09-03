/**
 * Phase D.4 — Evidence Re-fence Tests
 *
 * Tests 19-20: Evidence fence before/after LLM call
 */

import { describe, it, expect } from "vitest";
import { reVerifyEvidenceAfterLLM } from "@/lib/llm-boundary/evidence-refence";
import { hashScoringEvidence } from "@/lib/scoring/evidence-fencing";
import type { PlanningInput } from "@/lib/planning/types";

// ── Helper ──────────────────────────────────────────────────────────────────

function makePlanningInput(): PlanningInput {
  const now = new Date();
  return {
    opportunity: {
      id: "opp_1",
      siteId: "site_1",
      url: "/blog/test",
      primaryKeyword: "seo tools",
      category: "QUICK_WIN",
      action: "OPTIMIZE_CONTENT",
      opportunityStatus: "OPEN",
      expiresAt: new Date(now.getTime() + 86400000),
      discoveryConfidence: 0.9,
    },
    evidence: [
      {
        id: "ev_1",
        sourceType: "GSC",
        metric: "position",
        value: "8",
        observedAt: new Date(now.getTime() - 3600000),
      },
    ],
    scoreRecord: {
      id: "sr_1",
      finalScore: 75,
      decision: "PROMOTE",
      evidenceHash: "original-hash",
      scoringVersion: "d2-v1",
      impactScore: 80,
      confidenceScore: 70,
      urgencyScore: 60,
    },
    site: {
      id: "site_1",
      domain: "example.com",
    },
  };
}

// ── §19 — Evidence unchanged → proceed ──────────────────────────────────────

describe("§19 — Evidence unchanged during LLM call → proceed", () => {
  it("returns valid when evidence hash matches", () => {
    const input = makePlanningInput();
    // Compute the hash from the input, then verify against itself
    const currentHash = hashScoringEvidence({
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
    });

    const result = reVerifyEvidenceAfterLLM(input, currentHash);
    expect(result.valid).toBe(true);
    expect(result.reason).toContain("unchanged");
  });
});

// ── §20 — Evidence changed → DEFER ─────────────────────────────────────────

describe("§20 — Evidence changed during LLM call → DEFER", () => {
  it("returns invalid when evidence hash does NOT match", () => {
    const input = makePlanningInput();
    const staleHash = "stale-hash-from-before-llm-call";

    const result = reVerifyEvidenceAfterLLM(input, staleHash);
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});
