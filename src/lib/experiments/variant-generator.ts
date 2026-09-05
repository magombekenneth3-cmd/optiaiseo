/**
 * Phase D.5.2 — Variant Generation
 *
 * Generates deterministic action variants from the D.3/D.4 plan.
 *
 * INVARIANT: The LLM may suggest variant parameters, but CANNOT change:
 *   - target URL (locked from plan)
 *   - action type (locked from plan)
 *   - safety constraints (locked from plan)
 *   - authorization requirements (locked from Phase C)
 *
 * Current model: 1 control + 1 treatment per experiment.
 * The treatment is the exact action from the D.3 plan — no variation.
 */

import { createHash } from "crypto";
import type { ActionPlan } from "@/lib/planning/types";
import type { ExperimentVariantInput, VariantKey } from "./types";

// ── Variant Generation ──────────────────────────────────────────────────────

/**
 * Generates control + treatment variants from a D.3 ActionPlan.
 *
 * Control: same target URL, no action applied.
 * Treatment: the exact action from the plan.
 *
 * @param experimentId - The experiment these variants belong to
 * @param plan - The D.3 ActionPlan to derive variants from
 * @param primaryKeyword - The primary keyword for this opportunity
 * @returns Array of variant inputs ready for assignment
 */
export function generateVariants(
  experimentId: string,
  plan: ActionPlan,
  primaryKeyword: string
): ExperimentVariantInput[] {
  // Control: same target, no action
  const control: ExperimentVariantInput = {
    variantKey: "control",
    isControl: true,
    targetUrl: plan.targetUrl,
    targetKeyword: primaryKeyword,
    actionType: null,
    actionParameters: null,
  };

  // Treatment: the planned action
  const treatment: ExperimentVariantInput = {
    variantKey: "treatment_a",
    isControl: false,
    targetUrl: plan.targetUrl,
    targetKeyword: primaryKeyword,
    actionType: plan.actionType,
    actionParameters: plan.parameters,
  };

  return [control, treatment];
}

// ── Assignment Hash ─────────────────────────────────────────────────────────

/**
 * Produces a deterministic assignment hash for a variant.
 *
 * Hash = sha256(experimentId + variantKey + targetUrl)
 *
 * This ensures:
 * - Same input → same hash (deterministic)
 * - Different variants → different hashes (unique)
 * - Stable across retries (idempotent)
 */
export function computeAssignmentHash(
  experimentId: string,
  variantKey: VariantKey,
  targetUrl: string
): string {
  const input = `${experimentId}:${variantKey}:${targetUrl}`;
  return createHash("sha256").update(input).digest("hex");
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Validates that generated variants satisfy D.5 invariants:
 * - Exactly one control variant
 * - At least one treatment variant
 * - All variants target the same URL
 * - Treatment variants have an action type
 * - Control variant has no action type
 */
export function validateVariants(
  variants: ExperimentVariantInput[]
): { valid: boolean; reason?: string } {
  if (variants.length < 2) {
    return { valid: false, reason: "Experiment requires at least 2 variants (1 control + 1 treatment)" };
  }

  const controls = variants.filter(v => v.isControl);
  if (controls.length !== 1) {
    return { valid: false, reason: `Expected exactly 1 control variant, got ${controls.length}` };
  }

  const treatments = variants.filter(v => !v.isControl);
  if (treatments.length === 0) {
    return { valid: false, reason: "Experiment requires at least 1 treatment variant" };
  }

  // All variants must target the same URL
  const urls = new Set(variants.map(v => v.targetUrl));
  if (urls.size !== 1) {
    return { valid: false, reason: `All variants must target the same URL, got ${urls.size} distinct URLs` };
  }

  // Control must have no action
  const control = controls[0];
  if (control.actionType !== null) {
    return { valid: false, reason: "Control variant must have actionType = null" };
  }

  // Treatments must have an action
  for (const t of treatments) {
    if (t.actionType === null) {
      return { valid: false, reason: `Treatment variant "${t.variantKey}" must have an actionType` };
    }
  }

  // Unique variant keys
  const keys = new Set(variants.map(v => v.variantKey));
  if (keys.size !== variants.length) {
    return { valid: false, reason: "Duplicate variant keys detected" };
  }

  return { valid: true };
}
