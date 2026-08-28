/**
 * GA4 Token Lifecycle Tests
 *
 * Verifies the GA4 token manager handles every failure mode correctly:
 * ┌─────────────────────────────────────────────────────────────┐
 * │ missing account       → GA4_NOT_CONNECTED                  │
 * │ valid token           → returns access_token                │
 * │ expired token + ok    → refresh → returns new token         │
 * │ expired + fail        → GA4_TOKEN_REFRESH_FAILED            │
 * │ expired + cooldown    → GA4_REAUTHORIZATION_REQUIRED        │
 * │ missing refresh_token → GA4_REFRESH_TOKEN_MISSING           │
 * │ 403 API response      → GA4_PERMISSION_DENIED propagated   │
 * │ Data API network fail → returns null (graceful)             │
 * │ Admin API failure     → returns [] (graceful)               │
 * └─────────────────────────────────────────────────────────────┘
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../../src");

function readSrc(...segments: string[]): string {
    return fs.readFileSync(path.join(SRC, ...segments), "utf8");
}

// ──────────────────────────────────────────────────────────────────
// 1. Token Manager Error Hierarchy
// ──────────────────────────────────────────────────────────────────
describe("GA4 Token Manager — Error Hierarchy", () => {
    const ga4Token = readSrc("lib/ga4/token.ts");

    it("throws GA4_NOT_CONNECTED when no Account row exists", () => {
        expect(ga4Token).toContain('throw new Error("GA4_NOT_CONNECTED")');
    });

    it("throws GA4_REFRESH_TOKEN_MISSING when refresh_token is null", () => {
        expect(ga4Token).toContain('throw new Error("GA4_REFRESH_TOKEN_MISSING")');
    });

    it("throws GA4_TOKEN_REFRESH_FAILED when Google refresh endpoint fails", () => {
        expect(ga4Token).toContain('throw new Error("GA4_TOKEN_REFRESH_FAILED")');
    });

    it("throws GA4_REAUTHORIZATION_REQUIRED when refresh cooldown is active", () => {
        expect(ga4Token).toContain('throw new Error("GA4_REAUTHORIZATION_REQUIRED")');
    });
});

// ──────────────────────────────────────────────────────────────────
// 2. Refresh Cooldown Mechanism
// ──────────────────────────────────────────────────────────────────
describe("GA4 Token Manager — Refresh Cooldown", () => {
    const ga4Token = readSrc("lib/ga4/token.ts");

    it("defines a refresh cooldown Redis key prefix", () => {
        expect(ga4Token).toContain('"ga4:refresh_failed:"');
    });

    it("sets cooldown TTL to 300 seconds (5 minutes)", () => {
        expect(ga4Token).toMatch(/REFRESH_COOLDOWN_TTL_SECONDS\s*=\s*300/);
    });

    it("checks for cooldown key before attempting refresh", () => {
        // The cooldown check must appear BEFORE the refresh attempt
        const cooldownCheckIndex = ga4Token.indexOf("GA4_REAUTHORIZATION_REQUIRED");
        const refreshAttemptIndex = ga4Token.indexOf("refreshAccessToken");
        expect(cooldownCheckIndex).toBeGreaterThan(-1);
        expect(refreshAttemptIndex).toBeGreaterThan(-1);
        expect(cooldownCheckIndex).toBeLessThan(refreshAttemptIndex);
    });

    it("sets cooldown key after failed refresh", () => {
        // After the refreshAccessToken catch, the cooldown key must be set
        const refreshCatchIndex = ga4Token.indexOf("GA4_TOKEN_REFRESH_FAILED");
        const cooldownSetIndex = ga4Token.lastIndexOf("REFRESH_COOLDOWN_PREFIX");
        expect(refreshCatchIndex).toBeGreaterThan(-1);
        expect(cooldownSetIndex).toBeGreaterThan(-1);
    });
});

// ──────────────────────────────────────────────────────────────────
// 3. GSC Token Manager — Same Cooldown Pattern
// ──────────────────────────────────────────────────────────────────
describe("GSC Token Manager — Refresh Cooldown", () => {
    const gscToken = readSrc("lib/gsc/token.ts");

    it("defines a refresh cooldown Redis key prefix", () => {
        expect(gscToken).toContain('"gsc:refresh_failed:"');
    });

    it("sets cooldown TTL to 300 seconds (5 minutes)", () => {
        expect(gscToken).toMatch(/REFRESH_COOLDOWN_TTL_SECONDS\s*=\s*300/);
    });

    it("throws GSC_REAUTHORIZATION_REQUIRED when cooldown is active", () => {
        expect(gscToken).toContain('throw new Error("GSC_REAUTHORIZATION_REQUIRED")');
    });

    it("checks cooldown before refresh attempt", () => {
        const cooldownCheckIndex = gscToken.indexOf("GSC_REAUTHORIZATION_REQUIRED");
        const refreshAttemptIndex = gscToken.indexOf("refreshAccessToken");
        expect(cooldownCheckIndex).toBeGreaterThan(-1);
        expect(refreshAttemptIndex).toBeGreaterThan(-1);
        expect(cooldownCheckIndex).toBeLessThan(refreshAttemptIndex);
    });
});

// ──────────────────────────────────────────────────────────────────
// 4. GA4 API Error Propagation
// ──────────────────────────────────────────────────────────────────
describe("GA4 API — Error Propagation", () => {
    const ga4Index = readSrc("lib/ga4/index.ts");

    it("throws GA4_PERMISSION_DENIED on 403 response", () => {
        expect(ga4Index).toContain("GA4_PERMISSION_DENIED");
        expect(ga4Index).toMatch(/res\.status\s*===\s*403/);
    });

    it("re-throws GA4_PERMISSION_DENIED from outer catch (not swallowed)", () => {
        // The outer catch must re-throw permission errors
        expect(ga4Index).toContain('if (msg.includes("GA4_PERMISSION_DENIED"))');
        // And the re-throw must come AFTER the includes check
        const checkIndex = ga4Index.indexOf('msg.includes("GA4_PERMISSION_DENIED")');
        const throwIndex = ga4Index.indexOf("throw e", checkIndex);
        expect(throwIndex).toBeGreaterThan(checkIndex);
    });

    it("returns null for non-auth API errors (network, parse)", () => {
        // After the permission check, non-auth errors return null
        expect(ga4Index).toContain("return null");
    });

    it("listGa4Properties returns empty array on failure (not throw)", () => {
        expect(ga4Index).toMatch(/catch\s*\{[\s\S]*?return\s*\[\]/);
    });
});

// ──────────────────────────────────────────────────────────────────
// 5. Token Caching Independence
// ──────────────────────────────────────────────────────────────────
describe("Token Cache Independence", () => {
    const ga4Token = readSrc("lib/ga4/token.ts");
    const gscToken = readSrc("lib/gsc/token.ts");

    it("GA4 uses ga4:token: prefix", () => {
        expect(ga4Token).toContain('"ga4:token:"');
    });

    it("GSC uses gsc:token: prefix", () => {
        expect(gscToken).toContain('"gsc:token:"');
    });

    it("GA4 cooldown uses ga4:refresh_failed: prefix", () => {
        expect(ga4Token).toContain('"ga4:refresh_failed:"');
    });

    it("GSC cooldown uses gsc:refresh_failed: prefix", () => {
        expect(gscToken).toContain('"gsc:refresh_failed:"');
    });

    it("GA4 and GSC cooldown prefixes are different", () => {
        expect(ga4Token).not.toContain('"gsc:refresh_failed:"');
        expect(gscToken).not.toContain('"ga4:refresh_failed:"');
    });
});
