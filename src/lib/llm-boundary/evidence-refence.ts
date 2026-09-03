/**
 * Phase D.4 — Evidence Re-fence
 *
 * After the LLM returns (15-30s latency window), re-verify that evidence
 * hasn't changed. The LLM call can take significant time, during which
 * evidence could be refreshed by D.1.
 *
 * Flow:
 *   evidenceHash_before (from D.3 ActionPlan)
 *       ↓
 *   LLM call (15-30s)
 *       ↓
 *   evidenceHash_after (re-computed from current PlanningInput)
 *       ↓
 *   different? → DEFER (discard LLM result, replan later)
 *   same?      → proceed to createDraftProposal
 *
 * Reuses the evidence fencing pattern from D.2/D.3.
 */

import type { PlanningInput } from "@/lib/planning/types";
import { verifyPlanningEvidenceFence } from "@/lib/planning/planning-fence";

// ── Public API ──────────────────────────────────────────────────────────────

export interface EvidenceRefenceResult {
  readonly valid: boolean;
  readonly reason: string;
}

/**
 * Re-verify evidence hash after the LLM latency window.
 *
 * @param planningInput — The current planning input (re-fetched or same reference)
 * @param expectedHash — The evidence hash from D.3's ActionPlan (captured before LLM call)
 */
export function reVerifyEvidenceAfterLLM(
  planningInput: PlanningInput,
  expectedHash: string
): EvidenceRefenceResult {
  const fenceResult = verifyPlanningEvidenceFence(
    planningInput,
    expectedHash
  );

  if (fenceResult.valid) {
    return {
      valid: true,
      reason: "Evidence unchanged during LLM call",
    };
  }

  return {
    valid: false,
    reason: fenceResult.reason?.details ?? "Evidence changed during LLM call window",
  };
}
