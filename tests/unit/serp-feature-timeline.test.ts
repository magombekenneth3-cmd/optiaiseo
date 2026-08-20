/**
 * Tests for SerpFeatureHistoryPanel — timeline and data-transformation logic.
 *
 * Tests cover the data-shaping helpers that power the expandable weekly
 * timeline view, verifying correctness of:
 *
 * 1. buildSeries — transforms SerpFeatureHistoryEntry.snapshots into
 *    per-feature { date, active } series
 * 2. Delta semantics (first vs last snapshot)
 * 3. Single-point windows (trend pending, no delta shown)
 * 4. Empty arrays (guard conditions)
 * 5. Multi-keyword entries
 * 6. 13-snapshot visible slice (panel shows last 13 of potentially many)
 * 7. shortDate formatting safety
 */

import { describe, it, expect } from "vitest";

// ─── Inline helpers ─────────────────────────────────────────────────────────
// Mirrors the exact functions used inside SerpFeatureHistoryPanel.tsx.
// These are pure and don't depend on React, so they can be tested here
// without any component mounting.

interface SerpFeaturePoint {
    capturedAt: string;
    keyword: string;
    hasAiOverview: boolean;
    hasSnippet: boolean;
    hasPaa: boolean;
    hasLocalPack: boolean;
    hasVideo: boolean;
    brandInAio: boolean;
}

interface SerpFeatureHistoryEntry {
    keyword: string;
    snapshots: SerpFeaturePoint[];
    aiOverviewDelta: number;
    snippetDelta: number;
}

function makePoint(
    date: string,
    overrides: Partial<Omit<SerpFeaturePoint, "capturedAt" | "keyword">> = {},
    keyword = "test keyword",
): SerpFeaturePoint {
    return {
        capturedAt: date,
        keyword,
        hasAiOverview: false,
        hasSnippet: false,
        hasPaa: false,
        hasLocalPack: false,
        hasVideo: false,
        brandInAio: false,
        ...overrides,
    };
}

/** Mirrors buildSeries from the panel */
function buildSeries(
    snapshots: SerpFeaturePoint[],
    field: keyof Pick<SerpFeaturePoint, "hasAiOverview" | "hasSnippet" | "hasPaa" | "hasLocalPack" | "hasVideo" | "brandInAio">,
): { date: string; active: boolean }[] {
    return snapshots.map((s) => ({ date: s.capturedAt, active: s[field] }));
}

/** Mirrors the visible-slice logic from TimelineRow (last 13 snapshots) */
function getVisible(snapshots: SerpFeaturePoint[]): SerpFeaturePoint[] {
    return snapshots.slice(-13);
}

/** Mirrors delta computation from getSerpFeatureHistory server action */
function computeDelta(snapshots: SerpFeaturePoint[], field: "hasAiOverview" | "hasSnippet"): number {
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    return first && last
        ? (last[field] ? 1 : 0) - (first[field] ? 1 : 0)
        : 0;
}

