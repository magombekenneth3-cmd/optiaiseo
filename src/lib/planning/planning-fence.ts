/**
 * Phase D.3 — Planning Evidence Fence
 *
 * Reuses D.2's evidence fencing pattern:
 *   D.2 score → evidenceHash
 *   D.3 plan  → carries evidenceHash
 *   Before persisting → re-verify hash matches current evidence
 *   If changed → discard plan, return DEFER
 *
 * A plan generated against stale evidence must NEVER become executable.
 */

import type { PlanningInput, PlanningReason } from "./types";
import { hashScoringEvidence } from "@/lib/scoring/evidence-fencing";
import type { ScoringInput } from "@/lib/scoring/types";

// ── Types ───────────────────────────────────────────────────────────────────

export interface FenceResult {
  valid: boolean;
  currentHash: string;
  expectedHash: string;
  reason: PlanningReason | null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Verifies that the evidence used for D.2 scoring hasn't changed
 * since the score was computed.
 *
 * @param planningInput — Current planning input (with fresh evidence)
 * @param expectedHash — The evidenceHash from the D.2 score record
 * @returns FenceResult indicating whether the plan is safe to persist
 */
export function verifyPlanningEvidenceFence(
  planningInput: PlanningInput,
  expectedHash: string
): FenceResult {
  // Reconstruct a ScoringInput-compatible structure for hashing
  const scoringInput: ScoringInput = {
    opportunityId: planningInput.opportunity.id,
    siteId: planningInput.opportunity.siteId,
    url: planningInput.opportunity.url,
    primaryKeyword: planningInput.opportunity.primaryKeyword,
    category: planningInput.opportunity.category,
    action: planningInput.opportunity.action,
    discoveryConfidence: planningInput.opportunity.discoveryConfidence,
    expiresAt: planningInput.opportunity.expiresAt,
    lastRefreshedAt: null, // Not available at planning time
    primaryDiscoverySource: "GSC", // Not relevant for hash
    evidenceItems: planningInput.evidence.map((e) => ({
      sourceType: e.sourceType,
      metric: e.metric,
      value: e.value,
      observedAt: e.observedAt,
    })),
    existingScore: null,
    metadata: {},
  };

  const currentHash = hashScoringEvidence(scoringInput);

  if (currentHash !== expectedHash) {
    return {
      valid: false,
      currentHash,
      expectedHash,
      reason: {
        rule: "EVIDENCE_CHANGED",
        details: `Evidence hash changed: expected ${expectedHash.slice(0, 12)}… got ${currentHash.slice(0, 12)}… — evidence mutated since scoring`,
      },
    };
  }

  return {
    valid: true,
    currentHash,
    expectedHash,
    reason: null,
  };
}
