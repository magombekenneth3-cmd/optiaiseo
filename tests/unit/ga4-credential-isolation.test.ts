/**
 * GA4 Credential Isolation Tests
 *
 * Verifies the architectural invariant:
 *   google-gsc → GSC only
 *   google-ga4 → GA4 only
 *
 * These are structural tests that assert the wiring is correct by
 * inspecting the source files directly. This catches regressions where
 * someone accidentally crosses the credential boundary.
 *
 * Test matrix:
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ getUserGa4Token never selects google-gsc except legacy fallback │
 * │ GA4 metrics use getUserGa4Token (not getUserGscToken)           │
 * │ Property discovery uses getUserGa4Token                         │
 * │ disconnectGa4 leaves google-gsc untouched                       │
 * │ disconnectGsc leaves google-ga4 untouched                       │
 * │ Auth provider scopes are correctly isolated                     │
 * │ Integration status queries dedicated google-ga4 Account         │
 * │ Settings UI connects via google-ga4 provider                    │
 * │ Legacy migration path is explicitly scoped                      │
 * └──────────────────────────────────────────────────────────────────┘
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../../src");

/** Helper: read a source file relative to SRC */
function readSrc(...segments: string[]): string {
    return fs.readFileSync(path.join(SRC, ...segments), "utf8");
}

// ──────────────────────────────────────────────────────────────────
// 1. Auth Provider Scope Isolation
// ──────────────────────────────────────────────────────────────────
describe("Auth Provider Scope Isolation", () => {
    const auth = readSrc("lib/auth.ts");

    it("google-gsc provider does NOT include analytics.readonly scope", () => {
        // Extract the google-gsc provider block
        const gscMatch = auth.match(
            /id:\s*"google-gsc"[\s\S]*?scope:\s*"([^"]+)"/
        );
        expect(gscMatch).toBeTruthy();
        const gscScope = gscMatch![1];
        expect(gscScope).not.toContain("analytics.readonly");
        // It should still have the GSC scopes
        expect(gscScope).toContain("webmasters");
        expect(gscScope).toContain("indexing");
    });

    it("google-ga4 provider exists with analytics.readonly scope", () => {
        const ga4Match = auth.match(
            /id:\s*"google-ga4"[\s\S]*?scope:\s*"([^"]+)"/
        );
        expect(ga4Match).toBeTruthy();
        const ga4Scope = ga4Match![1];
        expect(ga4Scope).toContain("analytics.readonly");
    });

    it("google-ga4 provider does NOT include webmasters or indexing scope", () => {
        const ga4Match = auth.match(
            /id:\s*"google-ga4"[\s\S]*?scope:\s*"([^"]+)"/
        );
        expect(ga4Match).toBeTruthy();
        const ga4Scope = ga4Match![1];
        expect(ga4Scope).not.toContain("webmasters");
        expect(ga4Scope).not.toContain("indexing");
    });

    it("google-gsc provider is named 'Google Search Console' (not 'Search & Analytics')", () => {
        expect(auth).toMatch(/id:\s*"google-gsc"[\s\S]*?name:\s*"Google Search Console"/);
        expect(auth).not.toContain('"Google Search & Analytics"');
    });
});

// ──────────────────────────────────────────────────────────────────
// 2. GA4 Token Manager — Dedicated Module
// ──────────────────────────────────────────────────────────────────
describe("GA4 Token Manager (src/lib/ga4/token.ts)", () => {
    const ga4Token = readSrc("lib/ga4/token.ts");

    it("module exists and exports getUserGa4Token", () => {
        expect(ga4Token).toContain("export async function getUserGa4Token");
    });

    it("primary lookup queries provider: google-ga4", () => {
        expect(ga4Token).toContain('provider: "google-ga4"');
    });

    it("legacy fallback is explicitly guarded by analytics.readonly scope check", () => {
        // The fallback path MUST check the scope before using the legacy account
        expect(ga4Token).toContain('analytics.readonly');
        expect(ga4Token).toContain("acc = null");
    });

    it("uses its own Redis cache prefix (ga4:token:), not gsc:token:", () => {
        expect(ga4Token).toContain('"ga4:token:"');
        expect(ga4Token).not.toContain('"gsc:token:"');
    });

    it("exports invalidateGa4CachedToken for disconnect", () => {
        expect(ga4Token).toContain("export async function invalidateGa4CachedToken");
    });
});

