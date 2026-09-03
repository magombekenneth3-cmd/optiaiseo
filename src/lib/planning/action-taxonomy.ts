/**
 * Phase D.3 — Action Taxonomy
 *
 * Deterministic mapping: opportunity category → allowed action types.
 *
 * RULES:
 *   1. Every action type maps to an existing Phase B ActionType
 *   2. No invented action types
 *   3. Categories have a preferred (first) action and alternatives
 *   4. D.3 selects the PREFERRED action, does NOT fall through to alternatives
 *   5. Risk ordering is preserved (lower-risk actions are preferred)
 */

import type { ActionType } from "@/lib/proposals/types";
import type { OpportunityCategory } from "@/lib/opportunity-engine/types";

// ── Category → Allowed Actions ──────────────────────────────────────────────

/**
 * For each opportunity category, the allowed action types in preference order.
 * The first entry is the preferred/default action.
 *
 * Risk is ascending — the first action is the lowest-risk option.
 */
export const CATEGORY_ACTION_MAP: Record<OpportunityCategory, ActionType[]> = {
  DECLINING:        ["REFRESH_CONTENT", "ADD_INTERNAL_LINKS"],
  QUICK_WIN:        ["UPDATE_TITLE_TAG", "UPDATE_META_DESCRIPTION", "REFRESH_CONTENT"],
  ALMOST_RANKING:   ["REFRESH_CONTENT", "ADD_INTERNAL_LINKS"],
  STALE:            ["REFRESH_CONTENT"],
  CANNIBALIZATION:  ["CONSOLIDATE_CONTENT", "REDIRECT_URL"],
  ORPHANED:         ["ADD_INTERNAL_LINKS"],
  DEAD_WEIGHT:      ["CONSOLIDATE_CONTENT", "REDIRECT_URL", "DELETE_PAGE"],
};

// ── GrowthAction → ActionType Mapping ───────────────────────────────────────

/**
 * Maps GrowthAction (from opportunity engine) to Phase B ActionType.
 * Used when the opportunity already has a specific action assigned by D.1/D.2.
 */
export const GROWTH_ACTION_MAP: Record<string, ActionType> = {
  REFRESH_CONTENT:        "REFRESH_CONTENT",
  BUILD_INTERNAL_LINKS:   "ADD_INTERNAL_LINKS",
  CREATE_NEW_CONTENT:     "GENERATE_CONTENT_BRIEF",
  CONSOLIDATE_CONTENT:    "CONSOLIDATE_CONTENT",
  IMPROVE_SEARCH_INTENT:  "REFRESH_CONTENT",
  OPTIMIZE_TITLE:         "UPDATE_TITLE_TAG",
  OPTIMIZE_CONTENT_DEPTH: "REFRESH_CONTENT",
  DEINDEX_OR_REDIRECT:    "REDIRECT_URL",
  MONITOR:                "UPDATE_META_DESCRIPTION",
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the preferred action type for a given category.
 * Always returns the first (lowest-risk) allowed action.
 */
export function getPreferredAction(category: string): ActionType | null {
  const actions = CATEGORY_ACTION_MAP[category as OpportunityCategory];
  return actions?.[0] ?? null;
}

/**
 * Returns all allowed action types for a given category.
 */
export function getAllowedActions(category: string): ActionType[] {
  return CATEGORY_ACTION_MAP[category as OpportunityCategory] ?? [];
}

/**
 * Checks whether an action type is allowed for a given category.
 */
export function isActionAllowedForCategory(
  actionType: ActionType,
  category: string
): boolean {
  const allowed = CATEGORY_ACTION_MAP[category as OpportunityCategory];
  return allowed?.includes(actionType) ?? false;
}

/**
 * Maps a GrowthAction string to a Phase B ActionType.
 * Returns the mapped type, or null if no mapping exists.
 */
export function resolveActionType(growthAction: string): ActionType | null {
  return GROWTH_ACTION_MAP[growthAction] ?? null;
}

/**
 * Selects the best action type for an opportunity.
 *
 * Priority:
 *   1. If the opportunity's GrowthAction maps to an allowed action → use it
 *   2. Otherwise → use the preferred (first) action for the category
 *
 * Does NOT fall through to alternatives if the preferred action fails.
 */
export function selectActionType(
  category: string,
  growthAction: string
): ActionType | null {
  // 1. Try to use the opportunity's existing action
  const mapped = resolveActionType(growthAction);
  if (mapped && isActionAllowedForCategory(mapped, category)) {
    return mapped;
  }

  // 2. Fall back to preferred action for category
  return getPreferredAction(category);
}
