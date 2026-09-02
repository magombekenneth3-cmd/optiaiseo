/**
 * C.8 Failure Classifier + Retry Policy — Tests
 *
 * Validates:
 * - Correct classification of error types
 * - Classifier is pure analysis (no side effects)
 * - Retry policy is separate from classifier
 * - Retry decisions are deterministic
 * - Exponential backoff for TRANSIENT
 * - Max retries respected
 * - Side effects attached to correct failure classes
 */

import { describe, it, expect } from "vitest";

import { classifyFailure, type FailureClass } from "@/lib/autonomy/failure-classifier";
import { decideRetry, maxRetriesFor } from "@/lib/autonomy/retry-policy";

// ── Classification Tests ────────────────────────────────────────────────────

describe("§1 Failure Classification", () => {
  it("classifies timeout as TRANSIENT", () => {
    const err = new Error("Request timeout after 30000ms");
    expect(classifyFailure(err)).toBe("TRANSIENT");
  });

  it("classifies fetch failed as TRANSIENT", () => {
    const err = new Error("fetch failed");
    expect(classifyFailure(err)).toBe("TRANSIENT");
  });

  it("classifies ECONNREFUSED as TRANSIENT", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    expect(classifyFailure(err)).toBe("TRANSIENT");
  });

  it("classifies 429 as TRANSIENT", () => {
    const err = new Error("Rate limit exceeded");
    expect(classifyFailure(err, { errorMessage: err.message, httpStatus: 429 })).toBe("TRANSIENT");
  });

  it("classifies 503 as TRANSIENT", () => {
    const err = new Error("Service unavailable");
    expect(classifyFailure(err, { errorMessage: err.message, httpStatus: 503 })).toBe("TRANSIENT");
  });

  it("classifies 404 as RESOURCE_GONE", () => {
    const err = new Error("Page not found");
    expect(classifyFailure(err, { errorMessage: err.message, httpStatus: 404 })).toBe("RESOURCE_GONE");
  });

  it("classifies 'does not exist' as RESOURCE_GONE", () => {
    const err = new Error("Blog post does not exist");
    expect(classifyFailure(err)).toBe("RESOURCE_GONE");
  });

  it("classifies 'already exists' as STRATEGY_INVALID", () => {
    const err = new Error("Schema markup already exists on this page");
    expect(classifyFailure(err)).toBe("STRATEGY_INVALID");
  });

  it("classifies 'no changes' as STRATEGY_INVALID", () => {
    const err = new Error("No changes detected — content is identical");
    expect(classifyFailure(err)).toBe("STRATEGY_INVALID");
  });

  it("classifies 401 as EXTERNAL_BLOCKED", () => {
    const err = new Error("Authentication failed");
    expect(classifyFailure(err, { errorMessage: err.message, httpStatus: 401 })).toBe("EXTERNAL_BLOCKED");
  });

  it("classifies 403 as EXTERNAL_BLOCKED", () => {
    const err = new Error("Access denied");
    expect(classifyFailure(err, { errorMessage: err.message, httpStatus: 403 })).toBe("EXTERNAL_BLOCKED");
  });

  it("classifies version mismatch as VERSION_CONFLICT", () => {
    const err = new Error("Concurrent modification: version mismatch");
    expect(classifyFailure(err)).toBe("VERSION_CONFLICT");
  });

  it("classifies P2034 as VERSION_CONFLICT", () => {
    const err = new Error("Transaction failed");
    expect(classifyFailure(err, { errorMessage: err.message, errorCode: "P2034" })).toBe("VERSION_CONFLICT");
  });

  it("classifies budget exceeded as BUDGET_EXCEEDED", () => {
    const err = new Error("Daily limit reached — budget exceeded");
    expect(classifyFailure(err)).toBe("BUDGET_EXCEEDED");
  });

  it("classifies unknown errors as UNKNOWN", () => {
    const err = new Error("Something completely unexpected happened xyz123");
    expect(classifyFailure(err)).toBe("UNKNOWN");
  });
});

// ── Retry Policy Tests ──────────────────────────────────────────────────────