// ──────────────────────────────────────────────────────────────────
// 3. GA4 Consumers Use getUserGa4Token (Not getUserGscToken)
// ──────────────────────────────────────────────────────────────────
describe("GA4 consumers use getUserGa4Token", () => {
    it("unified-analytics.ts imports getUserGa4Token for GA4 metrics", () => {
        const unified = readSrc("app/actions/unified-analytics.ts");
        expect(unified).toContain('import { getUserGa4Token } from "@/lib/ga4/token"');
        expect(unified).toContain("getUserGa4Token(site.userId)");
    });

    it("unified-analytics.ts still uses getUserGscToken for GSC data", () => {
        const unified = readSrc("app/actions/unified-analytics.ts");
        expect(unified).toContain('import { getUserGscToken } from "@/lib/gsc/token"');
    });

    it("ga4/properties/route.ts imports getUserGa4Token (not getUserGscToken)", () => {
        const properties = readSrc("app/api/ga4/properties/route.ts");
        expect(properties).toContain('import { getUserGa4Token } from "@/lib/ga4/token"');
        expect(properties).not.toContain("getUserGscToken");
    });

    it("ga4/properties error message references 'Google Analytics' (not Search Console)", () => {
        const properties = readSrc("app/api/ga4/properties/route.ts");
        expect(properties).toContain("connect Google Analytics");
        expect(properties).not.toContain("re-connect Google Search Console");
    });
});

// ──────────────────────────────────────────────────────────────────
// 4. Disconnect Isolation
// ──────────────────────────────────────────────────────────────────
describe("Disconnect Isolation", () => {
    describe("disconnectGsc leaves google-ga4 untouched", () => {
        const gscToken = readSrc("lib/gsc/token.ts");

        it("disconnectGsc only deletes provider: google-gsc", () => {
            // Should delete google-gsc accounts
            expect(gscToken).toMatch(/deleteMany[\s\S]*?provider:\s*"google-gsc"/);
        });

        it("disconnectGsc does NOT clear ga4PropertyId", () => {
            // The old code did: site.updateMany({ data: { ga4PropertyId: null } })
            // This should no longer be there
            expect(gscToken).not.toContain("ga4PropertyId: null");
        });

        it("disconnectGsc has explicit comment about GA4 independence", () => {
            expect(gscToken).toContain(
                "GA4 property IDs are intentionally NOT cleared here"
            );
        });
    });

    describe("disconnectGa4 leaves google-gsc untouched", () => {
        const ga4Disconnect = readSrc("app/api/settings/disconnect-ga4/route.ts");

        it("disconnect-ga4 route exists with POST handler", () => {
            expect(ga4Disconnect).toContain("export async function POST");
        });

        it("disconnect-ga4 only deletes provider: google-ga4", () => {
            expect(ga4Disconnect).toContain('provider: "google-ga4"');
            expect(ga4Disconnect).not.toContain('provider: "google-gsc"');
        });

        it("disconnect-ga4 clears ga4PropertyId from sites", () => {
            expect(ga4Disconnect).toContain("ga4PropertyId: null");
        });

        it("disconnect-ga4 invalidates GA4 cache (not GSC cache)", () => {
            expect(ga4Disconnect).toContain("invalidateGa4CachedToken");
            expect(ga4Disconnect).not.toContain("invalidateCachedToken");
        });

        it("disconnect-ga4 does NOT touch gscConnected", () => {
            expect(ga4Disconnect).not.toContain("gscConnected");
        });
    });
});

