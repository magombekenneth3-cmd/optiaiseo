/**
 * Phase D.3 — Action Taxonomy Tests
 *
 * Test 4: Action must be allowed for category
 * Plus: taxonomy completeness, preference ordering, no invented types.
 */

import { describe, it, expect } from "vitest";
import {
  CATEGORY_ACTION_MAP,
  GROWTH_ACTION_MAP,
  getPreferredAction,
  getAllowedActions,
  isActionAllowedForCategory,
  resolveActionType,
  selectActionType,
} from "@/lib/planning/action-taxonomy";
import { SAFETY_TIER_MAP } from "@/lib/proposals/types";
import type { OpportunityCategory } from "@/lib/opportunity-engine/types";

const ALL_CATEGORIES: OpportunityCategory[] = [
  "DECLINING", "QUICK_WIN", "ALMOST_RANKING", "STALE",
  "CANNIBALIZATION", "ORPHANED", "DEAD_WEIGHT",
];

// ── §1 Taxonomy Completeness ────────────────────────────────────────────────

describe("§1 — Every category has at least one allowed action", () => {
  it.each(ALL_CATEGORIES)("%s has allowed actions", (category) => {
    const actions = getAllowedActions(category);
    expect(actions.length).toBeGreaterThan(0);
  });
});

// ── §2 No Invented Action Types ─────────────────────────────────────────────

describe("§2 — Every taxonomy action maps to Phase B ActionType", () => {
  it("all CATEGORY_ACTION_MAP values exist in SAFETY_TIER_MAP", () => {
    for (const [category, actions] of Object.entries(CATEGORY_ACTION_MAP)) {
      for (const action of actions) {
        expect(
          SAFETY_TIER_MAP[action],
          `Action ${action} in ${category} is not a valid Phase B ActionType`
        ).toBeDefined();
      }
    }
  });

  it("all GROWTH_ACTION_MAP values exist in SAFETY_TIER_MAP", () => {
    for (const [growth, action] of Object.entries(GROWTH_ACTION_MAP)) {
      expect(
        SAFETY_TIER_MAP[action],
        `Growth action ${growth} maps to unknown ActionType ${action}`
      ).toBeDefined();
    }
  });
});

// ── §3 Preference Ordering ──────────────────────────────────────────────────

describe("§3 — Preferred action is lowest risk", () => {
  it("DECLINING prefers REFRESH_CONTENT (Tier 2) over higher-risk options", () => {
    expect(getPreferredAction("DECLINING")).toBe("REFRESH_CONTENT");
  });

  it("QUICK_WIN prefers UPDATE_TITLE_TAG (Tier 1)", () => {
    expect(getPreferredAction("QUICK_WIN")).toBe("UPDATE_TITLE_TAG");
  });

  it("DEAD_WEIGHT prefers CONSOLIDATE_CONTENT over DELETE_PAGE", () => {
    const actions = getAllowedActions("DEAD_WEIGHT");
    const consolidateIdx = actions.indexOf("CONSOLIDATE_CONTENT");
    const deleteIdx = actions.indexOf("DELETE_PAGE");
    expect(consolidateIdx).toBeLessThan(deleteIdx);
  });
});

// ── §4 Action Allowed for Category ──────────────────────────────────────────

describe("§4 — isActionAllowedForCategory", () => {
  it("REFRESH_CONTENT is allowed for DECLINING", () => {
    expect(isActionAllowedForCategory("REFRESH_CONTENT", "DECLINING")).toBe(true);
  });

  it("DELETE_PAGE is NOT allowed for QUICK_WIN", () => {
    expect(isActionAllowedForCategory("DELETE_PAGE", "QUICK_WIN")).toBe(false);
  });

  it("ADD_INTERNAL_LINKS is allowed for ORPHANED", () => {
    expect(isActionAllowedForCategory("ADD_INTERNAL_LINKS", "ORPHANED")).toBe(true);
  });

  it("CONSOLIDATE_CONTENT is NOT allowed for STALE", () => {
    expect(isActionAllowedForCategory("CONSOLIDATE_CONTENT", "STALE")).toBe(false);
  });

  it("unknown category returns false", () => {
    expect(isActionAllowedForCategory("REFRESH_CONTENT", "UNKNOWN_CAT")).toBe(false);
  });
});

// ── §5 selectActionType ─────────────────────────────────────────────────────

describe("§5 — selectActionType (deterministic, no fallthrough)", () => {
  it("uses growth action when allowed for category", () => {
    const result = selectActionType("DECLINING", "REFRESH_CONTENT");
    expect(result).toBe("REFRESH_CONTENT");
  });

  it("uses growth action mapping (BUILD_INTERNAL_LINKS → ADD_INTERNAL_LINKS)", () => {
    const result = selectActionType("ORPHANED", "BUILD_INTERNAL_LINKS");
    expect(result).toBe("ADD_INTERNAL_LINKS");
  });

  it("falls back to preferred when growth action not allowed", () => {
    // OPTIMIZE_TITLE maps to UPDATE_TITLE_TAG, but DECLINING doesn't allow it
    const result = selectActionType("DECLINING", "OPTIMIZE_TITLE");
    expect(result).toBe("REFRESH_CONTENT"); // preferred for DECLINING
  });

  it("returns null for unknown category", () => {
    const result = selectActionType("UNKNOWN", "UNKNOWN");
    expect(result).toBeNull();
  });

  it("same inputs always produce same output (determinism)", () => {
    const r1 = selectActionType("QUICK_WIN", "OPTIMIZE_TITLE");
    const r2 = selectActionType("QUICK_WIN", "OPTIMIZE_TITLE");
    expect(r1).toBe(r2);
  });
});

// ── §6 resolveActionType ────────────────────────────────────────────────────

describe("§6 — resolveActionType", () => {
  it("maps known growth actions", () => {
    expect(resolveActionType("REFRESH_CONTENT")).toBe("REFRESH_CONTENT");
    expect(resolveActionType("BUILD_INTERNAL_LINKS")).toBe("ADD_INTERNAL_LINKS");
    expect(resolveActionType("DEINDEX_OR_REDIRECT")).toBe("REDIRECT_URL");
  });

  it("returns null for unknown growth action", () => {
    expect(resolveActionType("UNKNOWN_ACTION")).toBeNull();
  });
});