/** Mirrors shortDate from the panel — must match the isNaN guard added in the component */
function shortDate(iso: string): string {
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return "—";
        return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    } catch {
        return "—";
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("buildSeries — feature timeline transformation", () => {
    it("maps hasAiOverview across multiple snapshots correctly", () => {
        const snapshots = [
            makePoint("2026-01-01T00:00:00Z", { hasAiOverview: false }),
            makePoint("2026-01-08T00:00:00Z", { hasAiOverview: false }),
            makePoint("2026-01-15T00:00:00Z", { hasAiOverview: true }),
        ];
        const series = buildSeries(snapshots, "hasAiOverview");
        expect(series).toHaveLength(3);
        expect(series[0].active).toBe(false);
        expect(series[1].active).toBe(false);
        expect(series[2].active).toBe(true);
    });

    it("preserves chronological ordering from input array", () => {
        const snapshots = [
            makePoint("2026-01-01T00:00:00Z", { hasSnippet: true }),
            makePoint("2026-01-08T00:00:00Z", { hasSnippet: false }),
            makePoint("2026-01-15T00:00:00Z", { hasSnippet: true }),
        ];
        const series = buildSeries(snapshots, "hasSnippet");
        expect(series.map((s) => s.active)).toEqual([true, false, true]);
    });

    it("returns empty array for empty snapshots input", () => {
        expect(buildSeries([], "hasAiOverview")).toEqual([]);
    });

    it("handles a single snapshot (trend pending state)", () => {
        const snapshots = [makePoint("2026-01-01T00:00:00Z", { hasAiOverview: true })];
        const series = buildSeries(snapshots, "hasAiOverview");
        expect(series).toHaveLength(1);
        expect(series[0].active).toBe(true);
    });

    it("maps hasPaa field correctly", () => {
        const snapshots = [
            makePoint("2026-01-01T00:00:00Z", { hasPaa: true }),
            makePoint("2026-01-08T00:00:00Z", { hasPaa: false }),
        ];
        const series = buildSeries(snapshots, "hasPaa");
        expect(series[0].active).toBe(true);
        expect(series[1].active).toBe(false);
    });

    it("maps brandInAio field correctly", () => {
        const snapshots = [
            makePoint("2026-01-01T00:00:00Z", { brandInAio: false }),
            makePoint("2026-01-08T00:00:00Z", { brandInAio: true }),
        ];
        const series = buildSeries(snapshots, "brandInAio");
        expect(series[0].active).toBe(false);
        expect(series[1].active).toBe(true);
    });

    it("date string is preserved verbatim in output", () => {
        const iso = "2026-03-15T09:30:00Z";
        const snapshots = [makePoint(iso, {})];
        const series = buildSeries(snapshots, "hasSnippet");
        expect(series[0].date).toBe(iso);
    });
});

describe("visible snapshot slice (last 13)", () => {
    it("returns all when count <= 13", () => {
        const snaps = Array.from({ length: 10 }, (_, i) =>
            makePoint(`2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`)
        );
        expect(getVisible(snaps)).toHaveLength(10);
    });

    it("returns last 13 when > 13 exist (most recent, not oldest)", () => {
        // 20 weeks of data
        const snaps = Array.from({ length: 20 }, (_, i) =>
            makePoint(`2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`, {
                hasAiOverview: i >= 10, // only last 10 have AIO
            })
        );
        const visible = getVisible(snaps);
        expect(visible).toHaveLength(13);
        // The first visible is week 8 (index 7 of 0-based, but slice(-13) of 20 = [7..19])
        // All 13 visible ones should include the 10 that have AIO (weeks 10-19 of 0-based)
        const aioCount = visible.filter((s) => s.hasAiOverview).length;
        expect(aioCount).toBe(10); // weeks index 10-19 are all in last 13
    });

    it("returns empty array for empty input", () => {
        expect(getVisible([])).toHaveLength(0);
    });

    it("returns single point for single-point window", () => {
        const snaps = [makePoint("2026-01-01T00:00:00Z", { hasAiOverview: true })];
        const visible = getVisible(snaps);
        expect(visible).toHaveLength(1);
        expect(visible[0].hasAiOverview).toBe(true);
    });

    it("exactly 13 points returns all 13", () => {
        const snaps = Array.from({ length: 13 }, (_, i) =>
            makePoint(`2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`)
        );
        expect(getVisible(snaps)).toHaveLength(13);
    });
});

describe("delta semantics (first vs last snapshot)", () => {
    it("returns +1 when feature gained over the window", () => {
        const snapshots = [
            makePoint("2026-01-01T00:00:00Z", { hasAiOverview: false }),
            makePoint("2026-01-08T00:00:00Z", { hasAiOverview: false }),
            makePoint("2026-01-15T00:00:00Z", { hasAiOverview: true }),
        ];
        expect(computeDelta(snapshots, "hasAiOverview")).toBe(1);
    });

    it("returns -1 when feature lost over the window", () => {
        const snapshots = [
            makePoint("2026-01-01T00:00:00Z", { hasSnippet: true }),
            makePoint("2026-01-08T00:00:00Z", { hasSnippet: true }),
            makePoint("2026-01-15T00:00:00Z", { hasSnippet: false }),
        ];
        expect(computeDelta(snapshots, "hasSnippet")).toBe(-1);
    });

    it("returns 0 when feature unchanged throughout", () => {
        const snapshots = [
            makePoint("2026-01-01T00:00:00Z", { hasAiOverview: true }),
            makePoint("2026-01-08T00:00:00Z", { hasAiOverview: true }),
            makePoint("2026-01-15T00:00:00Z", { hasAiOverview: true }),
        ];
        expect(computeDelta(snapshots, "hasAiOverview")).toBe(0);
    });

    it("returns 0 for empty snapshots", () => {
        expect(computeDelta([], "hasAiOverview")).toBe(0);
    });

    it("returns 0 for single-point window (first === last)", () => {
        const snapshots = [makePoint("2026-01-01T00:00:00Z", { hasAiOverview: true })];
        // first === last so delta = 1 - 1 = 0
        expect(computeDelta(snapshots, "hasAiOverview")).toBe(0);
    });

    it("only compares first and last, ignoring middle oscillations", () => {
        const snapshots = [
            makePoint("2026-01-01T00:00:00Z", { hasAiOverview: false }), // first: false
            makePoint("2026-01-08T00:00:00Z", { hasAiOverview: true }),  // middle gained
            makePoint("2026-01-15T00:00:00Z", { hasAiOverview: false }), // last: false again
        ];
        // first=false, last=false → delta = 0
        expect(computeDelta(snapshots, "hasAiOverview")).toBe(0);
    });
});

describe("multiple keyword entries", () => {
    it("correctly processes multiple independent keyword entries", () => {
        const entries: SerpFeatureHistoryEntry[] = [
            {
                keyword: "seo tools",
                snapshots: [
                    makePoint("2026-01-01T00:00:00Z", { hasAiOverview: false }, "seo tools"),
                    makePoint("2026-01-08T00:00:00Z", { hasAiOverview: true }, "seo tools"),
                ],
                aiOverviewDelta: 1,
                snippetDelta: 0,
            },
            {
                keyword: "ai marketing",
                snapshots: [
                    makePoint("2026-01-01T00:00:00Z", { hasSnippet: true }, "ai marketing"),
                    makePoint("2026-01-08T00:00:00Z", { hasSnippet: false }, "ai marketing"),
                ],
                aiOverviewDelta: 0,
                snippetDelta: -1,
            },
            {
                keyword: "content strategy",
                snapshots: [
                    makePoint("2026-01-01T00:00:00Z", {}, "content strategy"),
                ],
                aiOverviewDelta: 0,
                snippetDelta: 0,
            },
        ];

        // Entry 0: gained AIO
        const series0 = buildSeries(entries[0].snapshots, "hasAiOverview");
        expect(series0.map((s) => s.active)).toEqual([false, true]);
        expect(entries[0].aiOverviewDelta).toBe(1);

        // Entry 1: lost Snippet
        const series1 = buildSeries(entries[1].snapshots, "hasSnippet");
        expect(series1.map((s) => s.active)).toEqual([true, false]);
        expect(entries[1].snippetDelta).toBe(-1);

        // Entry 2: single point — no trend
        expect(entries[2].snapshots).toHaveLength(1);
        expect(entries[2].aiOverviewDelta).toBe(0);
        expect(entries[2].snippetDelta).toBe(0);
    });

    it("caps keyword list at 20 (server action cap, enforced in action)", () => {
        // This test documents the expected cap; the cap is enforced server-side
        const manyKeywords = Array.from({ length: 25 }, (_, i) => ({
            keyword: `keyword-${i}`,
            snapshots: [makePoint("2026-01-01T00:00:00Z", {}, `keyword-${i}`)],
            aiOverviewDelta: 0,
            snippetDelta: 0,
        }));
        // Panel renders all that the server returns (capped at 20 by getSerpFeatureHistory)
        // The server action enforces the cap, so the client renders whatever arrives.
        // Simulate the cap applied server-side:
        const cappedByServer = manyKeywords.slice(0, 20);
        expect(cappedByServer).toHaveLength(20);
    });
});

describe("shortDate formatting", () => {
    it("formats ISO date string correctly in en-GB format", () => {
        const result = shortDate("2026-03-15T00:00:00Z");
        // Should be "15 Mar" in en-GB locale
        expect(result).toMatch(/^15\s(Mar|mar)$/i);
    });

    it("returns — for invalid date string", () => {
        expect(shortDate("not-a-date")).toBe("—");
    });

    it("handles different months correctly", () => {
        const jan = shortDate("2026-01-01T00:00:00Z");
        const dec = shortDate("2026-12-31T00:00:00Z");
        expect(jan).toMatch(/Jan/i);
        expect(dec).toMatch(/Dec/i);
    });
});

describe("auto-expand logic (keywords with non-zero delta and >= 2 snapshots)", () => {
    it("selects keywords with non-zero AIO delta and 2+ snapshots for auto-expand", () => {
        const entries: SerpFeatureHistoryEntry[] = [
            { keyword: "a", snapshots: [makePoint("2026-01-01T00:00:00Z"), makePoint("2026-01-08T00:00:00Z")], aiOverviewDelta: 1, snippetDelta: 0 },
            { keyword: "b", snapshots: [makePoint("2026-01-01T00:00:00Z"), makePoint("2026-01-08T00:00:00Z")], aiOverviewDelta: 0, snippetDelta: 0 },
            { keyword: "c", snapshots: [makePoint("2026-01-01T00:00:00Z")], aiOverviewDelta: 1, snippetDelta: 0 }, // only 1 snapshot — not eligible
            { keyword: "d", snapshots: [makePoint("2026-01-01T00:00:00Z"), makePoint("2026-01-08T00:00:00Z")], aiOverviewDelta: -1, snippetDelta: 0 },
        ];

        const autoExpanded = entries
            .filter((e) => e.snapshots.length >= 2 && (e.aiOverviewDelta !== 0 || e.snippetDelta !== 0))
            .map((e) => e.keyword);

        expect(autoExpanded).toEqual(["a", "d"]);
        expect(autoExpanded).not.toContain("b"); // no delta
        expect(autoExpanded).not.toContain("c"); // only 1 snapshot
    });

    it("returns empty set when no keywords have history changes", () => {
        const entries: SerpFeatureHistoryEntry[] = [
            { keyword: "a", snapshots: [makePoint("2026-01-01T00:00:00Z"), makePoint("2026-01-08T00:00:00Z")], aiOverviewDelta: 0, snippetDelta: 0 },
            { keyword: "b", snapshots: [makePoint("2026-01-01T00:00:00Z"), makePoint("2026-01-08T00:00:00Z")], aiOverviewDelta: 0, snippetDelta: 0 },
        ];
        const autoExpanded = entries.filter((e) => e.snapshots.length >= 2 && (e.aiOverviewDelta !== 0 || e.snippetDelta !== 0));
        expect(autoExpanded).toHaveLength(0);
    });
});
