import { z } from "zod";
import type { IntentClassification } from "./intent-agent";

export const SearchIntentEnum = z.enum([
  "INFORMATIONAL",
  "COMMERCIAL",
  "TRANSACTIONAL",
  "NAVIGATIONAL",
  "COMPARISON",
  "PROBLEM_SOLVING",
]);

export const IntentClassificationSchema = z.object({
  query: z.string().min(1, "Query must be non-empty"),
  queryIntent: SearchIntentEnum,
  pageUrl: z.string().min(1, "pageUrl must be non-empty"),
  pageIntent: SearchIntentEnum,
  match: z.boolean(),
  matchScore: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100),
  reason: z.string().max(500, "Reason must be at most 500 characters"),
});

export const IntentBatchResponseSchema = z.array(IntentClassificationSchema);

// ── Validation API ──────────────────────────────────────────────────────────

/**
 * Validate and parse raw LLM output into typed IntentClassification[].
 *
 * @param raw - The raw output from the LLM classifyFn
 * @returns Validated and typed IntentClassification array
 * @throws Error with detailed Zod validation messages
 */
export function validateIntentResponse(raw: unknown): IntentClassification[] {
  const result = IntentBatchResponseSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    ).join("; ");

    throw new Error(`LLM output validation failed: ${issues}`);
  }

  // Cast from Zod's inferred types to our interface types
  return result.data as IntentClassification[];
}

/**
 * Attempt to salvage partially valid results from malformed LLM output.
 *
 * Parses each item individually, keeping valid ones and discarding invalid ones.
 * Use this when you want best-effort classification rather than all-or-nothing.
 * @returns { valid: IntentClassification[], invalidCount: number }
 */
export function salvageIntentResponse(raw: unknown): {
  valid: IntentClassification[];
  invalidCount: number;
} {
  if (!Array.isArray(raw)) {
    return { valid: [], invalidCount: 1 };
  }

  const valid: IntentClassification[] = [];
  let invalidCount = 0;

  for (const item of raw) {
    const result = IntentClassificationSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data as IntentClassification);
    } else {
      invalidCount++;
    }
  }

  return { valid, invalidCount };
}