// ──────────────────────────────────────────────────────────────────
// 5. Integration Status Derives GA4 from Account Row
// ──────────────────────────────────────────────────────────────────
describe("Integration Status queries dedicated google-ga4 Account", () => {
    const status = readSrc("app/api/integrations/status/route.ts");

    it("queries google-ga4 Account in parallel with google-gsc", () => {
        expect(status).toContain('provider: "google-ga4"');
        expect(status).toContain("ga4Account");
    });

    it("derives ga4Connected from ga4Account existence (not user flag)", () => {
        expect(status).toContain("ga4HasDedicatedAccount");
        expect(status).not.toContain("user.ga4Connected");
    });

    it("preserves legacy fallback detection via ga4LegacyScope", () => {
        expect(status).toContain("ga4LegacyScope");
        expect(status).toContain("analytics.readonly");
    });

    it("error message directs to 'Connect Google Analytics separately'", () => {
        expect(status).toContain("Connect Google Analytics separately");
        expect(status).not.toContain("Re-connect Google Search Console");
    });
});

// ──────────────────────────────────────────────────────────────────
// 6. Settings UI — Independent GA4 Connect/Disconnect
// ──────────────────────────────────────────────────────────────────
describe("Settings UI uses google-ga4 provider for connect", () => {
    const panel = readSrc("app/dashboard/settings/IntegrationsPanel.tsx");

    it("GA4 card has connectAction pointing to google-ga4 provider", () => {
        expect(panel).toContain("/api/auth/signin/google-ga4");
    });

    it("GA4 card has onDisconnect calling disconnect-ga4 route", () => {
        expect(panel).toContain("/api/settings/disconnect-ga4");
    });
});

// ──────────────────────────────────────────────────────────────────
// 7. Legacy Migration Path — Explicit & Bounded
// ──────────────────────────────────────────────────────────────────
describe("Legacy Migration Path", () => {
    const ga4Token = readSrc("lib/ga4/token.ts");

    it("legacy fallback only activates when google-ga4 Account is absent", () => {
        // In the code: primary query for google-ga4 must appear before the
        // fallback query for google-gsc/google.
        const primaryIndex = ga4Token.indexOf('provider: "google-ga4"');
        // The fallback query uses provider: { in: ["google-gsc" ...
        const fallbackIndex = ga4Token.indexOf('provider: { in:');
        expect(primaryIndex).toBeGreaterThan(-1);
        expect(fallbackIndex).toBeGreaterThan(-1);
        expect(fallbackIndex).toBeGreaterThan(primaryIndex);
    });

    it("legacy fallback rejects google-gsc accounts without analytics.readonly", () => {
        // Must set acc = null if scope doesn't include analytics.readonly
        expect(ga4Token).toContain('!acc.scope?.includes("analytics.readonly")');
    });

    it("legacy fallback is documented as migration bridge in JSDoc", () => {
        expect(ga4Token).toContain("Legacy fallback");
        expect(ga4Token).toContain("legacy fallback ensures existing users");
    });
});

// ──────────────────────────────────────────────────────────────────
// 8. Cross-contamination Guard — No Stale References
// ──────────────────────────────────────────────────────────────────
describe("Cross-contamination guard", () => {
    it("ga4/token.ts never imports from gsc/token.ts", () => {
        const ga4Token = readSrc("lib/ga4/token.ts");
        expect(ga4Token).not.toContain("@/lib/gsc/token");
        expect(ga4Token).not.toContain("getUserGscToken");
    });

    it("gsc/token.ts never imports from ga4/token.ts", () => {
        const gscToken = readSrc("lib/gsc/token.ts");
        expect(gscToken).not.toContain("@/lib/ga4/token");
        expect(gscToken).not.toContain("getUserGa4Token");
    });

    it("disconnect-ga4 route never references gsc/token.ts", () => {
        const disconnect = readSrc("app/api/settings/disconnect-ga4/route.ts");
        expect(disconnect).not.toContain("@/lib/gsc/token");
    });
});
