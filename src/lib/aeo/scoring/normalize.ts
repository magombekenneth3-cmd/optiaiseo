/**
 * scoring/normalize.ts — Check normalization utilities.
 *
 * Converts raw check arrays (which may only have `passed: boolean`) into
 * fully-typed AeoCheck[] with `status: CheckStatus` populated.
 * Also provides the scorable-check filter that excludes NOT_APPLICABLE / UNKNOWN.
 */

import type { AeoCheck, CheckStatus } from "../index";

/**
 * Normalizes a raw check array by ensuring every check has a `status` field.
 * Legacy checks only have `passed: boolean` — this derives status from it.
 *
 * Mutates in-place for performance (called on an array being constructed)
 * and returns the typed array.
 */
export function normalizeChecks(
    checks: (Omit<AeoCheck, "status"> & { status?: CheckStatus })[]
): AeoCheck[] {
    for (const check of checks) {
        if (!check.status) {
            check.status = check.passed ? "PASS" : "FAIL";
        }
    }
    return checks as AeoCheck[];
}

/**
 * Returns only checks eligible for scoring — excludes NOT_APPLICABLE and UNKNOWN.
 *
 * Rationale: NOT_APPLICABLE checks (e.g., geo checks for a global SaaS) shouldn't
 * drag the denominator up. UNKNOWN checks (e.g., provider timeout) shouldn't
 * penalize the score either.
 */
export function scorableChecks(checks: AeoCheck[]): AeoCheck[] {
    return checks.filter(
        (c) => c.status !== "NOT_APPLICABLE" && c.status !== "UNKNOWN"
    );
}

/**
 * Returns true if a check counts as "earned" for scoring.
 * PASS and PARTIAL both count — PARTIAL is used for checks that are partially met
 * (e.g., schema present but missing recommended fields).
 */
export function isCheckEarned(check: AeoCheck): boolean {
    return check.status === "PASS" || check.status === "PARTIAL";
}
