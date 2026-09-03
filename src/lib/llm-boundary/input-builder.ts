/**
 * Phase D.4 — Structured Input Builder
 *
 * Transforms D.3 ActionPlan + PlanningInput → frozen LLMDecisionInput.
 *
 * All properties are readonly.
 * The result is Object.freeze()'d.
 * Computes inputHash = SHA-256 of canonical JSON.
 */

import { createHash } from "crypto";
import type { ActionPlan, PlanningInput } from "@/lib/planning/types";
import type {
  LLMDecisionInput,
  LLMEvidenceSummary,
  CurrentPageState,
  LLMConstraints,
  AllowedLLMField,
} from "./types";
import { ACTION_FIELD_ALLOWLIST, LLM_ENHANCEABLE_ACTIONS } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build an immutable LLM input from a D.3 plan.
 * Returns null if the action is not LLM-enhanceable.
 */
export function buildLLMInput(
  plan: ActionPlan,
  input: PlanningInput
): LLMDecisionInput | null {
  if (!LLM_ENHANCEABLE_ACTIONS.has(plan.actionType)) {
    return null;
  }

  const allowedFields = ACTION_FIELD_ALLOWLIST[plan.actionType];
  if (!allowedFields || allowedFields.length === 0) {
    return null;
  }

  const now = Date.now();

  const currentState: CurrentPageState = Object.freeze({
    title: null, // Would be fetched from DB in production
    metaDescription: null,
    wordCount: 0,
    url: plan.targetUrl,
  });

  const evidence: readonly LLMEvidenceSummary[] = Object.freeze(
    input.evidence.map((e) =>
      Object.freeze({
        sourceType: e.sourceType,
        metric: e.metric ?? null,
        value: e.value ?? null,
        daysAgo: Math.round((now - e.observedAt.getTime()) / MS_PER_DAY),
      })
    )
  );

  const constraints: LLMConstraints = Object.freeze({
    allowedFields: Object.freeze([...allowedFields]),
    maxContentLength: 5000,
    safetyTier: plan.constraints?.safetyTier ?? 1,
  });

  const result: LLMDecisionInput = Object.freeze({
    opportunityId: plan.opportunityId,
    actionType: plan.actionType,
    category: input.opportunity.category,
    targetUrl: plan.targetUrl,
    primaryKeyword: input.opportunity.primaryKeyword,
    currentState,
    evidence,
    constraints,
  });

  return result;
}

/**
 * Compute SHA-256 hash of the canonical JSON representation of the input.
 * Used for audit trail — same input always produces same hash.
 */
export function computeInputHash(input: LLMDecisionInput): string {
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Compute SHA-256 hash of an LLM output for audit trail.
 */
export function computeOutputHash(output: unknown): string {
  const canonical = JSON.stringify(output);
  return createHash("sha256").update(canonical).digest("hex");
}
