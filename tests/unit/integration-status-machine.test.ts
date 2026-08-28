/**
 * Integration Status State Machine Tests
 *
 * Verifies the formalized status model:
 *
 * GSC:
 *   not_connected              → no google-gsc Account
 *   connected                  → Account + refresh_token
 *   reauthorization_required   → Account, no refresh_token
 *
 * GA4:
 *   not_connected              → no google-ga4 Account (and no legacy)
 *   no_property                → Account exists, no ga4PropertyId
 *   connected                  → Account + property
 *   reauthorization_required   → Account, no refresh_token
 *
 * Invariant:
 *   connected === (status === "connected")
 *
 * Test matrix:
 * ┌──────────────────────────────────────────────────────────────┐
 * │ IntegrationStatus interface has status field                 │
 * │ IntegrationStatusState type is exported                      │
 * │ GSC uses state machine logic                                 │
 * │ GA4 uses state machine logic                                 │
 * │ boolean connected derives from status                        │
 * │ All integrations have status field                           │
 * │ refresh_token included in account queries                    │
 * └──────────────────────────────────────────────────────────────┘
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../../src");

function readSrc(...segments: string[]): string {
    return fs.readFileSync(path.join(SRC, ...segments), "utf8");
}

const statusRoute = readSrc("app/api/integrations/status/route.ts");

// ──────────────────────────────────────────────────────────────────
// 1. Interface shape
// ──────────────────────────────────────────────────────────────────
describe("IntegrationStatus interface", () => {
    it("exports IntegrationStatusState type", () => {
        expect(statusRoute).toContain("export type IntegrationStatusState");
    });

    it("IntegrationStatusState includes all 5 states", () => {
        expect(statusRoute).toContain('"connected"');
        expect(statusRoute).toContain('"not_connected"');
        expect(statusRoute).toContain('"reauthorization_required"');
        expect(statusRoute).toContain('"no_property"');
        expect(statusRoute).toContain('"property_access_denied"');
    });

    it("IntegrationStatus has status field of type IntegrationStatusState", () => {
        expect(statusRoute).toContain("status: IntegrationStatusState");
    });

    it("IntegrationStatus still has connected boolean (deprecated)", () => {
        expect(statusRoute).toMatch(/connected:\s*boolean/);
    });
});

// ──────────────────────────────────────────────────────────────────
// 2. GSC state machine
// ──────────────────────────────────────────────────────────────────
describe("GSC status state machine", () => {
    it("declares gscStatus variable with IntegrationStatusState type", () => {
        expect(statusRoute).toContain("let gscStatus: IntegrationStatusState");
    });

    it("not_connected when no gscAccount", () => {
        expect(statusRoute).toMatch(/if\s*\(!gscAccount\)[\s\S]*?gscStatus\s*=\s*"not_connected"/);
    });

    it("reauthorization_required when no refresh_token", () => {
        expect(statusRoute).toMatch(/!gscAccount\.refresh_token[\s\S]*?gscStatus\s*=\s*"reauthorization_required"/);
    });

    it("connected as the default state", () => {
        expect(statusRoute).toContain('gscStatus = "connected"');
    });

    it("GSC connected boolean derives from status", () => {
        expect(statusRoute).toContain('connected: gscStatus === "connected"');
    });
});

// ──────────────────────────────────────────────────────────────────
// 3. GA4 state machine
// ──────────────────────────────────────────────────────────────────
describe("GA4 status state machine", () => {
    it("declares ga4Status variable", () => {
        expect(statusRoute).toContain("let ga4Status: IntegrationStatusState");
    });

    it("not_connected when no credentials", () => {
        expect(statusRoute).toMatch(/if\s*\(!ga4HasCredentials\)[\s\S]*?ga4Status\s*=\s*"not_connected"/);
    });

    it("reauthorization_required when dedicated account has no refresh_token", () => {
        expect(statusRoute).toMatch(/!ga4Account.*refresh_token[\s\S]*?ga4Status\s*=\s*"reauthorization_required"/);
    });

    it("no_property when credentials exist but no ga4PropertyId", () => {
        expect(statusRoute).toMatch(/!site\?\.ga4PropertyId[\s\S]*?ga4Status\s*=\s*"no_property"/);
    });

    it("connected as the full-path state", () => {
        expect(statusRoute).toContain('ga4Status = "connected"');
    });

    it("GA4 connected boolean derives from status", () => {
        expect(statusRoute).toContain('ga4Status === "connected"');
    });
});

// ──────────────────────────────────────────────────────────────────
// 4. Account queries include refresh_token
// ──────────────────────────────────────────────────────────────────
describe("Account queries include refresh_token for state machine", () => {
    it("GSC account query selects refresh_token", () => {
        // Find the google-gsc query and check it includes refresh_token
        const gscQueryMatch = statusRoute.match(
            /provider:\s*"google-gsc"[\s\S]*?select:\s*\{([^}]+)\}/
        );
        expect(gscQueryMatch).toBeTruthy();
        expect(gscQueryMatch![1]).toContain("refresh_token");
    });

    it("GA4 account query selects refresh_token", () => {
        const ga4QueryMatch = statusRoute.match(
            /provider:\s*"google-ga4"[\s\S]*?select:\s*\{([^}]+)\}/
        );
        expect(ga4QueryMatch).toBeTruthy();
        expect(ga4QueryMatch![1]).toContain("refresh_token");
    });
});

// ──────────────────────────────────────────────────────────────────
// 5. All integrations have status field
// ──────────────────────────────────────────────────────────────────
describe("All integrations have status field", () => {
    const integrationIds = ["gsc", "ga4", "github", "wordpress", "ghost", "hashnode", "moz", "api"];

    for (const id of integrationIds) {
        it(`${id} integration entry has status field`, () => {
            const idMatch = statusRoute.match(
                new RegExp(`id:\\s*"${id}"[\\s\\S]*?status:\\s*`)
            );
            expect(idMatch).toBeTruthy();
        });
    }
});
