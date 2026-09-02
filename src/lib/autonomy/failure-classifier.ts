/**
 * Failure Classifier — Pure analysis of what went wrong.
 *
 * The classifier answers: "What happened?"
 * It does NOT answer: "Should we retry?"
 *
 * That separation is critical. The retry policy is a separate,
 * deterministic module that consumes the classification.
 */

import { logger } from "@/lib/logger";

// ── Failure Classes ─────────────────────────────────────────────────────────

export type FailureClass =
  | "TRANSIENT"          // Network timeout, rate limit, temporary unavailability
  | "RESOURCE_GONE"      // Target deleted, moved, or no longer exists
  | "STRATEGY_INVALID"   // Content already updated, schema already present, no-op
  | "EXTERNAL_BLOCKED"   // CMS auth failed, provider permanently rate-limited
  | "VERSION_CONFLICT"   // Another process modified the target concurrently
  | "BUDGET_EXCEEDED"    // Daily limit or LLM/API budget exceeded
  | "UNKNOWN";           // Fail closed — cannot determine cause

// ── Classification Logic ────────────────────────────────────────────────────

export interface ClassificationContext {
  errorMessage: string;
  errorCode?: string;
  httpStatus?: number;
  operationType?: string;
  channel?: string;
}

/**
 * Classifies an execution failure into a semantic category.
 *
 * Classification is based on error signals (message, code, HTTP status).
 * It is purely analytical — no side effects, no retry decisions.
 */
export function classifyFailure(
  error: Error,
  context: ClassificationContext = { errorMessage: error.message }
): FailureClass {
  const msg = (context.errorMessage || error.message || "").toLowerCase();
  const code = context.errorCode || "";
  const status = context.httpStatus;

  // ── Version Conflict ──────────────────────────────────────────────────
  if (
    msg.includes("version mismatch") ||
    msg.includes("concurrent modification") ||
    msg.includes("optimistic lock") ||
    msg.includes("stale") ||
    code === "P2034" // Prisma transaction conflict
  ) {
    return "VERSION_CONFLICT";
  }

  // ── Budget Exceeded ───────────────────────────────────────────────────
  if (
    msg.includes("budget exceeded") ||
    msg.includes("budget exhausted") ||
    msg.includes("daily limit") ||
    msg.includes("quota exceeded")
  ) {
    return "BUDGET_EXCEEDED";
  }

  // ── Resource Gone ─────────────────────────────────────────────────────
  if (
    status === 404 ||
    status === 410 ||
    msg.includes("not found") ||
    msg.includes("deleted") ||
    msg.includes("does not exist") ||
    msg.includes("no longer available")
  ) {
    return "RESOURCE_GONE";
  }

  // ── Strategy Invalid ──────────────────────────────────────────────────
  if (
    msg.includes("already exists") ||
    msg.includes("already present") ||
    msg.includes("no changes") ||
    msg.includes("no-op") ||
    msg.includes("already applied") ||
    msg.includes("identical")
  ) {
    return "STRATEGY_INVALID";
  }

  // ── External Blocked (auth/permanent) ─────────────────────────────────
  if (
    status === 401 ||
    status === 403 ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("authentication failed") ||
    msg.includes("invalid credentials") ||
    msg.includes("api key") ||
    msg.includes("access denied") ||
    msg.includes("permanently rate limited")
  ) {
    return "EXTERNAL_BLOCKED";
  }

  // ── Transient (network/timeout/temporary) ─────────────────────────────
  if (
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("enotfound") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("service unavailable") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("retry after")
  ) {
    return "TRANSIENT";
  }

  // ── Unknown — fail closed ─────────────────────────────────────────────
  logger.warn("[FailureClassifier] Unrecognized failure — classified as UNKNOWN", {
    message: msg.slice(0, 200),
    code,
    httpStatus: status,
  });

  return "UNKNOWN";
}
