/**
 * Phase D.4 — Strict LLM Output Schema (Zod)
 *
 * Structurally prevents the LLM from returning:
 *   - actionType (not in schema)
 *   - safetyTier (not in schema)
 *   - status / approvalHash / opportunityStatus (not in schema)
 *   - Any field outside the ALLOWED_LLM_FIELDS enum
 *
 * If Zod validation fails → REJECT → D.3 fallback. No repair.
 */

import { z } from "zod";
import { ALLOWED_LLM_FIELDS } from "./types";

// ── Schema ──────────────────────────────────────────────────────────────────

export const llmProposedChangeSchema = z.object({
  field: z.enum(ALLOWED_LLM_FIELDS),
  proposedValue: z.string().min(1).max(5000),
  reasoning: z.string().min(1).max(1000),
});

export const llmOutputSchema = z.object({
  proposedChanges: z.array(llmProposedChangeSchema).min(1).max(10),
  reasoning: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1),
});

// ── Type-safe parse ─────────────────────────────────────────────────────────

export type ParsedLLMOutput = z.infer<typeof llmOutputSchema>;

/**
 * Parse LLM output with strict validation.
 * Returns null on any failure — no partial repair.
 */
export function parseLLMOutput(raw: unknown): ParsedLLMOutput | null {
  const result = llmOutputSchema.safeParse(raw);
  if (!result.success) {
    return null;
  }
  return result.data;
}

/**
 * Returns human-readable Zod errors for logging.
 */
export function getLLMParseErrors(raw: unknown): string[] {
  const result = llmOutputSchema.safeParse(raw);
  if (result.success) return [];
  return result.error.issues.map(
    (e) => `${e.path.map(String).join(".")}: ${e.message}`
  );
}
