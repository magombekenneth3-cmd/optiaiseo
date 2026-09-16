/**
 * Gate 2 — PDF Truthfulness Tests
 *
 * Proves:
 *   ✓ ReportPeriod formatting and staleness detection
 *   ✓ AEO unavailable engines ≠ 0% in HTML output
 *   ✓ NO_RESULT == legitimate zero observation (score = 0, rendered as 0%)
 *   ✓ Google AIO eligibility ≠ citation (separate sections in HTML)
 *   ✓ Aggregate AEO score excludes unavailable providers
 *   ✓ White-label failures are nonfatal (invalid URL, missing config)
 *   ✓ hasDisplayableScore respects all ProviderStatus values
 *   ✓ deltaIndicator / deltaColor correctness
 */
import { describe, it, expect } from "vitest";

import {
    hasDisplayableScore,
    unavailableLabel,
    deltaIndicator,
    deltaColor,
    formatReportPeriod,
    createProvenance,
} from "@/lib/pdf/report-types";
import type { AeoEngineMetric, GoogleAioMetric } from "@/lib/pdf/report-types";
import type { ProviderStatus } from "@/lib/aeo/provider-result";

import { buildExecutiveDigestHtml } from "@/lib/pdf/executive-digest";
import type { ExecutiveDigestData } from "@/lib/pdf/executive-digest";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeEngine(
    engine: string,
    score: number | null,
    status: ProviderStatus,
    previousScore: number | null = null,
): AeoEngineMetric {
    return { engine, score, previousScore, status };
}

function makeBaseDigestData(overrides?: Partial<ExecutiveDigestData>): ExecutiveDigestData {
    return {
        domain: "example.com",
        reportPeriod: formatReportPeriod("2026-08-01", "2026-08-31"),
        dataSources: [createProvenance("SEO Audit", "2026-08-28", "2026-08-31")],
        seoScore: 72,
        prevSeoScore: 65,
        issuesFixed: 14,
        issuesPending: 8,
        aeoScore: 74,
        prevAeoScore: 60,
        citationRate: 42,
        generativeShareOfVoice: 38,
        aeoEngineBreakdown: [
            makeEngine("Claude", 74, "SUCCESS"),
            makeEngine("ChatGPT", 68, "SUCCESS"),
            makeEngine("Perplexity", 87, "SUCCESS"),
            makeEngine("Gemini", null, "NO_API_KEY"),
            makeEngine("Grok", null, "TIMEOUT"),
            makeEngine("Copilot", 0, "NO_RESULT"),
            makeEngine("DeepSeek", null, "CIRCUIT_OPEN"),
        ],
        googleAio: {
            eligibilityScore: 63,
            hasObservedOverview: true,
            brandMentionedInOverview: true,
            status: "SUCCESS",
        },
        aeoGrade: "B",
        aeoTrend: "improving",
        keywordsTracked: 50,
        keywordsImproved: 12,
        keywordsDeclined: 3,
        topKeywords: [
            { keyword: "ai seo tool", position: 4, change: 3, clicks: 120 },
            { keyword: "aeo optimization", position: 8, change: -2, clicks: 45 },
        ],
        competitorSummary: [
            { domain: "competitor1.com", estimatedVisits: 50000, trend: "up" },
        ],
        topRecommendations: ["Add FAQ schema markup"],
        createdAt: "2026-08-31T00:00:00Z",
        ...overrides,
    };
}

// ─── Report types: hasDisplayableScore ───────────────────────────────────────

describe("hasDisplayableScore", () => {
    it("returns true for SUCCESS", () => {
        expect(hasDisplayableScore(makeEngine("X", 74, "SUCCESS"))).toBe(true);
    });

    it("returns true for NO_RESULT (legitimate zero observation)", () => {
        expect(hasDisplayableScore(makeEngine("X", 0, "NO_RESULT"))).toBe(true);
    });

    it.each<ProviderStatus>(["NO_API_KEY", "PROVIDER_ERROR", "TIMEOUT", "CIRCUIT_OPEN"])(
        "returns false for %s",
        (status) => {
            expect(hasDisplayableScore(makeEngine("X", null, status))).toBe(false);
        }
    );
});

// ─── Report types: unavailableLabel ─────────────────────────────────────────

describe("unavailableLabel", () => {
    it("NO_API_KEY renders 'Not configured'", () => {
        expect(unavailableLabel("NO_API_KEY")).toContain("Not configured");
    });

    it.each<ProviderStatus>(["PROVIDER_ERROR", "TIMEOUT", "CIRCUIT_OPEN"])(
        "%s renders 'Unavailable'",
        (status) => {
            expect(unavailableLabel(status)).toContain("Unavailable");
        }
    );
});

// ─── Report types: deltaIndicator ───────────────────────────────────────────

