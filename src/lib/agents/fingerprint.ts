// =============================================================================
// FINDING FINGERPRINT — Deterministic identity for underlying issues
//
// The same problem (e.g. "MISSING_META_DESCRIPTION on /pricing") always
// produces the same fingerprint regardless of when it was detected.
//
// This enables lifecycle tracking:
//   Run 1: OPEN
//   Run 2: same fingerprint → still OPEN
//   Run 3: not observed → RESOLVED
//   Run 4: observed again → REOPENED
// =============================================================================

import { createHash } from "node:crypto";

/**
 * Create a deterministic SHA-256 fingerprint for a finding.
 *
 * The fingerprint is NOT globally unique — the same underlying issue
 * legitimately appears in multiple AgentRuns. Instead, fingerprints are
 * used to resolve/reopen persistent issues across runs.
 *
 * @example
 * ```ts
 * createFindingFingerprint({
 *   siteId: "site_abc",
 *   type: "MISSING_META_DESCRIPTION",
 *   resourceType: "PAGE",
 *   resourceId: "https://example.com/pricing",
 * });
 * // → "a3f2b1c4d5e6..."
 * ```
 */
export function createFindingFingerprint(input: {
  siteId: string;
  type: string;
  resourceType?: string;
  resourceId?: string;
}): string {
  const canonical = [
    input.siteId,
    input.type,
    input.resourceType ?? "",
    input.resourceId ?? "",
  ].join(":");

  return createHash("sha256").update(canonical).digest("hex");
}
