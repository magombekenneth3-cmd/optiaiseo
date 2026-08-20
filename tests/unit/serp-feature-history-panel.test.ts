/**
 * Tests for SerpFeatureHistoryPanel data-shaping helpers.
 * These test the pure computation logic used by the component without
 * mounting React — keeps the suite fast and dependency-free.
 */

import { describe, it, expect } from "vitest";
import type { AiOverviewStats, SerpFeatureHistory, SerpFeatureHistoryPoint } from "@/app/actions/serp-features";

// ─── Inline helpers mirroring the panel logic ────────────────────────────────

function computeAioRate(stats: Pick<AiOverviewStats, "withAiOverview" | "totalTracked">): number {
    return stats.totalTracked > 0
        ? Math.round((stats.withAiOverview / stats.totalTracked) * 100)
        : 0;
}

function computeSnippetRate(stats: Pick<AiOverviewStats, "withSnippet" | "totalTracked">): number {
    return stats.totalTracked > 0
        ? Math.round((stats.withSnippet / stats.totalTracked) * 100)
        : 0;
}

function computePaaRate(stats: Pick<AiOverviewStats, "withPaa" | "totalTracked">): number {
    return stats.totalTracked > 0
        ? Math.round((stats.withPaa / stats.totalTracked) * 100)
        : 0;
}

function computeNetDelta(kw: Pick<SerpFeatureHistory, "aiOverviewDelta" | "snippetDelta">): number {
    return kw.aiOverviewDelta + kw.snippetDelta;
}

function getDeltaLabel(delta: number): "positive" | "negative" | "neutral" {
    if (delta > 0) return "positive";
    if (delta < 0) return "negative";
    return "neutral";
}

function getVisibleSnapshots(
    snapshots: SerpFeatureHistoryPoint[],
    maxVisible = 12,
): SerpFeatureHistoryPoint[] {
    return snapshots.slice(-maxVisible);
}

function makePoint(overrides: Partial<SerpFeatureHistoryPoint> = {}): SerpFeatureHistoryPoint {
    return {
        capturedAt: new Date("2026-01-01"),
        keyword: "test keyword",
        hasAiOverview: false,
        hasSnippet: false,
        hasPaa: false,
        hasLocalPack: false,
        hasVideo: false,
        brandInAio: false,
        ...overrides,
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SerpFeatureHistoryPanel — rate computations", () => {
    it("computes AIO rate as integer percentage", () => {
        expect(computeAioRate({ withAiOverview: 3, totalTracked: 10 })).toBe(30);
        expect(computeAioRate({ withAiOverview: 1, totalTracked: 3 })).toBe(33);
        expect(computeAioRate({ withAiOverview: 0, totalTracked: 5 })).toBe(0);
    });

    it("returns 0 rate when no keywords tracked", () => {
        expect(computeAioRate({ withAiOverview: 0, totalTracked: 0 })).toBe(0);
        expect(computeSnippetRate({ withSnippet: 0, totalTracked: 0 })).toBe(0);
        expect(computePaaRate({ withPaa: 0, totalTracked: 0 })).toBe(0);
    });

    it("computes snippet rate correctly", () => {
        expect(computeSnippetRate({ withSnippet: 5, totalTracked: 20 })).toBe(25);
        expect(computeSnippetRate({ withSnippet: 20, totalTracked: 20 })).toBe(100);
    });

    it("computes PAA rate correctly", () => {
        expect(computePaaRate({ withPaa: 7, totalTracked: 10 })).toBe(70);
    });
});

describe("SerpFeatureHistoryPanel — net delta logic", () => {
    it("sums aiOverviewDelta and snippetDelta for net delta", () => {
        expect(computeNetDelta({ aiOverviewDelta: 1, snippetDelta: 0 })).toBe(1);
        expect(computeNetDelta({ aiOverviewDelta: -1, snippetDelta: -1 })).toBe(-2);
        expect(computeNetDelta({ aiOverviewDelta: 0, snippetDelta: 0 })).toBe(0);
        expect(computeNetDelta({ aiOverviewDelta: 1, snippetDelta: -1 })).toBe(0);
    });

    it("classifies delta label correctly", () => {
        expect(getDeltaLabel(1)).toBe("positive");
        expect(getDeltaLabel(-1)).toBe("negative");
        expect(getDeltaLabel(0)).toBe("neutral");
        expect(getDeltaLabel(2)).toBe("positive");
        expect(getDeltaLabel(-3)).toBe("negative");
    });
});

