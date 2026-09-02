/**
 * Phase D.1 — Discovery Deduplicator
 *
 * Deduplicates raw discovery signals by fingerprint and checks existing
 * GrowthDecision records to avoid redundant candidate creation.
 *
 * Flow:
 *   signals[] → group by fingerprint → conflict resolution → check DB → output
 *
 * An existing opportunity is skipped if:
 *   - Status is CANDIDATE or OPEN
 *   - Not expired (expiresAt > now)
 *   - Does NOT need source refresh
 *
 * An existing opportunity is REFRESHED if:
 *   - Status is CANDIDATE or OPEN
 *   - Needs evidence refresh (lastRefreshedAt > refreshInterval)
 *
 * A NEW candidate is created if:
 *   - No existing opportunity with this fingerprint
 *   - Or existing is COMPLETED/VERIFIED/EXPIRED
 */

import type { RawDiscoverySignal, ResolvedSignal, DiscoverySource } from "./types";
import { resolveAllConflicts } from "./conflict-resolution";
import { shouldRefreshSource } from "./freshness";
import { prisma } from "@/lib/prisma";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DeduplicationResult {
  /** New candidates to create (no existing opportunity) */
  toCreate: ResolvedSignal[];
  /** Existing opportunities to refresh with new evidence */
  toRefresh: Array<{ signal: ResolvedSignal; existingId: string; existingStatus: string }>;
  /** Skipped because a fresh CANDIDATE/OPEN already exists */
  skipped: Array<{ fingerprint: string; existingId: string; reason: string }>;
}

// ── Statuses that block new candidate creation ──────────────────────────────

const ACTIVE_STATUSES = new Set(["CANDIDATE", "OPEN", "PROPOSED", "APPROVED", "EXECUTING", "VERIFYING"]);

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Deduplicates signals and checks against existing GrowthDecision records.
 *
 * Steps:
 *   1. Conflict-resolve signals (group by fingerprint, merge evidence)
 *   2. For each resolved signal, check if an existing opportunity exists
 *   3. Classify as toCreate / toRefresh / skipped
 */
export async function deduplicateSignals(
  signals: RawDiscoverySignal[],
  source: DiscoverySource,
  now: Date = new Date()
): Promise<DeduplicationResult> {
  // 1. Conflict resolution (groups by fingerprint, merges evidence)
  const resolved = resolveAllConflicts(signals);

  const toCreate: ResolvedSignal[] = [];
  const toRefresh: Array<{ signal: ResolvedSignal; existingId: string; existingStatus: string }> = [];
  const skipped: Array<{ fingerprint: string; existingId: string; reason: string }> = [];

  // 2. Check each resolved signal against DB
  for (const signal of resolved) {
    const existing = await checkExistingOpportunity(signal.fingerprint);

    if (!existing) {
      // No existing — create new candidate
      toCreate.push(signal);
      continue;
    }

    // Existing opportunity found
    if (!ACTIVE_STATUSES.has(existing.status)) {
      // Completed/verified — allow re-discovery
      toCreate.push(signal);
      continue;
    }

    // Active opportunity — check if it needs refresh
    if (shouldRefreshSource(source, existing.lastRefreshedAt, now)) {
      toRefresh.push({
        signal,
        existingId: existing.id,
        existingStatus: existing.status,
      });
    } else {
      skipped.push({
        fingerprint: signal.fingerprint,
        existingId: existing.id,
        reason: `Fresh ${existing.status} opportunity already exists`,
      });
    }
  }

  return { toCreate, toRefresh, skipped };
}

/**
 * Looks up an existing GrowthDecision by fingerprint.
 */
export async function checkExistingOpportunity(
  fingerprint: string
): Promise<{
  id: string;
  status: string;
  lastRefreshedAt: Date | null;
  expiresAt: Date | null;
} | null> {
  try {
    const existing = await (prisma as any).growthDecision.findFirst({
      where: { fingerprint },
      orderBy: { generatedAt: "desc" },
      select: {
        id: true,
        opportunityStatus: true,
        lastRefreshedAt: true,
        expiresAt: true,
      },
    });

    if (!existing) return null;

    return {
      id: existing.id,
      status: existing.opportunityStatus,
      lastRefreshedAt: existing.lastRefreshedAt,
      expiresAt: existing.expiresAt,
    };
  } catch {
    // Graceful degradation — treat as no existing opportunity
    return null;
  }
}
