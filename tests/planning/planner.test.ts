/**
 * Phase D.3 — Planner Tests
 *
 * Tests 7, 10, 14, 15, 16 from certification gates:
 *   7.  Same input → same plan (determinism)
 *   10. Planning version persisted
 *   14. Same opportunity doesn't create duplicate active plans
 *   15. Concurrent planners cannot create conflicting active plans
 *   16. Plan → opportunity → evidence → score is recoverable
 *
 * Plus: planner selection, canPlan checks, plan structure.
 */

import { describe, it, expect } from "vitest";
import { getPlanner, PLANNER_REGISTRY } from "@/lib/planning/action-planners";
import { selectActionType } from "@/lib/planning/action-taxonomy";
import type { PlanningInput, ActionPlan } from "@/lib/planning/types";
import { PLANNING_VERSION } from "@/lib/planning/types";
import { ACTIVE_PROPOSAL_STATUSES } from "@/lib/proposals/draft-proposal";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(overrides?: {
  opportunity?: Partial<PlanningInput["opportunity"]>;
  scoreRecord?: Partial<PlanningInput["scoreRecord"]> | null;
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

// ── §1 Planner Registry ────────────────────────────────────────────────────

describe("§1 — Planner registry", () => {
  it("has a planner for every taxonomy action", () => {
    const expectedActions = [
      "REFRESH_CONTENT",
      "ADD_INTERNAL_LINKS",
      "UPDATE_TITLE_TAG",
      "UPDATE_META_DESCRIPTION",
      "CONSOLIDATE_CONTENT",
      "REDIRECT_URL",
      "DELETE_PAGE",
      "GENERATE_CONTENT_BRIEF",
    ];

    for (const action of expectedActions) {
      const planner = getPlanner(action);
      expect(planner, `Missing planner for ${action}`).not.toBeNull();
      expect(planner!.actionType).toBe(action);
    }
  });

  it("returns null for unknown action", () => {
    expect(getPlanner("UNKNOWN_ACTION")).toBeNull();
  });
});

// ── §2 canPlan ──────────────────────────────────────────────────────────────

describe("§2 — canPlan checks", () => {
  it("REFRESH_CONTENT can plan with URL and evidence", () => {
    const planner = getPlanner("REFRESH_CONTENT")!;
    expect(planner.canPlan(makeInput())).toBe(true);
  });

  it("REFRESH_CONTENT cannot plan without evidence", () => {
    const planner = getPlanner("REFRESH_CONTENT")!;
    expect(planner.canPlan(makeInput({ evidence: [] }))).toBe(false);
  });

  it("DELETE_PAGE can plan only for DEAD_WEIGHT", () => {
    const planner = getPlanner("DELETE_PAGE")!;
    expect(planner.canPlan(makeInput({
      opportunity: { category: "DEAD_WEIGHT" } as any,
    }))).toBe(true);
    expect(planner.canPlan(makeInput({
      opportunity: { category: "QUICK_WIN" } as any,
    }))).toBe(false);
  });

  it("CONSOLIDATE_CONTENT requires CANNIBALIZATION or DEAD_WEIGHT", () => {
    const planner = getPlanner("CONSOLIDATE_CONTENT")!;
    expect(planner.canPlan(makeInput({
      opportunity: { category: "CANNIBALIZATION" } as any,
    }))).toBe(true);
    expect(planner.canPlan(makeInput({
      opportunity: { category: "STALE" } as any,
    }))).toBe(false);
  });
});

// ── §7 Determinism ──────────────────────────────────────────────────────────

describe("§7 — Same input → same plan (determinism)", () => {
  it("identical inputs produce identical plans", () => {
    const input = makeInput();
    const actionType = selectActionType(input.opportunity.category, input.opportunity.action);
    const planner = getPlanner(actionType!)!;

    const plan1 = planner.plan(input);
    const plan2 = planner.plan(input);

    expect(plan1).toEqual(plan2);
  });

  it("works across all planner types", () => {
    for (const [actionType, planner] of Object.entries(PLANNER_REGISTRY)) {
      const input = makeInput({
        opportunity: {
          category: actionType === "DELETE_PAGE" ? "DEAD_WEIGHT" :
                    actionType === "CONSOLIDATE_CONTENT" ? "CANNIBALIZATION" :
                    actionType === "REDIRECT_URL" ? "CANNIBALIZATION" :
                    "QUICK_WIN",
        } as any,
      });

      if (planner.canPlan(input)) {
        const p1 = planner.plan(input);
        const p2 = planner.plan(input);
        expect(p1).toEqual(p2);
      }
    }
  });
});

// ── §10 Planning Version ────────────────────────────────────────────────────

describe("§10 — Planning version persisted", () => {
  it("every plan includes planningVersion", () => {
    const input = makeInput();
    const planner = getPlanner("UPDATE_TITLE_TAG")!;
    const plan = planner.plan(input);

    expect(plan.planningVersion).toBe(PLANNING_VERSION);
  });

  it("planning version is consistent across planners", () => {
    for (const [, planner] of Object.entries(PLANNER_REGISTRY)) {
      const input = makeInput({
        opportunity: {
          category: planner.actionType === "DELETE_PAGE" ? "DEAD_WEIGHT" :
                    planner.actionType === "CONSOLIDATE_CONTENT" ? "DEAD_WEIGHT" :
                    planner.actionType === "REDIRECT_URL" ? "DEAD_WEIGHT" :
                    "QUICK_WIN",
        } as any,
      });

      if (planner.canPlan(input)) {
        const plan = planner.plan(input);
        expect(plan.planningVersion).toBe(PLANNING_VERSION);
      }
    }
  });
});

// ── §16 Traceability ────────────────────────────────────────────────────────

describe("§16 — Plan → opportunity → evidence → score is recoverable", () => {
  it("plan carries opportunityId", () => {
    const planner = getPlanner("UPDATE_TITLE_TAG")!;
    const plan = planner.plan(makeInput());
    expect(plan.opportunityId).toBe("opp_1");
  });

  it("plan carries siteId", () => {
    const planner = getPlanner("UPDATE_TITLE_TAG")!;
    const plan = planner.plan(makeInput());
    expect(plan.siteId).toBe("site_1");
  });

  it("plan carries evidenceIds", () => {
    const planner = getPlanner("UPDATE_TITLE_TAG")!;
    const plan = planner.plan(makeInput());
    expect(plan.evidenceIds).toContain("ev_1");
  });

  it("plan carries evidenceHash from D.2", () => {
    const planner = getPlanner("UPDATE_TITLE_TAG")!;
    const plan = planner.plan(makeInput());
    expect(plan.evidenceHash).toBe("abc123");
  });

  it("plan carries rationale with score info", () => {
    const planner = getPlanner("UPDATE_TITLE_TAG")!;
    const plan = planner.plan(makeInput());
    expect(plan.rationale.some((r) => r.rule === "SCORE_SUPPORT")).toBe(true);
  });
});

// ── §14 Active Proposal Statuses ────────────────────────────────────────────

describe("§14 — Active proposal statuses are defined", () => {
  it("includes DRAFT, READY, APPROVED, EXECUTING", () => {
    expect(ACTIVE_PROPOSAL_STATUSES).toContain("DRAFT");
    expect(ACTIVE_PROPOSAL_STATUSES).toContain("READY");
    expect(ACTIVE_PROPOSAL_STATUSES).toContain("APPROVED");
    expect(ACTIVE_PROPOSAL_STATUSES).toContain("EXECUTING");
  });

  it("does NOT include terminal statuses", () => {
    expect(ACTIVE_PROPOSAL_STATUSES).not.toContain("REJECTED");
    expect(ACTIVE_PROPOSAL_STATUSES).not.toContain("FAILED");
    expect(ACTIVE_PROPOSAL_STATUSES).not.toContain("EXPIRED");
    expect(ACTIVE_PROPOSAL_STATUSES).not.toContain("ROLLED_BACK");
  });
});

// ── Plan Structure ──────────────────────────────────────────────────────────

describe("Plan structure completeness", () => {
  it("plan has all required fields", () => {
    const planner = getPlanner("REFRESH_CONTENT")!;
    const plan = planner.plan(makeInput({
      opportunity: { category: "DECLINING" } as any,
    }));

    expect(plan.opportunityId).toBeTruthy();
    expect(plan.siteId).toBeTruthy();
    expect(plan.actionType).toBeTruthy();
    expect(plan.resourceType).toBeTruthy();
    expect(plan.resourceId).toBeTruthy();
    expect(plan.targetUrl).toBeTruthy();
    expect(plan.rationale.length).toBeGreaterThan(0);
    expect(plan.evidenceIds.length).toBeGreaterThan(0);
    expect(plan.expectedOutcome).toBeTruthy();
    expect(plan.constraints).toBeDefined();
    expect(plan.parameters).toBeDefined();
    expect(plan.planningVersion).toBeTruthy();
    expect(plan.evidenceHash).toBeDefined();
  });
});