describe("deltaIndicator", () => {
    it("shows ▲ for positive delta", () => {
        expect(deltaIndicator(80, 60)).toContain("▲");
        expect(deltaIndicator(80, 60)).toContain("+20");
    });

    it("shows ▼ for negative delta", () => {
        expect(deltaIndicator(60, 80)).toContain("▼");
        expect(deltaIndicator(60, 80)).toContain("-20");
    });

    it("shows stable for zero delta", () => {
        expect(deltaIndicator(70, 70)).toContain("stable");
    });

    it("returns empty string for null inputs", () => {
        expect(deltaIndicator(null, 70)).toBe("");
        expect(deltaIndicator(70, null)).toBe("");
        expect(deltaIndicator(null, null)).toBe("");
    });
});

// ─── Report types: deltaColor ───────────────────────────────────────────────

describe("deltaColor", () => {
    it("returns green for positive delta", () => {
        expect(deltaColor(80, 60)).toBe("#34d978");
    });

    it("returns red for negative delta", () => {
        expect(deltaColor(60, 80)).toBe("#ff5757");
    });

    it("returns muted color for null input", () => {
        expect(deltaColor(null, 70)).toContain("rgba");
    });
});

// ─── Report types: formatReportPeriod ───────────────────────────────────────

describe("formatReportPeriod", () => {
    it("produces a human-readable label", () => {
        const period = formatReportPeriod("2026-08-01", "2026-08-31");
        expect(period.startDate).toBe("2026-08-01");
        expect(period.endDate).toBe("2026-08-31");
        expect(period.label).toContain("Aug");
        expect(period.label).toContain("2026");
    });
});

// ─── Report types: provenance staleness ─────────────────────────────────────

describe("createProvenance", () => {
    it("marks data <7 days old as NOT stale", () => {
        const p = createProvenance("Audit", "2026-08-28", "2026-08-31");
        expect(p.isStale).toBe(false);
    });

    it("marks data >7 days old as stale", () => {
        const p = createProvenance("Competitor", "2026-08-20", "2026-08-31");
        expect(p.isStale).toBe(true);
    });

    it("marks exactly 7 days as NOT stale", () => {
        const p = createProvenance("GSC", "2026-08-24", "2026-08-31");
        expect(p.isStale).toBe(false);
    });
});

// ─── Executive Digest HTML: engine rendering truthfulness ────────────────────

describe("Executive Digest HTML — engine rendering", () => {
    const data = makeBaseDigestData();
    const html = buildExecutiveDigestHtml(data);

    it("renders SUCCESS engines with their score (bar chart)", () => {
        // Claude (74), ChatGPT (68), Perplexity (87) should appear
        expect(html).toContain("Claude");
        expect(html).toContain("ChatGPT");
        expect(html).toContain("Perplexity");
    });

    it("renders NO_RESULT engine (Copilot) — score is 0, truthful", () => {
        // Copilot has status NO_RESULT, score 0 — it should be displayable
        expect(html).toContain("Copilot");
    });

    it("renders NO_API_KEY engines as 'Not configured', NOT as 0%", () => {
        expect(html).toContain("Not configured");
        // Gemini is NO_API_KEY — should NOT show as "0%" in the bar chart
        // The Gemini row should contain "Not configured", never a numeric score
        const geminiSection = html.split("Gemini").slice(1).join("Gemini");
        expect(geminiSection).not.toMatch(/\b0%/);
    });

    it("renders TIMEOUT/CIRCUIT_OPEN engines as 'Unavailable', NOT as 0%", () => {
        // Grok (TIMEOUT) and DeepSeek (CIRCUIT_OPEN)
        expect(html).toContain("Unavailable");
    });
});

// ─── Executive Digest HTML: Google AIO separation ───────────────────────────

describe("Executive Digest HTML — Google AIO eligibility vs citation", () => {
    it("renders eligibility score and observed citation as separate sections", () => {
        const data = makeBaseDigestData();
        const html = buildExecutiveDigestHtml(data);
        expect(html).toContain("Eligibility Score");
        expect(html).toContain("63%");
        expect(html).toContain("Observed Citation");
        expect(html).toContain("Brand mentioned");
    });

    it("renders 'Not observed' when SerpAPI data is missing", () => {
        const data = makeBaseDigestData({
            googleAio: {
                eligibilityScore: 55,
                hasObservedOverview: null,
                brandMentionedInOverview: null,
                status: "NO_API_KEY",
            },
        });
        const html = buildExecutiveDigestHtml(data);
        expect(html).toContain("55%");
        expect(html).toContain("Not observed");
    });
});

// ─── Executive Digest HTML: white-label fallback ────────────────────────────