describe("§2 Retry Policy — Deterministic Decisions", () => {
  it("TRANSIENT: allows retry on attempt 1", () => {
    const decision = decideRetry("TRANSIENT", 1);
    expect(decision.shouldRetry).toBe(true);
    expect(decision.strategy).toBe("SAME");
  });

  it("TRANSIENT: allows retry on attempt 2", () => {
    const decision = decideRetry("TRANSIENT", 2);
    expect(decision.shouldRetry).toBe(true);
    expect(decision.strategy).toBe("SAME");
  });

  it("TRANSIENT: allows retry on attempt 3", () => {
    const decision = decideRetry("TRANSIENT", 3);
    expect(decision.shouldRetry).toBe(true);
  });

  it("TRANSIENT: exhausted after attempt 4", () => {
    const decision = decideRetry("TRANSIENT", 4);
    expect(decision.shouldRetry).toBe(false);
  });

  it("TRANSIENT: uses exponential backoff", () => {
    const d1 = decideRetry("TRANSIENT", 1);
    const d2 = decideRetry("TRANSIENT", 2);
    const d3 = decideRetry("TRANSIENT", 3);
    expect(d2.delayMs).toBeGreaterThan(d1.delayMs);
    expect(d3.delayMs).toBeGreaterThan(d2.delayMs);
  });

  it("VERSION_CONFLICT: allows 1 retry with RELOAD_AND_RETRY", () => {
    const d1 = decideRetry("VERSION_CONFLICT", 1);
    expect(d1.shouldRetry).toBe(true);
    expect(d1.strategy).toBe("RELOAD_AND_RETRY");

    const d2 = decideRetry("VERSION_CONFLICT", 2);
    expect(d2.shouldRetry).toBe(false);
  });

  it("EXTERNAL_BLOCKED: never retries, triggers pause_channel", () => {
    const decision = decideRetry("EXTERNAL_BLOCKED", 1);
    expect(decision.shouldRetry).toBe(false);
    expect(decision.sideEffect).toBe("pause_channel");
  });

  it("RESOURCE_GONE: never retries, triggers close_opportunity", () => {
    const decision = decideRetry("RESOURCE_GONE", 1);
    expect(decision.shouldRetry).toBe(false);
    expect(decision.sideEffect).toBe("close_opportunity");
  });

  it("STRATEGY_INVALID: never retries, triggers close_opportunity", () => {
    const decision = decideRetry("STRATEGY_INVALID", 1);
    expect(decision.shouldRetry).toBe(false);
    expect(decision.sideEffect).toBe("close_opportunity");
  });

  it("BUDGET_EXCEEDED: never retries, strategy is DEFER", () => {
    const decision = decideRetry("BUDGET_EXCEEDED", 1);
    expect(decision.shouldRetry).toBe(false);
    expect(decision.strategy).toBe("DEFER");
  });

  it("UNKNOWN: never retries, triggers alert", () => {
    const decision = decideRetry("UNKNOWN", 1);
    expect(decision.shouldRetry).toBe(false);
    expect(decision.sideEffect).toBe("alert");
    expect(decision.strategy).toBe("ABANDON");
  });
});

describe("§3 Separation of Concerns", () => {
  it("classifier returns a FailureClass string, not a retry decision", () => {
    const err = new Error("timeout");
    const result = classifyFailure(err);
    expect(typeof result).toBe("string");
    // Result is a classification, not a boolean or an object with retry info
    const validClasses: FailureClass[] = [
      "TRANSIENT", "RESOURCE_GONE", "STRATEGY_INVALID",
      "EXTERNAL_BLOCKED", "VERSION_CONFLICT", "BUDGET_EXCEEDED", "UNKNOWN",
    ];
    expect(validClasses).toContain(result);
  });

  it("retry policy is deterministic (same inputs → same outputs)", () => {
    const d1 = decideRetry("TRANSIENT", 2);
    const d2 = decideRetry("TRANSIENT", 2);
    expect(d1).toEqual(d2);
  });

  it("maxRetriesFor returns correct limits", () => {
    expect(maxRetriesFor("TRANSIENT")).toBe(3);
    expect(maxRetriesFor("VERSION_CONFLICT")).toBe(1);
    expect(maxRetriesFor("EXTERNAL_BLOCKED")).toBe(0);
    expect(maxRetriesFor("UNKNOWN")).toBe(0);
  });
});
