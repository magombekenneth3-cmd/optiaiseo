/**
 * Phase D.1 — Source-Specific Freshness Policies
 *
 * Each discovery source has its own TTL, evidence age limit, and refresh interval.
 * GrowthDecision.expiresAt is an AGGREGATE SUMMARY — the minimum expiry across
 * all contributing evidence sources. The authoritative per-evidence freshness
 * lives in FindingEvidence.observedAt.
 *
 * INVARIANT: maxEvidenceAgeDays <= ttlDays for every source.
 * If maxEvidenceAgeDays > ttlDays, a signal could pass validation but produce
 * an already-expired candidate (observedAt + ttlDays < now). The
 * wouldCreateExpiredCandidate() guard catches this at runtime as a safety net.
 */

import type { DiscoverySource, FreshnessPolicy, DiscoveryEvidence } from "./types";

// ── Freshness Policies ──────────────────────────────────────────────────────

export const FRESHNESS_POLICIES: Record<DiscoverySource, FreshnessPolicy> = {
  GSC:         { ttlDays: 14, maxEvidenceAgeDays: 14, refreshIntervalDays: 7 },
  CRAWL:       { ttlDays: 30, maxEvidenceAgeDays: 30, refreshIntervalDays: 14 },
  AUDIT:       { ttlDays: 30, maxEvidenceAgeDays: 30, refreshIntervalDays: 14 },
  COMPETITOR:  { ttlDays: 7,  maxEvidenceAgeDays: 7,  refreshIntervalDays: 3 },
  CONTENT:     { ttlDays: 30, maxEvidenceAgeDays: 30, refreshIntervalDays: 14 },
  PERFORMANCE: { ttlDays: 7,  maxEvidenceAgeDays: 7,  refreshIntervalDays: 3 },
};

// ── Public API ──────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns the maximum evidence age in days for a given source.
 */
export function getMaxEvidenceAge(source: DiscoverySource): number {
  return FRESHNESS_POLICIES[source].maxEvidenceAgeDays;
}

/**
 * Checks whether a single evidence item is fresh enough for its source.
 */
export function isEvidenceFresh(
  evidence: DiscoveryEvidence,
  source: DiscoverySource,
  now: Date = new Date()
): boolean {
  const maxAgeDays = getMaxEvidenceAge(source);
  const ageMs = now.getTime() - evidence.observedAt.getTime();
  return ageMs <= maxAgeDays * MS_PER_DAY;
}

/**
 * Computes the aggregate expiry date for an opportunity based on its
 * contributing evidence sources. Returns the EARLIEST expiry.
 *
 * GrowthDecision.expiresAt should be set to this value.
 */
export function computeAggregateExpiry(
  sources: Array<{ source: DiscoverySource; observedAt: Date }>
): Date {
  if (sources.length === 0) {
    return new Date(); // Expired immediately if no evidence
  }

  let earliestExpiry = Infinity;

  for (const { source, observedAt } of sources) {
    const policy = FRESHNESS_POLICIES[source];
    const expiryMs = observedAt.getTime() + policy.ttlDays * MS_PER_DAY;
    if (expiryMs < earliestExpiry) {
      earliestExpiry = expiryMs;
    }
  }

  return new Date(earliestExpiry);
}

/**
 * Checks whether an existing opportunity should be refreshed for a given source.
 * Returns true if the source's refresh interval has elapsed since lastRefreshedAt.
 */
export function shouldRefreshSource(
  source: DiscoverySource,
  lastRefreshedAt: Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (!lastRefreshedAt) return true; // Never refreshed — always refresh

  const policy = FRESHNESS_POLICIES[source];
  const ageMs = now.getTime() - lastRefreshedAt.getTime();
  return ageMs >= policy.refreshIntervalDays * MS_PER_DAY;
}

/**
 * Computes the expiry date for a single source observation.
 */
export function getSourceExpiry(source: DiscoverySource, observedAt: Date): Date {
  const policy = FRESHNESS_POLICIES[source];
  return new Date(observedAt.getTime() + policy.ttlDays * MS_PER_DAY);
}

/**
 * Safety guard: returns true if ALL evidence items would produce an
 * already-expired candidate (observedAt + TTL < now).
 *
 * This catches the case where maxEvidenceAgeDays accidentally exceeds ttlDays,
 * or where evidence is right at the boundary.
 */
export function wouldCreateExpiredCandidate(
  evidenceItems: DiscoveryEvidence[],
  source: DiscoverySource,
  now: Date = new Date()
): boolean {
  if (evidenceItems.length === 0) return true;

  const policy = FRESHNESS_POLICIES[source];

  // Check if ANY evidence item would produce a non-expired candidate
  for (const evidence of evidenceItems) {
    const expiryMs = evidence.observedAt.getTime() + policy.ttlDays * MS_PER_DAY;
    if (expiryMs > now.getTime()) {
      return false; // At least one evidence produces a valid expiry
    }
  }

  return true; // All evidence produces already-expired candidates
}
