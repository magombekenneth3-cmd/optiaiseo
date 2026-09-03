/**
 * Phase D.4 — Decision Trace
 *
 * Builds LLMAuditEnvelope from call results.
 * Persisted on ActionProposal.metadata.llm.
 *
 * Does NOT contain raw input/output — those go to application logs.
 * Contains only bounded audit metadata with hashes for reproducibility.
 */

import type {
  LLMAuditEnvelope,
  LLMValidationVerdict,
} from "./types";

// ── Public API ──────────────────────────────────────────────────────────────

export interface BuildTraceInput {
  readonly modelId: string;
  readonly promptVersion: string;
  readonly promptHash: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly confidence: number;
  readonly validationResult: LLMValidationVerdict;
  readonly fallbackUsed: boolean;
  readonly latencyMs: number;
}

/**
 * Build a bounded audit envelope for persistence.
 * This is the ONLY trace data stored in the DB.
 * Raw I/O goes to logger with requestId for correlation.
 */
export function buildAuditEnvelope(input: BuildTraceInput): LLMAuditEnvelope {
  return Object.freeze({
    modelId: input.modelId,
    promptVersion: input.promptVersion,
    promptHash: input.promptHash,
    inputHash: input.inputHash,
    outputHash: input.outputHash,
    confidence: input.confidence,
    validationResult: input.validationResult,
    fallbackUsed: input.fallbackUsed,
    latencyMs: input.latencyMs,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Build a fallback audit envelope when D.3 template is used.
 */
export function buildFallbackEnvelope(
  inputHash: string,
  promptVersion: string,
  promptHash: string,
  reason: string,
  latencyMs: number
): LLMAuditEnvelope {
  return Object.freeze({
    modelId: "none",
    promptVersion,
    promptHash,
    inputHash,
    outputHash: "d3-template",
    confidence: 0,
    validationResult: "REJECTED" as const,
    fallbackUsed: true,
    latencyMs,
    timestamp: new Date().toISOString(),
  });
}