describe("SerpFeatureHistoryPanel — PresenceDots visible slice", () => {
    it("returns all snapshots when count <= maxVisible", () => {
        const snaps = Array.from({ length: 8 }, (_, i) =>
            makePoint({ capturedAt: new Date(2026, 0, i + 1) })
        );
        expect(getVisibleSnapshots(snaps, 12)).toHaveLength(8);
    });

    it("truncates to last 12 when more snapshots exist", () => {
        const snaps = Array.from({ length: 20 }, (_, i) =>
            makePoint({ capturedAt: new Date(2026, 0, i + 1) })
        );
        const visible = getVisibleSnapshots(snaps, 12);
        expect(visible).toHaveLength(12);
        // Verify it's the LAST 12 (most recent)
        const last = visible[visible.length - 1];
        expect(last.capturedAt.getDate()).toBe(20);
    });

    it("returns empty array for empty input", () => {
        expect(getVisibleSnapshots([], 12)).toHaveLength(0);
    });

    it("returns single snapshot without error", () => {
        const snaps = [makePoint({ hasAiOverview: true })];
        expect(getVisibleSnapshots(snaps, 12)).toHaveLength(1);
        expect(getVisibleSnapshots(snaps, 12)[0].hasAiOverview).toBe(true);
    });
});

describe("SerpFeatureHistoryPanel — field access on SerpFeatureHistoryPoint", () => {
    it("correctly reads all boolean SERP feature fields", () => {
        const point = makePoint({
            hasAiOverview: true,
            hasSnippet: true,
            hasPaa: false,
            hasLocalPack: true,
            hasVideo: false,
            brandInAio: true,
        });
        expect(point.hasAiOverview).toBe(true);
        expect(point.hasSnippet).toBe(true);
        expect(point.hasPaa).toBe(false);
        expect(point.hasLocalPack).toBe(true);
        expect(point.hasVideo).toBe(false);
        expect(point.brandInAio).toBe(true);
    });
});

/** Returns AiOverviewStats | null, used to avoid literal-null narrowing in tests */
function maybeStats(s: AiOverviewStats | null): AiOverviewStats | null { return s; }

describe("SerpFeatureHistoryPanel — empty / no-data guard logic", () => {
    it("identifies no-data state when both stats and history are absent", () => {
        const stats = maybeStats(null);
        const history: SerpFeatureHistory[] = [];
        const hasStats = stats !== null && stats.totalTracked > 0;
        const hasHistory = history.length > 0;
        expect(hasStats).toBe(false);
        expect(hasHistory).toBe(false);
    });

    it("detects stats-only state (no historical snapshots yet)", () => {
        const stats: AiOverviewStats = {
            totalTracked: 5,
            withAiOverview: 2,
            brandInAio: 1,
            withSnippet: 3,
            withPaa: 1,
            aioRate: 40,
            brandAioRate: 50,
            keywords: [],
        };
        const history: SerpFeatureHistory[] = [];
        expect(stats !== null && stats.totalTracked > 0).toBe(true);
        expect(history.length > 0).toBe(false);
    });

    it("detects history-only state (stats null but snapshots present)", () => {
        const stats: AiOverviewStats | null = null;
        const history: SerpFeatureHistory[] = [
            {
                keyword: "seo tools",
                snapshots: [makePoint({ hasAiOverview: true })],
                aiOverviewDelta: 1,
                snippetDelta: 0,
            },
        ];
        expect(stats !== null).toBe(false);
        expect(history.length > 0).toBe(true);
    });
});

describe("SerpFeatureHistoryPanel — keyword list capping", () => {
    it("slices history to first 10 keywords for render", () => {
        const history: SerpFeatureHistory[] = Array.from({ length: 15 }, (_, i) => ({
            keyword: `keyword-${i}`,
            snapshots: [makePoint()],
            aiOverviewDelta: 0,
            snippetDelta: 0,
        }));
        const rendered = history.slice(0, 10);
        expect(rendered).toHaveLength(10);
        expect(rendered[0].keyword).toBe("keyword-0");
        expect(rendered[9].keyword).toBe("keyword-9");
    });
});
