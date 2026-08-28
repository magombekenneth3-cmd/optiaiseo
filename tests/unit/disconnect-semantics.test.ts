/**
 * Disconnect Semantics Tests
 *
 * Verifies the isolation invariant:
 *   Disconnect GSC → GA4 STILL WORKS
 *   Disconnect GA4 → GSC STILL WORKS
 *
 * Also verifies cache correctness:
 *   disconnect GSC → GSC token cache invalidated + Next.js cache revalidated
 *   disconnect GA4 → GA4 token cache invalidated
 *
 * Test matrix:
 * ┌──────────────────────────────────────────────────────────────┐
 * │ disconnect GSC → GA4 credentials remain                     │
 * │ disconnect GSC → GA4 property remains                       │
 * │ disconnect GA4 → GSC credentials remain                     │
 * │ disconnect GA4 → GSC connected flag unchanged               │
 * │ disconnect GSC → calls disconnectGsc() (cache + revalidate) │
 * │ disconnect GA4 → GA4 cache invalidated                      │
 * └──────────────────────────────────────────────────────────────┘
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../../src");

function readSrc(...segments: string[]): string {
    return fs.readFileSync(path.join(SRC, ...segments), "utf8");
}

// ──────────────────────────────────────────────────────────────────
// 1. GSC Disconnect leaves GA4 untouched
// ──────────────────────────────────────────────────────────────────
describe("GSC Disconnect isolation", () => {
    describe("disconnect-gsc route delegates to disconnectGsc()", () => {
        const route = readSrc("app/api/settings/disconnect-gsc/route.ts");

        it("imports disconnectGsc from gsc/token", () => {
            expect(route).toContain('import { disconnectGsc } from "@/lib/gsc/token"');
        });

        it("calls disconnectGsc(user.id)", () => {
            expect(route).toContain("disconnectGsc(user.id)");
        });

        it("does NOT inline prisma.account.deleteMany", () => {
            expect(route).not.toContain("prisma.account.deleteMany");
        });

        it("does NOT inline prisma.user.update", () => {
            expect(route).not.toContain("prisma.user.update");
        });
    });

    describe("disconnectGsc() preserves GA4", () => {
        const gscToken = readSrc("lib/gsc/token.ts");

        it("only deletes provider: google-gsc", () => {
            expect(gscToken).toMatch(/deleteMany[\s\S]*?provider:\s*"google-gsc"/);
        });

        it("does NOT clear ga4PropertyId", () => {
            expect(gscToken).not.toContain("ga4PropertyId: null");
        });

        it("has explicit comment about GA4 independence", () => {
            expect(gscToken).toContain(
                "GA4 property IDs are intentionally NOT cleared here"
            );
        });

        it("invalidates GSC token cache", () => {
            expect(gscToken).toContain("invalidateCachedToken");
        });

        it("revalidates Next.js cache tags", () => {
            expect(gscToken).toContain("revalidateTag");
        });
    });
});

// ──────────────────────────────────────────────────────────────────
// 2. GA4 Disconnect leaves GSC untouched
// ──────────────────────────────────────────────────────────────────
describe("GA4 Disconnect isolation", () => {
    const route = readSrc("app/api/settings/disconnect-ga4/route.ts");

    it("only deletes provider: google-ga4", () => {
        expect(route).toContain('provider: "google-ga4"');
        expect(route).not.toContain('provider: "google-gsc"');
    });

    it("clears ga4PropertyId from sites", () => {
        expect(route).toContain("ga4PropertyId: null");
    });

    it("invalidates GA4 cache (not GSC cache)", () => {
        expect(route).toContain("invalidateGa4CachedToken");
    });

    it("does NOT touch gscConnected", () => {
        expect(route).not.toContain("gscConnected");
    });

    it("does NOT reference gsc/token.ts", () => {
        expect(route).not.toContain("@/lib/gsc/token");
    });
});

// ──────────────────────────────────────────────────────────────────
// 3. Cross-contamination guard
// ──────────────────────────────────────────────────────────────────
describe("Disconnect cross-contamination guard", () => {
    it("disconnect-gsc never references ga4 token module", () => {
        const route = readSrc("app/api/settings/disconnect-gsc/route.ts");
        expect(route).not.toContain("@/lib/ga4/token");
        expect(route).not.toContain("invalidateGa4CachedToken");
    });

    it("disconnect-ga4 never references gsc token module", () => {
        const route = readSrc("app/api/settings/disconnect-ga4/route.ts");
        expect(route).not.toContain("@/lib/gsc/token");
        expect(route).not.toContain("disconnectGsc");
    });

    it("disconnectGsc() does not delete google-ga4 accounts", () => {
        const gscToken = readSrc("lib/gsc/token.ts");
        expect(gscToken).not.toContain('"google-ga4"');
    });
});