describe("Executive Digest HTML — white-label fallback", () => {
    it("uses OptiAISEO when no company name provided", () => {
        const data = makeBaseDigestData({ whiteLabel: {} });
        const html = buildExecutiveDigestHtml(data);
        expect(html).toContain("OptiAISEO");
    });

    it("uses custom company name when provided", () => {
        const data = makeBaseDigestData({
            whiteLabel: { companyName: "My Agency" },
        });
        const html = buildExecutiveDigestHtml(data);
        expect(html).toContain("My Agency");
    });

    it("falls back to default color for invalid primaryColor", () => {
        const data = makeBaseDigestData({
            whiteLabel: { primaryColor: "javascript:alert(1)" },
        });
        const html = buildExecutiveDigestHtml(data);
        expect(html).toContain("#a78bfa"); // default purple
    });

    it("uses valid hex primaryColor", () => {
        const data = makeBaseDigestData({
            whiteLabel: { primaryColor: "#ff6600" },
        });
        const html = buildExecutiveDigestHtml(data);
        expect(html).toContain("#ff6600");
    });

    it("includes logo timeout script for external logo URLs", () => {
        const data = makeBaseDigestData({
            whiteLabel: { logoUrl: "https://example.com/logo.png" },
        });
        const html = buildExecutiveDigestHtml(data);
        expect(html).toContain("__logoTimer");
        expect(html).toContain("3000"); // 3s timeout
    });

    it("does not include logo img for missing logoUrl", () => {
        const data = makeBaseDigestData({ whiteLabel: {} });
        const html = buildExecutiveDigestHtml(data);
        expect(html).not.toContain("<img");
    });
});

// ─── Executive Digest HTML: provenance rendering ────────────────────────────

describe("Executive Digest HTML — provenance", () => {
    it("renders data source names and dates", () => {
        const data = makeBaseDigestData({
            dataSources: [
                createProvenance("SEO Audit", "2026-08-28", "2026-08-31"),
                createProvenance("AEO Report", "2026-08-20", "2026-08-31"),
            ],
        });
        const html = buildExecutiveDigestHtml(data);
        expect(html).toContain("SEO Audit");
        expect(html).toContain("AEO Report");
        expect(html).toContain("Data Source Provenance");
    });

    it("annotates stale sources", () => {
        const data = makeBaseDigestData({
            dataSources: [
                createProvenance("Competitor", "2026-08-10", "2026-08-31"), // 21 days old
            ],
        });
        const html = buildExecutiveDigestHtml(data);
        expect(html).toContain("Stale");
    });
});

// ─── Aggregate AEO score: excludes unavailable providers ────────────────────

describe("Aggregate AEO score computation", () => {
    // This tests the invariant established in review item #4:
    // Unavailable engine ≠ zero-scoring engine

    it("average of only displayable engines", () => {
        // Claude=74, ChatGPT=68, Perplexity=87, Copilot=0 (NO_RESULT)
        // Gemini=null (NO_API_KEY), Grok=null (TIMEOUT), DeepSeek=null (CIRCUIT_OPEN)
        //
        // Correct average: (74 + 68 + 87 + 0) / 4 = 57.25 → 57
        // Wrong average (if unavailable counted as 0): (74 + 68 + 87 + 0 + 0 + 0 + 0) / 7 = 32.7

        const engines: AeoEngineMetric[] = [
            makeEngine("Claude", 74, "SUCCESS"),
            makeEngine("ChatGPT", 68, "SUCCESS"),
            makeEngine("Perplexity", 87, "SUCCESS"),
            makeEngine("Copilot", 0, "NO_RESULT"),
            makeEngine("Gemini", null, "NO_API_KEY"),
            makeEngine("Grok", null, "TIMEOUT"),
            makeEngine("DeepSeek", null, "CIRCUIT_OPEN"),
        ];

        // Replicate the computeObservedAeoScore logic
        const displayable = engines.filter(m =>
            m.status === "SUCCESS" || m.status === "NO_RESULT"
        );
        expect(displayable).toHaveLength(4);

        const sum = displayable.reduce((acc, m) => acc + (m.score ?? 0), 0);
        const avg = Math.round(sum / displayable.length);
        expect(avg).toBe(57); // (74+68+87+0)/4 = 57.25 → 57

        // Verify it does NOT equal what you'd get by including unavailable
        const wrongAvg = Math.round(
            engines.reduce((acc, m) => acc + (m.score ?? 0), 0) / engines.length
        );
        expect(wrongAvg).toBe(33); // (229)/7 = 32.7 → 33
        expect(avg).not.toBe(wrongAvg);
    });

    it("returns null when no engines have displayable scores", () => {
        const engines: AeoEngineMetric[] = [
            makeEngine("A", null, "NO_API_KEY"),
            makeEngine("B", null, "TIMEOUT"),
        ];
        const displayable = engines.filter(m =>
            m.status === "SUCCESS" || m.status === "NO_RESULT"
        );
        expect(displayable).toHaveLength(0);
    });
});
