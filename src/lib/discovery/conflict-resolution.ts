/**
 * Phase D.1 — Deterministic Action Conflict Resolution
 *
 * When multiple sources produce signals with the same fingerprint but suggest
 * different actions, this module resolves the conflict deterministically.
 *
 * CONFLICT RESOLUTION RULE:
 *   1. Merge all evidence from all contributing sources
 *   2. Select the canonical category via CATEGORY_PRIORITY (not confidence)
 *   3. Map category → action via CATEGORY_TO_ACTION
 *   4. confidence = max across sources (strongest observation of existence)
 *   5. Retain all source run IDs for provenance
 *
 * The highest-confidence source does NOT dictate the action.
 * Category priority is based on SEO strategic importance, defined deterministically.
 */

import type {
  RawDiscoverySignal,
  ResolvedSignal,
  DiscoveryEvidence,
  DiscoverySource,
  OpportunityCategory,
  GrowthAction,
} from "./types";

// ── Category Priority ───────────────────────────────────────────────────────

/**
 * Ordered by SEO strategic importance — higher index = lower priority.
 * When signals disagree on category, the highest-priority category wins.
 */
export const CATEGORY_PRIORITY: readonly OpportunityCategory[] = [
  "DECLINING",        // Active traffic loss — highest urgency
  "CANNIBALIZATION",  // Competing pages — structural issue
  "QUICK_WIN",        // High-impression striking distance
  "ALMOST_RANKING",   // Page-2 opportunity
  "ORPHANED",         // Structural linking issue
  "STALE",            // Content freshness
  "DEAD_WEIGHT",      // Cleanup — lowest urgency
] as const;

/**
 * Deterministic category → action mapping.
 * Each category has exactly one canonical action.
 */
export const CATEGORY_TO_ACTION: Record<OpportunityCategory, GrowthAction> = {
  DECLINING:       "REFRESH_CONTENT",
  CANNIBALIZATION: "CONSOLIDATE_CONTENT",
  QUICK_WIN:       "OPTIMIZE_TITLE",
  ALMOST_RANKING:  "IMPROVE_SEARCH_INTENT",
  ORPHANED:        "BUILD_INTERNAL_LINKS",
  STALE:           "REFRESH_CONTENT",
  DEAD_WEIGHT:     "DEINDEX_OR_REDIRECT",
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolves conflicts among signals that share the same fingerprint.
 *
 * Pre-condition: all signals in the group have the same fingerprint.
 * If the array has a single signal, it's returned as-is (no conflict).
 */
export function resolveConflict(signals: RawDiscoverySignal[]): ResolvedSignal {
  if (signals.length === 0) {
    throw new Error("[ConflictResolution] Cannot resolve empty signal group");
  }

  // Use the first signal for shared identity fields
  const representative = signals[0];

  // 1. Merge all evidence from all sources
  const mergedEvidence: DiscoveryEvidence[] = [];
  for (const signal of signals) {
    mergedEvidence.push(...signal.evidence);
  }

  // 2. Collect all categories present
  const categoriesPresent = new Set(signals.map((s) => s.category));

  // 3. Select highest-priority category
  let category = representative.category;
  for (const cat of CATEGORY_PRIORITY) {
    if (categoriesPresent.has(cat)) {
      category = cat;
      break;
    }
  }

  // 4. Map category → canonical action
  const action = CATEGORY_TO_ACTION[category];

  // 5. Confidence = max across all sources
  const confidence = Math.max(...signals.map((s) => s.confidence));

  // 6. Collect all contributing sources and run IDs
  const contributingSources = [...new Set(signals.map((s) => s.source))] as DiscoverySource[];
  const sourceRunIds = [...new Set(signals.map((s) => s.sourceRunId))];

  // 7. Merge metadata
  const mergedMetadata: Record<string, unknown> = {};
  for (const signal of signals) {
    if (signal.metadata) {
      Object.assign(mergedMetadata, signal.metadata);
    }
  }

  return {
    fingerprint: representative.fingerprint,
    siteId: representative.siteId,
    category,
    action,
    resourceType: representative.resourceType,
    resourceId: representative.resourceId,
    url: representative.url,
    keyword: representative.keyword,
    confidence,
    mergedEvidence,
    contributingSources,
    sourceRunIds,
    metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
  };
}

/**
 * Groups signals by fingerprint and resolves each group.
 */
export function resolveAllConflicts(signals: RawDiscoverySignal[]): ResolvedSignal[] {
  const groups = new Map<string, RawDiscoverySignal[]>();

  for (const signal of signals) {
    const existing = groups.get(signal.fingerprint) ?? [];
    existing.push(signal);
    groups.set(signal.fingerprint, existing);
  }

  return Array.from(groups.values()).map(resolveConflict);
}
