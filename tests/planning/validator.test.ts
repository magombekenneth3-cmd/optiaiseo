/**
 * Phase D.3 — Validator Tests
 *
 * Tests 1, 2, 3, 5, 6, 9 from certification gates:
 *   1.  CANDIDATE cannot be planned (OPEN-only)
 *   2.  Expired opportunity cannot be planned
 *   3.  Stale evidence cannot produce a plan
 *   5.  Target must belong to correct site
 *   6.  Invalid action parameters rejected
 *   9.  Plan requires valid PROMOTE score
 */

import { describe, it, expect } from "vitest";
import { validatePlanningInput, validatePlan } from "@/lib/planning/validator";
import type { PlanningInput, ActionPlan } from "@/lib/planning/types";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(overrides?: {
  opportunity?: Partial<PlanningInput["opportunity"]>;
  scoreRecord?: Partial<NonNullable<PlanningInput["scoreRecord"]>> | null;
  evidence?: PlanningInput["evidence"];
  site?: Partial<PlanningInput["site"]>;
}): PlanningInput {
  return {
    opportunity: {
      id: "opp_1",
      siteId: "site_1",
      url: "/blog/test",
      primaryKeyword: "test keyword",
      category: "QUICK_WIN",
      action: "OPTIMIZE_TITLE",
      opportunityStatus: "OPEN",
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      discoveryConfidence: 0.8,
      ...overrides?.opportunity,
    },
    scoreRecord: overrides?.scoreRecord === null ? null : {
      id: "score_1",
      finalScore: 75,
      decision: "PROMOTE",
      evidenceHash: "abc123",
      scoringVersion: "d2-v1",
      impactScore: 60,
      confidenceScore: 55,
      urgencyScore: 45,
      ...overrides?.scoreRecord,
    },
    evidence: overrides?.evidence ?? [
      {
        id: "ev_1",
        sourceType: "GSC",
        metric: "position",
        value: "8",
        observedAt: new Date(),
      },
    ],
    site: {
      id: "site_1",
      domain: "example.com",
      ...overrides?.site,
    },
  };
}

function makePlan(overrides?: Partial<ActionPlan>): ActionPlan {
  return {
    opportunityId: "opp_1",
    siteId: "site_1",
    actionType: "UPDATE_TITLE_TAG",
    resourceType: "PAGE",
    resourceId: "/blog/test",
    targetUrl: "/blog/test",
    rationale: [{ rule: "TEST", details: "test rationale" }],
    evidenceIds: ["ev_1"],
    expectedOutcome: "Improve ranking",
    constraints: { safetyTier: 1 },
    parameters: { primaryKeyword: "test keyword" },
    planningVersion: "d3-v1",
    evidenceHash: "abc123",
    ...overrides,
  };
}

// ── §1 OPEN-only ────────────────────────────────────────────────────────────

describe("§1 — CANDIDATE cannot be planned (OPEN-only)", () => {
  it("rejects CANDIDATE status", () => {
    const input = makeInput({
      opportunity: { opportunityStatus: "CANDIDATE" },
    });
    const result = validatePlanningInput(input);

    expect(result.valid).toBe(false);
    expect(result.decision).toBe("REJECT");
    expect(result.reasons.some((r) => r.rule === "NOT_OPEN")).toBe(true);
  });

  it("rejects PROPOSED status", () => {
    const input = makeInput({
      opportunity: { opportunityStatus: "PROPOSED" },
    });
    const result = validatePlanningInput(input);

    expect(result.valid).toBe(false);
    expect(result.decision).toBe("REJECT");
  });

  it("accepts OPEN status", () => {
    const result = validatePlanningInput(makeInput());
    expect(result.valid).toBe(true);
    expect(result.decision).toBe("PLAN");
  });
});

// ── §2 Expiry ───────────────────────────────────────────────────────────────

describe("§2 — Expired opportunity cannot be planned", () => {
  it("rejects expired opportunity", () => {
    const expired = new Date(Date.now() - 1000);
    const input = makeInput({
      opportunity: { expiresAt: expired },
    });
    const result = validatePlanningInput(input);

    expect(result.valid).toBe(false);
    expect(result.decision).toBe("REJECT");
    expect(result.reasons.some((r) => r.rule === "EXPIRED")).toBe(true);
  });

  it("accepts non-expired opportunity", () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const input = makeInput({
      opportunity: { expiresAt: future },
    });
    const result = validatePlanningInput(input);
    expect(result.valid).toBe(true);
  });

  it("accepts null expiresAt (no expiry)", () => {
    const input = makeInput({
      opportunity: { expiresAt: null },
    });
    const result = validatePlanningInput(input);
    expect(result.valid).toBe(true);
  });
});

// ── §3 Evidence ─────────────────────────────────────────────────────────────

