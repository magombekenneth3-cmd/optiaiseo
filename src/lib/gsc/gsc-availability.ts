/**
 * GSC availability semantics.
 *
 * This module defines a discriminated union for GSC data results that makes
 * invalid states impossible:
 *
 *   AVAILABLE / NO_DATA  → data is present (may be empty but authoritative)
 *   NOT_CONNECTED etc.   → data is null (we don't know the true state)
 *
 * The key invariant is:
 *   API_ERROR ≠ NO_DATA ≠ NOT_CONNECTED
 *
 * A real zero-result GSC query means "there are no opportunities."
 * An API failure means "we don't know whether opportunities exist."
 * Those must not enter the same decision branch.
 */

import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type GscDataStatus =
    | "AVAILABLE"
    | "NO_DATA"
    | "NOT_CONNECTED"
    | "AUTH_REVOKED"
    | "PROPERTY_UNAUTHORIZED"
    | "API_ERROR"
    | "RATE_LIMITED";

/**
 * Discriminated union — invalid states are impossible.
 *
 * When status is AVAILABLE or NO_DATA, data is always present (T).
 * When status indicates a failure, data is always null.
 */
export type GscDataResult<T> =
    | {
          status: "AVAILABLE";
          data: T;
      }
    | {
          status: "NO_DATA";
          data: T;
      }
    | {
          status: "NOT_CONNECTED" | "AUTH_REVOKED" | "PROPERTY_UNAUTHORIZED" | "API_ERROR" | "RATE_LIMITED";
          data: null;
          error?: string;
      };

// ─────────────────────────────────────────────────────────────────────────────
// Error classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify a GSC error into a typed status.
 *
 * Uses the error messages already thrown by getUserGscToken() and other
 * GSC library functions. This centralizes error classification so callers
 * don't need to string-match independently.
 */
export function classifyGscError(err: unknown): Exclude<GscDataStatus, "AVAILABLE" | "NO_DATA"> {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

    // Not connected
    if (msg.includes("gsc_not_connected")) return "NOT_CONNECTED";

    // Auth revoked / refresh failed
    if (
        msg.includes("gsc_refresh_token_missing") ||
        msg.includes("gsc_token_refresh_failed") ||
        msg.includes("gsc_reauthorization_required") ||
        msg.includes("invalid_grant")
    ) {
        return "AUTH_REVOKED";
    }

    // Property authorization
    if (
        msg.includes("gsc_property_unauthorized") ||
        msg.includes("403") ||
        msg.includes("forbidden")
    ) {
        return "PROPERTY_UNAUTHORIZED";
    }

    // Rate limiting
    if (
        msg.includes("429") ||
        msg.includes("rate_limit") ||
        msg.includes("quota")
    ) {
        return "RATE_LIMITED";
    }

    // Everything else is a generic API error
    return "API_ERROR";
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log a GSC failure with appropriate severity.
 *
 * NOT_CONNECTED is expected (info level) — user hasn't connected GSC.
 * AUTH_REVOKED is actionable (warn) — user needs to reauthorize.
 * API_ERROR / RATE_LIMITED are concerning (warn) — temporary degradation.
 * PROPERTY_UNAUTHORIZED is unusual (warn) — property mismatch.
 */
export function logGscFailure(
    context: string,
    status: GscDataStatus,
    meta?: Record<string, unknown>,
): void {
    const message = `[${context}] GSC unavailable`;
    const payload = { gscStatus: status, ...meta };

    if (status === "NOT_CONNECTED") {
        logger.info(message, payload);
    } else {
        logger.warn(message, payload);
    }
}
