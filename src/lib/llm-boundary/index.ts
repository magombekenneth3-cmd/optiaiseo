/**
 * Phase D.4 — LLM Decision Boundary Orchestrator
 *
 * Main entry point: enhancePlanWithLLM()
 *
 * Flow:
 *   1. Check D4_LLM_ENABLED → disabled? return D.3 template
 *   2. Check action is LLM-enhanceable → destructive? return D.3 template
 *   3. Build immutable LLM input → compute inputHash
 *   4. Call LLM adapter
 *   5. Zod validate → REJECT? → D.3 fallback
 *   6. Deterministic validate → REJECT? → D.3 fallback
 *   7. Re-fence evidence → changed? → DEFER
 *   8. Build ProposedChange[] from validated output
 *   9. Build audit envelope
 *   10. Return enhanced changes + envelope
 *
 * Critical invariant:
 *   For any LLM output whatsoever—including malicious, malformed,
 *   adversarial, or hallucinated output—the resulting system can only
 *   produce a DRAFT proposal whose action type, target, safety constraints,
 *   evidence fence, and authorization requirements originated outside the LLM.
 */

import { logger } from "@/lib/logger";
import type { ActionPlan, PlanningInput } from "@/lib/planning/types";
import type { ProposedChange } from "@/lib/proposals/types";
import type { EnhancementResult, LLMAuditEnvelope } from "./types";
import { LLM_ENHANCEABLE_ACTIONS } from "./types";
import { buildLLMInput, computeInputHash, computeOutputHash } from "./input-builder";
import { callLLM } from "./llm-adapter";
import { getPromptForAction, getPromptVersion, getPromptHash } from "./prompts";
import { buildAuditEnvelope, buildFallbackEnvelope } from "./decision-trace";
import { reVerifyEvidenceAfterLLM } from "./evidence-refence";

// ── Configuration ───────────────────────────────────────────────────────────

const LLM_ENABLED = process.env.D4_LLM_ENABLED !== "false";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Enhance a D.3 ActionPlan with LLM-generated proposed changes.
 *
 * Always returns a valid EnhancementResult.
 * Never throws — all errors produce FALLBACK outcome.
 *
 * @param plan — The validated ActionPlan from D.3
 * @param input — The PlanningInput used by D.3
 * @param templateChanges — D.3's deterministic proposed changes (fallback)
 */
export async function enhancePlanWithLLM(
  plan: ActionPlan,
  input: PlanningInput,
  templateChanges: readonly ProposedChange[]
): Promise<EnhancementResult> {
  const startMs = Date.now();

  // 1. Check if LLM is enabled
  if (!LLM_ENABLED) {
    return {
      outcome: "SKIPPED",
      changes: [...templateChanges],
      audit: null,
      reason: "D4_LLM_ENABLED=false",
    };
  }

  // 2. Check if action is LLM-enhanceable (destructive actions never enhanced)
  if (!LLM_ENHANCEABLE_ACTIONS.has(plan.actionType)) {
    return {
      outcome: "SKIPPED",
      changes: [...templateChanges],
      audit: null,
      reason: `Action ${plan.actionType} is not LLM-enhanceable`,
    };
  }

  // 3. Build immutable LLM input
  const llmInput = buildLLMInput(plan, input);
  if (!llmInput) {
    return {
      outcome: "SKIPPED",
      changes: [...templateChanges],
      audit: null,
      reason: "Failed to build LLM input",
    };
  }

  const inputHash = computeInputHash(llmInput);
  const promptVersion = getPromptVersion(plan.actionType) ?? "unknown";
  const promptHash = getPromptHash(plan.actionType) ?? "unknown";

  // 4. Call LLM adapter (never throws)
  const callResult = await callLLM(llmInput);

  // 5–6. Check for validation failure (Zod + deterministic — already done in adapter)
  if (!callResult.output) {
    logger.info("[D4] LLM failed or rejected, using D.3 fallback", {
      actionType: plan.actionType,
      error: callResult.error,
      reasons: callResult.validationResult.reasons,
    });

    return {
      outcome: "FALLBACK",
      changes: [...templateChanges],
      audit: buildFallbackEnvelope(
        inputHash,
        promptVersion,
        promptHash,
        callResult.error ?? "LLM output rejected",
        callResult.latencyMs
      ),
      reason: callResult.error ?? "LLM output rejected",
    };
  }

  // 7. Re-fence evidence (evidence may have changed during LLM call)
  if (plan.evidenceHash) {
    const refence = reVerifyEvidenceAfterLLM(
      input,
      plan.evidenceHash
    );

    if (!refence.valid) {
      logger.warn("[D4] Evidence changed during LLM call, deferring", {
        opportunityId: plan.opportunityId,
        reason: refence.reason,
      });

      return {
        outcome: "DEFER",
        changes: [],
        audit: buildFallbackEnvelope(
          inputHash,
          promptVersion,
          promptHash,
          refence.reason,
          callResult.latencyMs
        ),
        reason: refence.reason,
      };
    }
  }

  // 8. Build ProposedChange[] from validated LLM output
  const enhancedChanges: ProposedChange[] = callResult.output.proposedChanges.map(
    (llmChange) => ({
      field: llmChange.field,
      currentValue: llmInput.currentState[llmChange.field as keyof typeof llmInput.currentState] as string | null ?? null,
      proposedValue: llmChange.proposedValue,
      reasoning: llmChange.reasoning,
    })
  );

  // 9. Build audit envelope
  const outputHash = computeOutputHash(callResult.output);
  const audit = buildAuditEnvelope({
    modelId: callResult.modelId,
    promptVersion,
    promptHash,
    inputHash,
    outputHash,
    confidence: callResult.output.confidence,
    validationResult: callResult.validationResult.verdict,
    fallbackUsed: false,
    latencyMs: callResult.latencyMs,
  });

  logger.info("[D4] LLM enhancement successful", {
    actionType: plan.actionType,
    confidence: callResult.output.confidence,
    changesCount: enhancedChanges.length,
    latencyMs: callResult.latencyMs,
  });

  // 10. Return enhanced result
  return {
    outcome: "ENHANCED",
    changes: enhancedChanges,
    audit,
    reason: "LLM enhancement applied",
  };
}

// ── Re-exports for convenience ──────────────────────────────────────────────

export type {
  EnhancementResult,
  LLMAuditEnvelope,
  LLMDecisionInput,
  LLMDecisionOutput,
  LLMProposedChange,
  LLMConstraints,
  LLMValidationResult,
  LLMValidationVerdict,
  AllowedLLMField,
} from "./types";

export { ALLOWED_LLM_FIELDS, LLM_ENHANCEABLE_ACTIONS, ACTION_FIELD_ALLOWLIST } from "./types";
export { parseLLMOutput, llmOutputSchema } from "./output-schema";
export { validateLLMOutput } from "./output-validator";
export { computeInputHash, computeOutputHash, buildLLMInput } from "./input-builder";
export { getPromptVersion, getPromptHash } from "./prompts";
