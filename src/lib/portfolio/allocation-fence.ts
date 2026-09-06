/**
 * Phase D.7.4 — Allocation Fencing
 *
 * Validates that a SELECTED PortfolioAllocation is still actionable
 * before D.3 planning consumes it.
 *
 * CHECKS:
 *   1. Opportunity still OPEN
 *   2. Not expired
 *   3. Same scoreRecordId (D.2 score unchanged)
 *   4. Same evidenceHash (evidence unchanged)
 *   5. Same siteId
 *   6. Allocation not expired
 *   7. No active D.5 experiment conflict created after allocation
 *
 * If any check fails → allocation is STALE and must not be consumed.
 *
 * INVARIANTS:
 *   - Read-only: never modifies the allocation or opportunity
 *   - D.3 calls this before planning from a SELECTED allocation
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { AllocationFenceCheck } from "./types";
import { allocationConflictKey } from "./types";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Validates a SELECTED allocation before D.3 planning consumes it.
 *
 * Returns { valid: true } if the allocation is still actionable,
 * or { valid: false, reason: "..." } if any check fails.
 */
export async function validateAllocationFence(
  allocationId: string,
  now: Date = new Date()
): Promise<AllocationFenceCheck> {
  // ── Load allocation ───────────────────────────────────────────────────
  const allocation = await (prisma as any).portfolioAllocation.findUnique({
    where: { id: allocationId },
    select: {
      id: true,
      siteId: true,
      opportunityId: true,
      decision: true,
      scoreRecordId: true,
      evidenceHash: true,
      expiresAt: true,
      allocatedAt: true,
      candidateSnapshot: true,
    },
  });

  if (!allocation) {
    return { valid: false, reason: "ALLOCATION_NOT_FOUND" };
  }

  // ── Check 1: Decision is SELECTED ─────────────────────────────────────
  if (allocation.decision !== "SELECTED") {
    return { valid: false, reason: `ALLOCATION_NOT_SELECTED (is ${allocation.decision})` };
  }

  // ── Check 2: Allocation not expired ───────────────────────────────────
  if (allocation.expiresAt && new Date(allocation.expiresAt).getTime() <= now.getTime()) {
    return { valid: false, reason: "ALLOCATION_EXPIRED" };
  }

  // ── Check 3: Opportunity still OPEN ───────────────────────────────────
  const opportunity = await (prisma as any).growthDecision.findUnique({
    where: { id: allocation.opportunityId },
    select: {
      id: true,
      siteId: true,
      opportunityStatus: true,
      url: true,
    },
  });

  if (!opportunity) {
    return { valid: false, reason: "OPPORTUNITY_NOT_FOUND" };
  }

  if (opportunity.opportunityStatus !== "OPEN") {
    return { valid: false, reason: `OPPORTUNITY_NOT_OPEN (is ${opportunity.opportunityStatus})` };
  }

  // ── Check 4: Site ID matches ──────────────────────────────────────────
  if (opportunity.siteId !== allocation.siteId) {
    return { valid: false, reason: "SITE_MISMATCH" };
  }

  // ── Check 5: Score record still matches ───────────────────────────────
  const latestScore = await (prisma as any).opportunityScoreRecord.findFirst({
    where: {
      opportunityId: allocation.opportunityId,
      decision: "PROMOTE",
    },
    orderBy: { scoredAt: "desc" },
    select: {
      id: true,
      evidenceHash: true,
    },
  });

  if (!latestScore) {
    return { valid: false, reason: "NO_PROMOTE_SCORE_RECORD" };
  }

  if (latestScore.id !== allocation.scoreRecordId) {
    return { valid: false, reason: "SCORE_RECORD_CHANGED" };
  }

  // ── Check 6: Evidence hash unchanged ──────────────────────────────────
  if (latestScore.evidenceHash !== allocation.evidenceHash) {
    return { valid: false, reason: "EVIDENCE_HASH_CHANGED" };
  }

  // ── Check 7: No D.5 experiment conflict created after allocation ──────
  const snapshot = allocation.candidateSnapshot as Record<string, unknown>;
  const resourceType = (snapshot?.resourceType as string) ?? "PAGE";
  const resourceId = (snapshot?.resourceId as string) ?? opportunity.url;

  const conflictingExperiment = await (prisma as any).experiment.findFirst({
    where: {
      siteId: allocation.siteId,
      status: { in: ["DRAFT", "RUNNING"] },
      targetUrl: resourceId,
      createdAt: { gt: new Date(allocation.allocatedAt) },
    },
    select: { id: true },
  });

  if (conflictingExperiment) {
    return { valid: false, reason: `D5_EXPERIMENT_CONFLICT_AFTER_ALLOCATION (${conflictingExperiment.id})` };
  }

  // ── All checks pass ───────────────────────────────────────────────────
  logger.info("[AllocationFence] Allocation valid", {
    allocationId,
    opportunityId: allocation.opportunityId,
    siteId: allocation.siteId,
  });

  return { valid: true, reason: null };
}
