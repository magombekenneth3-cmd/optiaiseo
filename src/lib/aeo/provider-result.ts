/**
 * P0.8 — ProviderResult Pattern
 *
 * Enforces the distinction between observed data and provider failure
 * across all external API callers (AEO checkers, backlinks, SERP).
 *
 * Semantic contract:
 *   SUCCESS        — provider responded; data is authoritative
 *   NO_RESULT      — provider succeeded but found nothing relevant
 *   PROVIDER_ERROR — provider returned an error (4xx, 5xx, parse failure)
 *   TIMEOUT        — provider didn't respond within the deadline
 *   NO_API_KEY     — integration isn't configured
 *   CIRCUIT_OPEN   — system intentionally prevented the call
 */

export type ProviderStatus =
  | "SUCCESS"
  | "NO_RESULT"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "NO_API_KEY"
  | "CIRCUIT_OPEN";

/**
 * Wraps any external API call result with provenance metadata.
 * `data` is non-null only when status === "SUCCESS" or "NO_RESULT".
 */
export interface ProviderResult<T> {
  status: ProviderStatus;
  data: T | null;
  error?: string;
  httpStatus?: number;
  provider: string;
  durationMs: number;
}

/**
 * Structured telemetry payload for provider calls.
 * Logged on every external API call — never includes API keys or auth headers.
 */
export interface ProviderTelemetry {
  [key: string]: unknown;
  provider: string;
  operation: string;
  status: ProviderStatus;
  httpStatus?: number;
  durationMs: number;
  error?: string;
}

/**
 * Classifies a caught error into the appropriate ProviderStatus.
 */
export function classifyError(error: unknown): ProviderStatus {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return "TIMEOUT";
    }
  }
  return "PROVIDER_ERROR";
}
