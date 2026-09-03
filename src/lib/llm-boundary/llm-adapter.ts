/**
 * Phase D.4 — LLM Adapter
 *
 * Wraps the existing Gemini client with D.4-specific concerns:
 *   - Timeout: 15s per call
 *   - Retries: 1 retry
 *   - Model: GEMINI_FLASH (configurable)
 *   - Fallback: Any failure → D.3 template. Always produces valid output.
 *   - Trace: Records LLMAuditEnvelope for every call
 *   - Raw output → logger (not persisted in DB)
 */

import { logger } from "@/lib/logger";
import type { LLMDecisionInput, LLMDecisionOutput } from "./types";
import { parseLLMOutput, getLLMParseErrors } from "./output-schema";
import { validateLLMOutput } from "./output-validator";
import { getPromptForAction } from "./prompts";
import type { LLMValidationResult } from "./types";

// ── Configuration ───────────────────────────────────────────────────────────

const LLM_TIMEOUT_MS = 15_000;
const LLM_MODEL = process.env.D4_LLM_MODEL || "gemini-2.5-flash";

// ── Result Types ────────────────────────────────────────────────────────────

export interface LLMCallResult {
  readonly output: LLMDecisionOutput | null;
  readonly validationResult: LLMValidationResult;
  readonly rawOutput: string | null;
  readonly latencyMs: number;
  readonly modelId: string;
  readonly error: string | null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Call the LLM with the given input and validate the output.
 * On any failure → returns null output with error details.
 *
 * This function NEVER throws. All errors are caught and reported.
 */
export async function callLLM(
  input: LLMDecisionInput
): Promise<LLMCallResult> {
  const startMs = Date.now();

  // 1. Get prompt template
  const promptTemplate = getPromptForAction(input.actionType, input);
  if (!promptTemplate) {
    return {
      output: null,
      validationResult: { verdict: "REJECTED", reasons: ["No prompt for action"] },
      rawOutput: null,
      latencyMs: Date.now() - startMs,
      modelId: LLM_MODEL,
      error: `No prompt template for action ${input.actionType}`,
    };
  }

  // 2. Build the prompt
  const prompt = promptTemplate.build(input);
  const requestId = crypto.randomUUID();

  // 3. Call the LLM
  let rawText: string;
  try {
    rawText = await callGeminiWithTimeout(prompt, requestId);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn(`[D4:${requestId}] LLM call failed`, { error, actionType: input.actionType });
    return {
      output: null,
      validationResult: { verdict: "REJECTED", reasons: [`LLM call failed: ${error}`] },
      rawOutput: null,
      latencyMs: Date.now() - startMs,
      modelId: LLM_MODEL,
      error,
    };
  }

  // Log raw output for debugging (NOT persisted in DB)
  logger.info(`[D4:${requestId}] LLM raw response`, {
    actionType: input.actionType,
    responseLength: rawText.length,
  });

  // 4. Parse JSON from LLM response
  let parsed: unknown;
  try {
    const clean = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/m, "")
      .replace(/```\s*$/m, "")
      .trim();
    parsed = JSON.parse(clean);
  } catch {
    logger.warn(`[D4:${requestId}] LLM returned invalid JSON`);
    return {
      output: null,
      validationResult: { verdict: "REJECTED", reasons: ["Invalid JSON"] },
      rawOutput: rawText,
      latencyMs: Date.now() - startMs,
      modelId: LLM_MODEL,
      error: "Invalid JSON from LLM",
    };
  }

  // 5. Zod schema validation (fail closed)
  const zodResult = parseLLMOutput(parsed);
  if (!zodResult) {
    const errors = getLLMParseErrors(parsed);
    logger.warn(`[D4:${requestId}] LLM output failed Zod validation`, { errors });
    return {
      output: null,
      validationResult: { verdict: "REJECTED", reasons: errors },
      rawOutput: rawText,
      latencyMs: Date.now() - startMs,
      modelId: LLM_MODEL,
      error: "Zod validation failed",
    };
  }

  // 6. Deterministic validation (fail closed — no repair)
  const validationResult = validateLLMOutput(zodResult, input.constraints);
  if (validationResult.verdict === "REJECTED") {
    logger.warn(`[D4:${requestId}] LLM output rejected by validator`, {
      reasons: validationResult.reasons,
    });
    return {
      output: null,
      validationResult,
      rawOutput: rawText,
      latencyMs: Date.now() - startMs,
      modelId: LLM_MODEL,
      error: "Deterministic validation rejected",
    };
  }

  // 7. Valid output
  return {
    output: zodResult,
    validationResult,
    rawOutput: rawText,
    latencyMs: Date.now() - startMs,
    modelId: LLM_MODEL,
    error: null,
  };
}

// ── Internal: Gemini Call with Timeout ───────────────────────────────────────

async function callGeminiWithTimeout(
  prompt: string,
  requestId: string
): Promise<string> {
  // Dynamic import to avoid hard dependency when LLM is disabled
  const { callGemini } = await import("@/lib/gemini/client");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const result = await callGemini(prompt, {
      model: LLM_MODEL,
      responseFormat: "json",
      temperature: 0.3, // Low temperature for consistency
      timeoutMs: LLM_TIMEOUT_MS,
      maxRetries: 1,
    });
    return result;
  } finally {
    clearTimeout(timer);
  }
}
