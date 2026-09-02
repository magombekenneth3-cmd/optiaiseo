/**
 * Operating Modes — Immutable semantics for autonomous execution authorization.
 *
 * operatingMode is the SOLE AUTHORITY for the maximum autonomous tier.
 * No separate field can escalate beyond what the mode permits.
 *
 * | Mode          | Max Tier | Description                                           |
 * |---------------|----------|-------------------------------------------------------|
 * | REPORT_ONLY   | 0        | No mutations. Proposals generated for review only.    |
 * | SUPERVISED    | 1        | Tier 1 auto-executes. Tier 2+ requires approval.      |
 * | AUTOPILOT     | 2        | Tier 1+2 auto-execute. Tier 3 requires approval.      |
 */

import { logger } from "@/lib/logger";

// ── Operating Mode Types ────────────────────────────────────────────────────

export type OperatingMode = "REPORT_ONLY" | "SUPERVISED" | "AUTOPILOT";

export const OPERATING_MODES: readonly OperatingMode[] = [
  "REPORT_ONLY",
  "SUPERVISED",
  "AUTOPILOT",
] as const;

/**
 * Maximum safety tier that each mode allows for autonomous execution.
 * This is the root authority — cannot be overridden upward.
 */
const MODE_TIER_LIMIT: Record<OperatingMode, number> = {
  REPORT_ONLY: 0, // No autonomous mutations whatsoever
  SUPERVISED: 1,  // Tier 1 only (low-risk, auto-reversible)
  AUTOPILOT: 2,   // Tier 1 + 2 (approval-class actions auto-execute within budget)
};

// ── Core Functions ──────────────────────────────────────────────────────────

/**
 * Returns the maximum autonomous tier for a given operating mode.
 * This is the immutable, non-negotiable limit.
 */
export function modeTierLimit(mode: OperatingMode): number {
  const limit = MODE_TIER_LIMIT[mode];
  if (limit === undefined) {
    // Fail closed: unknown mode → no autonomous execution
    logger.error("[OperatingModes] Unknown operating mode — defaulting to 0", { mode });
    return 0;
  }
  return limit;
}

/**
 * Computes the effective tier limit for a site.
 *
 * The administrative tierCeiling can RESTRICT the mode's limit
 * but can NEVER EXPAND it beyond what the mode permits.
 *
 * Example:
 *   mode = AUTOPILOT (limit = 2), tierCeiling = 1 → effective = 1  (restricted)
 *   mode = SUPERVISED (limit = 1), tierCeiling = 2 → effective = 1  (cannot escalate)
 *   mode = REPORT_ONLY (limit = 0), tierCeiling = 3 → effective = 0 (cannot escalate)
 */
export function effectiveTierLimit(site: {
  operatingMode: string;
  tierCeiling?: number | null;
}): number {
  const mode = site.operatingMode as OperatingMode;
  const modeLimit = modeTierLimit(mode);

  if (site.tierCeiling != null && site.tierCeiling >= 0) {
    return Math.min(modeLimit, site.tierCeiling);
  }

  return modeLimit;
}

/**
 * Checks whether a safety tier is authorized for autonomous execution
 * under the given operating mode and optional ceiling.
 */
export function isTierAuthorized(
  safetyTier: number,
  site: { operatingMode: string; tierCeiling?: number | null }
): boolean {
  return safetyTier <= effectiveTierLimit(site);
}

/**
 * Returns true if the site is in REPORT_ONLY mode.
 * Used for multi-layer enforcement — this check appears in both
 * the autonomy gate AND the mutation lifecycle.
 */
export function isReportOnly(operatingMode: string): boolean {
  return operatingMode === "REPORT_ONLY";
}

/**
 * Validates that an operating mode string is a known mode.
 * Returns the typed mode or null for unknown values.
 */
export function parseOperatingMode(mode: string): OperatingMode | null {
  if (OPERATING_MODES.includes(mode as OperatingMode)) {
    return mode as OperatingMode;
  }
  return null;
}
