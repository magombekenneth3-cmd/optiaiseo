import type { ProviderStatus } from "./provider-result";

export type AeoPlatformStatus = ProviderStatus | "NOT_RECORDED";

export interface StoredPlatformStatus {
  status?: unknown;
  visibilityStatus?: unknown;
}

const VALID_STATUSES = new Set<ProviderStatus>([
  "SUCCESS",
  "NO_RESULT",
  "PROVIDER_ERROR",
  "TIMEOUT",
  "NO_API_KEY",
  "CIRCUIT_OPEN",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Resolve the status that applies to the displayed platform score.
 * Grok/Copilot have a separate visibility probe, so their visibilityStatus
 * must take precedence over the general mention-check status.
 */
export function getAeoPlatformStatus(
  breakdown: unknown,
  platform: string,
  visibilityProbe = false,
): AeoPlatformStatus {
  if (!isRecord(breakdown)) return "NOT_RECORDED";

  const entry = breakdown[platform];
  if (!isRecord(entry)) return "NOT_RECORDED";

  const candidate = visibilityProbe ? entry.visibilityStatus : entry.status;
  return typeof candidate === "string" && VALID_STATUSES.has(candidate as ProviderStatus)
    ? candidate as ProviderStatus
    : "NOT_RECORDED";
}