describe("§3 — Stale evidence cannot produce a plan", () => {
  it("defers when no evidence", () => {
    const input = makeInput({ evidence: [] });
    const result = validatePlanningInput(input);

    expect(result.valid).toBe(false);
    expect(result.decision).toBe("DEFER");
    expect(result.reasons.some((r) => r.rule === "NO_EVIDENCE")).toBe(true);
  });

  it("accepts when evidence exists", () => {
    const result = validatePlanningInput(makeInput());
    expect(result.valid).toBe(true);
  });
});

// ── §4 Score Record ─────────────────────────────────────────────────────────

describe("§4 — Score record requirements", () => {
  it("defers when no score record", () => {
    const input = makeInput({ scoreRecord: null });
    const result = validatePlanningInput(input);

    expect(result.valid).toBe(false);
    expect(result.decision).toBe("DEFER");
    expect(result.reasons.some((r) => r.rule === "NO_SCORE_RECORD")).toBe(true);
  });
});

// ── §9 Score Fence ──────────────────────────────────────────────────────────

describe("§9 — Plan requires valid PROMOTE score", () => {
  it("defers when score decision is DEFER", () => {
    const input = makeInput({
      scoreRecord: { decision: "DEFER" },
    });
    const result = validatePlanningInput(input);

    expect(result.valid).toBe(false);
    expect(result.decision).toBe("DEFER");
    expect(result.reasons.some((r) => r.rule === "SCORE_NOT_PROMOTE")).toBe(true);
  });

  it("defers when score decision is REJECT", () => {
    const input = makeInput({
      scoreRecord: { decision: "REJECT" },
    });
    const result = validatePlanningInput(input);

    expect(result.valid).toBe(false);
    expect(result.decision).toBe("DEFER");
  });

  it("accepts when score decision is PROMOTE", () => {
    const result = validatePlanningInput(makeInput());
    expect(result.valid).toBe(true);
  });
});

// ── §5 Plan Validation — Site Mismatch ──────────────────────────────────────

describe("§5 — Target must belong to correct site", () => {
  it("rejects site mismatch", () => {
    const plan = makePlan({ siteId: "wrong_site" });
    const input = makeInput();
    const result = validatePlan(plan, input);

    expect(result.valid).toBe(false);
    expect(result.decision).toBe("REJECT");
    expect(result.reasons.some((r) => r.rule === "SITE_MISMATCH")).toBe(true);
  });

  it("accepts matching site", () => {
    const result = validatePlan(makePlan(), makeInput());
    expect(result.valid).toBe(true);
  });
});

// ── §6 Plan Validation — Parameters ────────────────────────────────────────

describe("§6 — Invalid action parameters rejected", () => {
  it("rejects empty parameters", () => {
    const plan = makePlan({ parameters: {} });
    const result = validatePlan(plan, makeInput());

    expect(result.valid).toBe(false);
    expect(result.decision).toBe("REJECT");
    expect(result.reasons.some((r) => r.rule === "MISSING_PARAMETERS")).toBe(true);
  });

  it("accepts valid parameters", () => {
    const result = validatePlan(makePlan(), makeInput());
    expect(result.valid).toBe(true);
  });
});

// ── §4 Plan Validation — Action/Category ────────────────────────────────────

describe("§4 — Action must be allowed for category", () => {
  it("rejects action not in category taxonomy", () => {
    const plan = makePlan({ actionType: "DELETE_PAGE" }); // Not allowed for QUICK_WIN
    const result = validatePlan(plan, makeInput());

    expect(result.valid).toBe(false);
    expect(result.decision).toBe("REJECT");
    expect(result.reasons.some((r) => r.rule === "ACTION_NOT_ALLOWED")).toBe(true);
  });
});

// ── §7 Plan Validation — Resource ───────────────────────────────────────────

describe("§7 — Target resource", () => {
  it("defers when no resource ID", () => {
    const plan = makePlan({ resourceId: "" });
    const result = validatePlan(plan, makeInput());

    expect(result.valid).toBe(false);
    expect(result.decision).toBe("DEFER");
    expect(result.reasons.some((r) => r.rule === "NO_TARGET_RESOURCE")).toBe(true);
  });
});

// ── §10 Plan Validation — Evidence Support ──────────────────────────────────

describe("§10 — Evidence support", () => {
  it("defers when no evidence IDs in plan", () => {
    const plan = makePlan({ evidenceIds: [] });
    const result = validatePlan(plan, makeInput());

    expect(result.valid).toBe(false);
    expect(result.decision).toBe("DEFER");
    expect(result.reasons.some((r) => r.rule === "NO_SUPPORTING_EVIDENCE")).toBe(true);
  });
});

// ── All Reasons Captured ────────────────────────────────────────────────────

describe("Validation reasons are always populated", () => {
  it("invalid input includes reasons", () => {
    const input = makeInput({
      opportunity: { opportunityStatus: "CANDIDATE" },
    });
    const result = validatePlanningInput(input);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.every((r) => r.rule && r.details)).toBe(true);
  });

  it("valid input has no reasons", () => {
    const result = validatePlanningInput(makeInput());
    expect(result.reasons.length).toBe(0);
  });
});
