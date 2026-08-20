/**
 * Tests for:
 * 1. SerpFeatureHistory data grouping and delta computation logic (F0-2)
 * 2. toNormalisedIssues details propagation (F0-3)
 */

import { describe, it, expect } from "vitest";
import {
    parseAuditResult,
    toNormalisedIssues,
} from "@/lib/seo-audit/parse-audit-result";

// ─── F0-3: Evidence / details propagation ────────────────────────────────────

describe("toNormalisedIssues — details propagation", () => {
    it("propagates details from ChecklistItem in the category fallback path", () => {
        const raw = {
            categories: [
                {
                    id: "on-page",
                    label: "On Page",
                    items: [
                        {
                            id: "page-meta-description",
                            label: "Meta description",
                            status: "Fail",
                            finding: "Meta description is too long (180 chars)",
                            recommendation: {
                                text: "Shorten to under 160 characters",
                                priority: "High",
                            },
                            roiImpact: 70,
                            aiVisibilityImpact: 65,
                            details: { length: 180, value: "Lorem ipsum dolor sit amet…" },
                        },
                    ],
                    score: 20,
                    passed: 0,
                    failed: 1,
                    warnings: 0,
                },
            ],
            recommendations: [],
            overallScore: 20,
        };

        const parsed = parseAuditResult(raw);
        const issues = toNormalisedIssues(parsed);

        expect(issues).toHaveLength(1);
        expect(issues[0].details).toEqual({ length: 180, value: "Lorem ipsum dolor sit amet…" });
    });

    it("attaches details to recommendations[] path via itemId lookup", () => {
        const raw = {
            categories: [
                {
                    id: "technical",
                    label: "Technical",
                    items: [
                        {
                            id: "page-title-length",
                            label: "Title tag length",
                            status: "Warning",
                            finding: "Title is 72 chars",
                            recommendation: { text: "Shorten to 50–60 chars", priority: "Medium" },
                            roiImpact: 60,
                            aiVisibilityImpact: 55,
                            details: { length: 72, value: "My very long page title that goes on and on" },
                        },
                    ],
                    score: 70,
                    passed: 0,
                    failed: 0,
                    warnings: 1,
                },
            ],
            recommendations: [
                {
                    categoryId: "technical",
                    itemId: "page-title-length",
                    label: "Title tag length",
                    finding: "Title is 72 chars",
                    recommendation: "Shorten to 50–60 chars",
                    priority: "Medium",
                    roiImpact: 60,
                    aiVisibilityImpact: 55,
                    priorityScore: 58,
                },
            ],
            overallScore: 70,
        };

        const parsed = parseAuditResult(raw);
        const issues = toNormalisedIssues(parsed);

        expect(issues).toHaveLength(1);
        // Via the recommendations[] path, details must be resolved from the category item lookup
        expect(issues[0].details).toEqual({ length: 72, value: "My very long page title that goes on and on" });
    });

    it("returns undefined details when the module did not set them", () => {
        const raw = {
            categories: [
                {
                    id: "authority",
                    label: "Authority",
                    items: [
                        {
                            id: "backlinks-count",
                            label: "Backlinks",
                            status: "Warning",
                            finding: "No backlinks detected",
                            recommendation: { text: "Build high-quality backlinks", priority: "High" },
                            roiImpact: 80,
                            aiVisibilityImpact: 70,
                            // no details field
                        },
                    ],
                    score: 10,
                    passed: 0,
                    failed: 0,
                    warnings: 1,
                },
            ],
            recommendations: [],
            overallScore: 10,
        };

        const parsed = parseAuditResult(raw);
        const issues = toNormalisedIssues(parsed);

        expect(issues[0].details).toBeUndefined();
    });

    it("does not include Pass items in issues output", () => {
        const raw = {
            categories: [
                {
                    id: "technical",
                    label: "Technical",
                    items: [
                        {
                            id: "https-enabled",
                            label: "HTTPS",
                            status: "Pass",
                            finding: "Site uses HTTPS.",
                            roiImpact: 90,
                            aiVisibilityImpact: 80,
                            details: { isHttps: true },
                        },
                    ],
                    score: 100,
                    passed: 1,
                    failed: 0,
                    warnings: 0,
                },
            ],
            recommendations: [],
            overallScore: 100,
        };

        const parsed = parseAuditResult(raw);
        const issues = toNormalisedIssues(parsed);
        // Pass items should not produce issues
        expect(issues).toHaveLength(0);
    });
});

// ─── F0-2: SerpFeatureHistory delta logic ────────────────────────────────────
// These tests exercise the pure delta computation logic inline.
// (The actual getSerpFeatureHistory function hits the DB + auth — not tested here.)

describe("SerpFeatureHistory delta computation logic", () => {
    /**
     * Mirrors the delta logic from getSerpFeatureHistory for isolated testing.
     */
    function computeDeltas(
        points: Array<{ hasAiOverview: boolean; hasSnippet: boolean }>
    ) {
        const first = points[0];
        const last = points[points.length - 1];
        return {
            aiOverviewDelta: first && last
                ? (last.hasAiOverview ? 1 : 0) - (first.hasAiOverview ? 1 : 0)
                : 0,
            snippetDelta: first && last
                ? (last.hasSnippet ? 1 : 0) - (first.hasSnippet ? 1 : 0)
                : 0,
        };
    }

    it("returns +1 delta when a feature was gained over the window", () => {
        const points = [
            { hasAiOverview: false, hasSnippet: false },
            { hasAiOverview: false, hasSnippet: false },
            { hasAiOverview: true,  hasSnippet: true },
        ];
        const deltas = computeDeltas(points);
        expect(deltas.aiOverviewDelta).toBe(1);
        expect(deltas.snippetDelta).toBe(1);
    });

    it("returns -1 delta when a feature was lost over the window", () => {
        const points = [
            { hasAiOverview: true, hasSnippet: true },
            { hasAiOverview: true, hasSnippet: true },
            { hasAiOverview: false, hasSnippet: false },
        ];
        const deltas = computeDeltas(points);
        expect(deltas.aiOverviewDelta).toBe(-1);
        expect(deltas.snippetDelta).toBe(-1);
    });

    it("returns 0 delta when feature state is unchanged", () => {
        const points = [
            { hasAiOverview: true, hasSnippet: false },
            { hasAiOverview: true, hasSnippet: false },
        ];
        expect(computeDeltas(points)).toEqual({ aiOverviewDelta: 0, snippetDelta: 0 });
    });

    it("returns 0 for empty points array", () => {
        expect(computeDeltas([])).toEqual({ aiOverviewDelta: 0, snippetDelta: 0 });
    });

    it("handles single-point window with 0 delta", () => {
        const points = [{ hasAiOverview: true, hasSnippet: true }];
        // first === last, so delta is 1 - 1 = 0
        expect(computeDeltas(points)).toEqual({ aiOverviewDelta: 0, snippetDelta: 0 });
    });
});
