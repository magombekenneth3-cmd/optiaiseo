/**
 * Phase D.4 — Deterministic Output Validator
 *
 * Fail-closed validation. Any violation → REJECTED → D.3 fallback.
 * NO truncation. NO partial repair. NO "REPAIRED" verdict.
 *
 * Checks:
 *   1. Zod schema passed (pre-condition — caller checks)
 *   2. Every field is in allowedFields for this action
 *   3. No injection content in proposedValue
 *   4. Title ≤ 70 chars
 *   5. Meta description ≤ 160 chars
 *   6. proposedValue length ≤ maxContentLength
 *   7. No forbidden lifecycle/approval field references
 */

import type {
  LLMValidationResult,
  LLMConstraints,
  AllowedLLMField,
} from "./types";
import type { ParsedLLMOutput } from "./output-schema";

// ── Field-specific Length Limits ─────────────────────────────────────────────

const FIELD_LENGTH_LIMITS: Partial<Record<AllowedLLMField, number>> = {
  title: 70,
  metaDescription: 160,
};

// ── Injection Patterns ──────────────────────────────────────────────────────

const INJECTION_PATTERNS: readonly RegExp[] = [
  /<script/i,
  /javascript:/i,
  /on(click|error|load|mouseover|focus|blur)=/i,
  /data:text\/html/i,
  /eval\s*\(/i,
  /document\.(cookie|write|location)/i,
  /window\.(location|open)/i,
  /import\s*\(/i,
  /require\s*\(/i,
];

/**
 * System-prompt injection markers.
 * If the LLM echoes back system prompt artifacts, something is wrong.
 */
const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /SYSTEM:/i,
  /\bignore\s+(previous|above|all)\s+(instructions?|prompts?)/i,
  /\byou\s+are\s+now\b/i,
  /\bact\s+as\b.*\b(admin|root|sudo)\b/i,
];

// ── Forbidden Fields ────────────────────────────────────────────────────────

const FORBIDDEN_FIELD_VALUES: readonly string[] = [
  "status",
  "opportunityStatus",
  "approvalHash",
  "approvedBy",
  "approvedAt",
  "safetyTier",
  "actionType",
  "requiresApproval",
  "executionClaim",
  "budgetReservation",
];

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Validate parsed LLM output against deterministic rules.
 * Returns VALID or REJECTED. Never returns "REPAIRED".
 *
 * @param output — Already Zod-validated LLM output
 * @param constraints — Immutable constraints from D.3
 */
export function validateLLMOutput(
  output: ParsedLLMOutput,
  constraints: LLMConstraints
): LLMValidationResult {
  const reasons: string[] = [];

  // 1. Every field must be in allowedFields for this action
  for (const change of output.proposedChanges) {
    if (!constraints.allowedFields.includes(change.field)) {
      reasons.push(
        `Field "${change.field}" is not in allowedFields [${constraints.allowedFields.join(", ")}]`
      );
    }
  }

  // 2. No injection content in proposedValue
  for (const change of output.proposedChanges) {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(change.proposedValue)) {
        reasons.push(
          `Injection detected in field "${change.field}": matches ${pattern.source}`
        );
      }
    }
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(change.proposedValue)) {
        reasons.push(
          `Prompt injection detected in field "${change.field}": matches ${pattern.source}`
        );
      }
    }
    // Also check reasoning for injection
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(change.reasoning)) {
        reasons.push(
          `Injection detected in reasoning for "${change.field}": matches ${pattern.source}`
        );
      }
    }
  }

  // 3. Field-specific length limits (REJECT, not truncate)
  for (const change of output.proposedChanges) {
    const limit = FIELD_LENGTH_LIMITS[change.field];
    if (limit && change.proposedValue.length > limit) {
      reasons.push(
        `Field "${change.field}" exceeds ${limit} char limit (got ${change.proposedValue.length})`
      );
    }
  }

  // 4. maxContentLength (REJECT, not truncate)
  for (const change of output.proposedChanges) {
    if (change.proposedValue.length > constraints.maxContentLength) {
      reasons.push(
        `Field "${change.field}" exceeds maxContentLength ${constraints.maxContentLength} (got ${change.proposedValue.length})`
      );
    }
  }

  // 5. No forbidden field names in proposedChanges
  for (const change of output.proposedChanges) {
    if (FORBIDDEN_FIELD_VALUES.includes(change.field)) {
      reasons.push(
        `Forbidden field "${change.field}" in proposedChanges`
      );
    }
  }

  // 6. Confidence bounds (should already be handled by Zod, but defense in depth)
  if (output.confidence < 0 || output.confidence > 1) {
    reasons.push(`Confidence ${output.confidence} out of bounds [0, 1]`);
  }

  // 7. Check reasoning for forbidden content
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(output.reasoning)) {
      reasons.push(
        `Injection detected in top-level reasoning: matches ${pattern.source}`
      );
    }
  }

  return {
    verdict: reasons.length === 0 ? "VALID" : "REJECTED",
    reasons,
  };
}
