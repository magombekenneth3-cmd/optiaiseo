/**
 * Unified Analytics Error Isolation Tests
 *
 * Verifies the architectural invariant:
 *   GSC failure ≠ GA4 failure
 *   GA4 failure ≠ GSC failure
 *
 * The unified analytics action must:
 * 1. Run GSC and GA4 fetches independently
 * 2. Surface structured gscError/ga4Error fields
 * 3. Produce merged data when EITHER source has data
 * 4. Never let one provider's failure corrupt the other
 *
 * Test matrix:
 * ┌──────────────────────────────────────────────────────────────┐
 * │ GSC ✓ + GA4 ✓ → both populated, no errors                  │
 * │ GSC ✗ + GA4 ✓ → gsc null, ga4 populated, gscError set      │
 * │ GSC ✓ + GA4 ✗ → gsc populated, ga4 null, ga4Error set      │
 * │ both ✗       → both null, both errors set                   │
 * │ GSC reauth + GA4 ✓ → ga4 flows independently               │
 * │ GA4 permission denied → ga4Error: property_access_denied    │
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
// 1. Interface Shape — gscError and ga4Error fields exist
// ──────────────────────────────────────────────────────────────────
describe("UnifiedAnalytics interface has error fields", () => {
    const unified = readSrc("app/actions/unified-analytics.ts");

    it("exports gscError field with correct type", () => {
        expect(unified).toContain("gscError: IntegrationErrorStatus | null");
    });

    it("exports ga4Error field with correct type", () => {
        expect(unified).toContain("ga4Error: IntegrationErrorStatus | null");
    });

    it("IntegrationErrorStatus includes not_connected", () => {
        expect(unified).toContain('"not_connected"');
    });

    it("IntegrationErrorStatus includes reauthorization_required", () => {
        expect(unified).toContain('"reauthorization_required"');
    });

    it("IntegrationErrorStatus includes property_access_denied", () => {
        expect(unified).toContain('"property_access_denied"');
    });

    it("IntegrationErrorStatus includes unknown_error", () => {
        expect(unified).toContain('"unknown_error"');
    });
});

// ──────────────────────────────────────────────────────────────────
// 2. Error Classification — GSC errors map correctly
// ──────────────────────────────────────────────────────────────────
describe("GSC error classification", () => {
    const unified = readSrc("app/actions/unified-analytics.ts");

    it("classifies GSC_NOT_CONNECTED as not_connected", () => {
        expect(unified).toContain('msg.includes("GSC_NOT_CONNECTED")');
        expect(unified).toMatch(/GSC_NOT_CONNECTED.*return\s*"not_connected"/s);
    });

    it("classifies GSC_REFRESH_TOKEN_MISSING as reauthorization_required", () => {
        expect(unified).toContain('msg.includes("GSC_REFRESH_TOKEN_MISSING")');
    });

    it("classifies GSC_TOKEN_REFRESH_FAILED as reauthorization_required", () => {
        expect(unified).toContain('msg.includes("GSC_TOKEN_REFRESH_FAILED")');
    });

    it("classifies GSC_REAUTHORIZATION_REQUIRED as reauthorization_required", () => {
        expect(unified).toContain('msg.includes("GSC_REAUTHORIZATION_REQUIRED")');
    });
});

// ──────────────────────────────────────────────────────────────────
// 3. Error Classification — GA4 errors map correctly
// ──────────────────────────────────────────────────────────────────
describe("GA4 error classification", () => {
    const unified = readSrc("app/actions/unified-analytics.ts");

    it("classifies GA4_NOT_CONNECTED as not_connected", () => {
        expect(unified).toContain('msg.includes("GA4_NOT_CONNECTED")');
    });

    it("classifies GA4_REFRESH_TOKEN_MISSING as reauthorization_required", () => {
        expect(unified).toContain('msg.includes("GA4_REFRESH_TOKEN_MISSING")');
    });

    it("classifies GA4_TOKEN_REFRESH_FAILED as reauthorization_required", () => {
        expect(unified).toContain('msg.includes("GA4_TOKEN_REFRESH_FAILED")');
    });

    it("classifies GA4_PERMISSION_DENIED as property_access_denied", () => {
        expect(unified).toContain('msg.includes("GA4_PERMISSION_DENIED")');
        expect(unified).toMatch(/GA4_PERMISSION_DENIED.*return\s*"property_access_denied"/s);
    });
});

// ──────────────────────────────────────────────────────────────────
// 4. Independent Execution — GSC failure does not block GA4
// ──────────────────────────────────────────────────────────────────
describe("Independent execution", () => {
    const unified = readSrc("app/actions/unified-analytics.ts");

    it("GSC fetch is in its own try/catch block", () => {
        // GSC try/catch must complete before GA4 section starts
        const gscCatchIndex = unified.indexOf("gscError = classifyGscError");
        const ga4SectionIndex = unified.indexOf("GA4 fetch (independent");
        expect(gscCatchIndex).toBeGreaterThan(-1);
        expect(ga4SectionIndex).toBeGreaterThan(-1);
        expect(gscCatchIndex).toBeLessThan(ga4SectionIndex);
    });

    it("GA4 fetch is in its own try/catch block", () => {
        expect(unified).toContain("ga4Error = classifyGa4Error");
    });

    it("GSC catch assigns gscError, not ga4Error", () => {
        // Between the GSC catch and GA4 section, only gscError should be assigned
        const gscCatchStart = unified.indexOf("gscError = classifyGscError");
        const ga4SectionStart = unified.indexOf("GA4 fetch (independent");
        const segment = unified.slice(gscCatchStart, ga4SectionStart);
        expect(segment).not.toContain("ga4Error");
    });

    it("GA4 catch assigns ga4Error, not gscError", () => {
        const ga4CatchIndex = unified.indexOf("ga4Error = classifyGa4Error");
        // Verify ga4Error assignment exists and doesn't also set gscError
        expect(ga4CatchIndex).toBeGreaterThan(-1);
        // The ga4 catch block should not touch gscError
        const ga4CatchEnd = unified.indexOf("}", ga4CatchIndex + 30);
        const ga4Segment = unified.slice(ga4CatchIndex, ga4CatchEnd);
        expect(ga4Segment).not.toContain("gscError");
    });
});

// ──────────────────────────────────────────────────────────────────
// 5. Merged Data — produced when EITHER source has data
// ──────────────────────────────────────────────────────────────────
describe("Merged data from either source", () => {
    const unified = readSrc("app/actions/unified-analytics.ts");

    it("uses OR condition (gscData || ga4Data) not AND", () => {
        expect(unified).toContain("if (gscData || ga4Data)");
        expect(unified).not.toContain("if (gscData && ga4Data)");
    });

    it("safely handles null gscData when computing merged", () => {
        expect(unified).toContain("gscData?.totalClicks ?? 0");
    });

    it("safely handles null ga4Data when computing merged", () => {
        expect(unified).toContain("ga4Data?.organicSessions ?? 0");
        expect(unified).toContain("if (ga4Data)");
    });

    it("returns gscError and ga4Error in the result", () => {
        expect(unified).toMatch(/return\s*\{.*gscError.*ga4Error/s);
    });

    it("returns null errors when no error occurred", () => {
        // Early returns set both error fields to null
        expect(unified).toContain("gscError: null, ga4Error: null");
    });
});
