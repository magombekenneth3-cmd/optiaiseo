/**
 * Phase D.4 — LLM Decision Boundary Types
 *
 * The LLM is a bounded enhancement layer:
 *   - It receives immutable context (actionType, safetyTier, constraints)
 *   - It returns ONLY field-level proposed changes
 *   - It CANNOT return actionType, safetyTier, status, approvalHash
 *   - It CANNOT modify constraints, evidence, or authorization
 *
 * Any invalid/adversarial output → REJECT → D.3 deterministic fallback.
 */

import type { ActionType } from "@/lib/proposals/types";

// ── Version ─────────────────────────────────────────────────────────────────

export const LLM_BOUNDARY_VERSION = "d4-v1";

// ── Allowed LLM Fields (discriminated union) ────────────────────────────────

/**
 * The ONLY fields the LLM is permitted to propose changes for.
 * This is a closed set — adding a field requires a code change.
 *
 * Destructive actions (CONSOLIDATE, REDIRECT, DELETE) are NEVER LLM-enhanced.
 */
export const ALLOWED_LLM_FIELDS = [
  "title",
  "metaDescription",
  "contentGuidance",
  "internalLinks",
  "contentBrief",
] as const;

export type AllowedLLMField = (typeof ALLOWED_LLM_FIELDS)[number];

/**
 * Actions that are eligible for LLM enhancement.
 * Destructive actions use D.3 templates exclusively.
 */
export const LLM_ENHANCEABLE_ACTIONS: ReadonlySet<string> = new Set([
  "UPDATE_TITLE_TAG",
  "UPDATE_META_DESCRIPTION",
  "REFRESH_CONTENT",
  "ADD_INTERNAL_LINKS",
  "GENERATE_CONTENT_BRIEF",
]);

/**
 * Field allowlist per action type.
 * The LLM can ONLY propose changes to these fields for the given action.
 */
export const ACTION_FIELD_ALLOWLIST: Readonly<
  Record<string, readonly AllowedLLMField[]>
> = {
  UPDATE_TITLE_TAG: ["title"],
  UPDATE_META_DESCRIPTION: ["metaDescription"],
  REFRESH_CONTENT: ["contentGuidance"],
  ADD_INTERNAL_LINKS: ["internalLinks"],
  GENERATE_CONTENT_BRIEF: ["contentBrief"],
};

// ── Immutable Input (D.3 → D.4) ────────────────────────────────────────────

/**
 * Current page state fetched before the LLM call.
 * All fields are strings to prevent structured injection.
 */
export interface CurrentPageState {
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly wordCount: number;
  readonly url: string;
}

/**
 * Evidence summary passed to the LLM for context.
 * Simplified from the full evidence model — no IDs, no raw DB fields.
 */
export interface LLMEvidenceSummary {
  readonly sourceType: string;
  readonly metric: string | null;
  readonly value: string | null;
  readonly daysAgo: number;
}

/**
 * Constraints are immutable context passed TO the LLM.
 * No code path from LLM output → constraints.
 */
export interface LLMConstraints {
  readonly allowedFields: readonly AllowedLLMField[];
  readonly maxContentLength: number;
  readonly safetyTier: number;
}

/**
 * What we send TO the LLM.
 * actionType is context only — the LLM CANNOT return it.
 */
export interface LLMDecisionInput {
  readonly opportunityId: string;
  readonly actionType: string;
  readonly category: string;
  readonly targetUrl: string;
  readonly primaryKeyword: string;
  readonly currentState: CurrentPageState;
  readonly evidence: readonly LLMEvidenceSummary[];
  readonly constraints: LLMConstraints;
}

// ── LLM Output (no actionType, no safety, no lifecycle) ─────────────────────

/**
 * Discriminated union — each field has specific semantics.
 * The `field` property must be one of AllowedLLMField.
 */
export interface LLMProposedChange {
  readonly field: AllowedLLMField;
  readonly proposedValue: string;
  readonly reasoning: string;
}

/**
 * What the LLM returns.
 * NO actionType. NO safetyTier. NO status. NO approvalHash.
 */
export interface LLMDecisionOutput {
  readonly proposedChanges: readonly LLMProposedChange[];
  readonly reasoning: string;
  readonly confidence: number;
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * VALID or REJECTED. No "REPAIRED" — fail closed.
 */
export type LLMValidationVerdict = "VALID" | "REJECTED";

export interface LLMValidationResult {
  readonly verdict: LLMValidationVerdict;
  readonly reasons: readonly string[];
}

// ── Audit Envelope ──────────────────────────────────────────────────────────

/**
 * Bounded audit metadata persisted on ActionProposal.metadata.llm.
 * Does NOT contain raw input/output — those go to application logs.
 */
export interface LLMAuditEnvelope {
  readonly modelId: string;
  readonly promptVersion: string;
  readonly promptHash: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly confidence: number;
  readonly validationResult: LLMValidationVerdict;
  readonly fallbackUsed: boolean;
  readonly latencyMs: number;
  readonly timestamp: string;
}

// ── Enhancement Result (D.4 → D.3 planner) ─────────────────────────────────

export type EnhancementOutcome = "ENHANCED" | "FALLBACK" | "DEFER" | "SKIPPED";

export interface EnhancementResult {
  readonly outcome: EnhancementOutcome;
  readonly changes: readonly import("@/lib/proposals/types").ProposedChange[];
  readonly audit: LLMAuditEnvelope | null;
  readonly reason: string;
}
