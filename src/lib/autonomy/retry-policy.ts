/**
 * Retry Policy — Deterministic retry decisions based on failure classification.
 *
 * The classifier answers "What happened?"
 * This module answers "Should we retry, and how?"
 *
 * They never merge — this prevents the classifier from becoming a hidden policy engine.
 *
 * Retry budget rule: Retries of the same execution do NOT consume additional
 * daily mutation budget units. They DO consume provider/API/LLM budgets.
 */

import type { FailureClass } from "./failure-classifier";

// ── Types ───────────────────────────────────────────────────────────────────

export interface RetryDecision {
  shouldRetry: boolean;
  strategy: "SAME" | "RELOAD_AND_RETRY" | "DEFER" | "ABANDON";
  delayMs: number;
  reason: string;
  /** Side effect to trigger (e.g., pause channel, close opportunity) */
  sideEffect?: "pause_channel" | "close_opportunity" | "alert";
}

interface RetryRule {
  maxRetries: number;
  strategy: "SAME" | "RELOAD_AND_RETRY" | "DEFER" | "ABANDON";
  baseDelayMs: number;
  backoff: "none" | "exponential";
  sideEffect?: "pause_channel" | "close_opportunity" | "alert";
}

// ── Retry Rules ─────────────────────────────────────────────────────────────

const RETRY_RULES: Record<FailureClass, RetryRule> = {
  TRANSIENT: {
    maxRetries: 3,
    strategy: "SAME",
    baseDelayMs: 5_000,
    backoff: "exponential",
  },
  VERSION_CONFLICT: {
    maxRetries: 1,
    strategy: "RELOAD_AND_RETRY",
    baseDelayMs: 1_000,
    backoff: "none",
  },
  EXTERNAL_BLOCKED: {
    maxRetries: 0,
    strategy: "ABANDON",
    baseDelayMs: 0,
    backoff: "none",
    sideEffect: "pause_channel",
  },
  RESOURCE_GONE: {
    maxRetries: 0,
    strategy: "ABANDON",
    baseDelayMs: 0,
    backoff: "none",
    sideEffect: "close_opportunity",
  },
  STRATEGY_INVALID: {
    maxRetries: 0,
    strategy: "ABANDON",
    baseDelayMs: 0,
    backoff: "none",
    sideEffect: "close_opportunity",
  },
  BUDGET_EXCEEDED: {
    maxRetries: 0,
    strategy: "DEFER",
    baseDelayMs: 0,
    backoff: "none",
  },
  UNKNOWN: {
    maxRetries: 0,
    strategy: "ABANDON",
    baseDelayMs: 0,
    backoff: "none",
    sideEffect: "alert",
  },
};

// ── Core Function ───────────────────────────────────────────────────────────

/**
 * Makes a deterministic retry decision based on failure class and attempt number.
 *
 * @param failureClass - The classified failure type
 * @param attemptNumber - Current attempt (1-based). Attempt 1 = first execution.
 * @returns RetryDecision with strategy and timing
 */
export function decideRetry(
  failureClass: FailureClass,
  attemptNumber: number
): RetryDecision {
  const rule = RETRY_RULES[failureClass];
  const retriesSoFar = attemptNumber - 1; // Attempt 1 = 0 retries

  if (retriesSoFar >= rule.maxRetries) {
    return {
      shouldRetry: false,
      strategy: rule.strategy === "SAME" || rule.strategy === "RELOAD_AND_RETRY"
        ? "ABANDON"
        : rule.strategy,
      delayMs: 0,
      reason: `Max retries reached (${retriesSoFar}/${rule.maxRetries}) for ${failureClass}`,
      sideEffect: rule.sideEffect,
    };
  }

  // Calculate delay with optional exponential backoff
  let delayMs = rule.baseDelayMs;
  if (rule.backoff === "exponential") {
    delayMs = rule.baseDelayMs * Math.pow(2, retriesSoFar);
  }

  return {
    shouldRetry: true,
    strategy: rule.strategy,
    delayMs,
    reason: `Retry ${retriesSoFar + 1}/${rule.maxRetries} for ${failureClass} (${rule.strategy}, delay ${delayMs}ms)`,
  };
}

/**
 * Returns the maximum number of retries allowed for a failure class.
 */
export function maxRetriesFor(failureClass: FailureClass): number {
  return RETRY_RULES[failureClass].maxRetries;
}
