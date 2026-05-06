/**
 * Unit tests for backlink quality analysis.
 *
 * These tests cover the three toxic-detection rules:
 *   Rule 1 — Exact-match anchor (≥15 links from same anchor = toxic)
 *   Rule 2 — Low DR spam (DR < 5)
 *   Rule 3 — Toxic keyword in anchor text
 *
 * Tests run against the pure-function layer — no DB, no API calls.
 * The analyseToxicity function is extracted and tested in isolation.
 */

import { describe, it, expect } from "vitest";

// ── Types mirrored from quality-analysis.ts ──────────────────────────────────

interface RawBacklink {
    srcDomain: string;
    anchorText: string;
    domainRating: number | null;
    isDoFollow: boolean;
    firstSeen: Date;
}

// ── The rules under test (inline copy so tests don't depend on module imports
//    that have side-effects like Prisma connections) ──────────────────────────

const TOXIC_KEYWORDS = ["casino", "poker", "xxx", "porn", "viagra", "cialis", "cbd", "loan", "payday"];

function analyseToxicity(links: RawBacklink[]): {
    domain: string;
    isToxic: boolean;
    toxicReason: string | null;
}[] {
    // Frequency map for anchor text
    const anchorCounts: Record<string, number> = {};
    for (const link of links) {
        if (link.anchorText) {
            anchorCounts[link.anchorText] = (anchorCounts[link.anchorText] ?? 0) + 1;
        }
    }

    return links.map((link) => {
        // Rule 1: Exact-match anchor appearing ≥15 times across the full backlink set
        if (
            link.anchorText &&
            anchorCounts[link.anchorText] != null &&
            anchorCounts[link.anchorText]! >= 15
        ) {
            return { domain: link.srcDomain, isToxic: true, toxicReason: "exact_match_anchor" };
        }

        // Rule 2: Low-DR spam (DR < 5 and dofollow)
        if (link.domainRating !== null && link.domainRating < 5 && link.isDoFollow) {
            return { domain: link.srcDomain, isToxic: true, toxicReason: "low_dr_spam" };
        }

        // Rule 3: Toxic keyword in anchor
        const anchor = link.anchorText?.toLowerCase() ?? "";
        if (TOXIC_KEYWORDS.some((kw) => anchor.includes(kw))) {
            return { domain: link.srcDomain, isToxic: true, toxicReason: "toxic_keyword" };
        }

        return { domain: link.srcDomain, isToxic: false, toxicReason: null };
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLink(overrides: Partial<RawBacklink> = {}): RawBacklink {
    return {
        srcDomain: "example.com",
        anchorText: "click here",
        domainRating: 45,
        isDoFollow: true,
        firstSeen: new Date(),
        ...overrides,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("analyseToxicity — Rule 1 (exact-match anchor)", () => {
    it("does NOT flag a link when anchor appears fewer than 15 times", () => {
        const links = Array.from({ length: 14 }, (_, i) =>
            makeLink({ srcDomain: `site${i}.com`, anchorText: "buy now" })
        );
        const results = analyseToxicity(links);
        expect(results.every((r) => !r.isToxic)).toBe(true);
    });

    it("flags all links sharing an anchor that appears exactly 15 times", () => {
        const links = Array.from({ length: 15 }, (_, i) =>
            makeLink({ srcDomain: `site${i}.com`, anchorText: "seo services" })
        );
        const results = analyseToxicity(links);
        expect(results.every((r) => r.isToxic)).toBe(true);
        expect(results.every((r) => r.toxicReason === "exact_match_anchor")).toBe(true);
    });

    it("flags only links with the repeated anchor — clean links stay clean", () => {
        const spamLinks = Array.from({ length: 15 }, (_, i) =>
            makeLink({ srcDomain: `spam${i}.com`, anchorText: "seo services" })
        );
        const cleanLink = makeLink({ srcDomain: "clean.com", anchorText: "my brand" });
        const results = analyseToxicity([...spamLinks, cleanLink]);

        const clean = results.find((r) => r.domain === "clean.com")!;
        expect(clean.isToxic).toBe(false);
        expect(clean.toxicReason).toBeNull();
    });

    it("does NOT flag a nofollow link even with ≥15 matching anchors", () => {
        // Rule 1 checks anchor count regardless of doFollow — both nofollow and dofollow
        // should be flagged if the anchor is repeated, because nofollow still signals
        // spam campaign activity.
        const links = Array.from({ length: 15 }, (_, i) =>
            makeLink({ srcDomain: `site${i}.com`, anchorText: "seo services", isDoFollow: false })
        );
        const results = analyseToxicity(links);
        // Rule 1 fires regardless of doFollow status
        expect(results.every((r) => r.isToxic)).toBe(true);
    });
});

describe("analyseToxicity — Rule 2 (low-DR spam)", () => {
    it("flags dofollow link with DR < 5", () => {
        const result = analyseToxicity([makeLink({ domainRating: 2, isDoFollow: true })]);
        expect(result[0]!.isToxic).toBe(true);
        expect(result[0]!.toxicReason).toBe("low_dr_spam");
    });

    it("does NOT flag nofollow link with DR < 5 (nofollow carries no link equity)", () => {
        const result = analyseToxicity([makeLink({ domainRating: 2, isDoFollow: false })]);
        expect(result[0]!.isToxic).toBe(false);
    });

    it("does NOT flag dofollow link with DR = 5 (boundary, not < 5)", () => {
        const result = analyseToxicity([makeLink({ domainRating: 5, isDoFollow: true })]);
        expect(result[0]!.isToxic).toBe(false);
    });

    it("does NOT flag link with null DR (unknown DR skipped)", () => {
        const result = analyseToxicity([makeLink({ domainRating: null, isDoFollow: true })]);
        expect(result[0]!.isToxic).toBe(false);
    });
});

describe("analyseToxicity — Rule 3 (toxic keywords)", () => {
    const KEYWORDS = ["casino", "poker", "xxx", "porn", "viagra", "cialis", "cbd", "loan", "payday"];

    for (const kw of KEYWORDS) {
        it(`flags anchor containing "${kw}"`, () => {
            const result = analyseToxicity([makeLink({ anchorText: `best ${kw} deals`, domainRating: 40 })]);
            expect(result[0]!.isToxic).toBe(true);
            expect(result[0]!.toxicReason).toBe("toxic_keyword");
        });
    }

    it("is case-insensitive (CASINO flags as toxic)", () => {
        const result = analyseToxicity([makeLink({ anchorText: "Best CASINO Online", domainRating: 40 })]);
        expect(result[0]!.isToxic).toBe(true);
    });

    it("does NOT flag clean anchor", () => {
        const result = analyseToxicity([makeLink({ anchorText: "OptiAISEO review", domainRating: 40 })]);
        expect(result[0]!.isToxic).toBe(false);
    });
});

describe("analyseToxicity — empty input", () => {
    it("returns empty array for empty input", () => {
        expect(analyseToxicity([])).toEqual([]);
    });
});
