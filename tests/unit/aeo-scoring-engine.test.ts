import { describe, it, expect } from "vitest";
import {
    normalizeChecks,
    scorableChecks,
    isCheckEarned,
    computeWeightedScore,
    computeLayerScore,
    scoreToGrade,
    predictCitationLikelihood,
    buildTopRecommendations,
    computeDimensions,
    computeAuditConfidence,
    confidenceLabel,
    isConfidenceSufficientForAlerts,
    IMPACT_WEIGHTS,
    METHODOLOGY_VERSION,
    getScoringMethodology,
} from "@/lib/aeo/scoring";
import type { AeoCheck, CheckStatus } from "@/lib/aeo/index";
import type { MentionResult } from "@/lib/aeo/multi-model";

// ── Test helpers ────────────────────────────────────────────────────────────

function makeCheck(overrides: Partial<AeoCheck> & { id: string }): AeoCheck {
    return {
        category: "content",
        label: "Test check",
        passed: true,
        status: "PASS",
        impact: "medium",
        detail: "test detail",
        recommendation: "test recommendation",
        ...overrides,
    };
}

function makeMentionResult(overrides: Partial<MentionResult> = {}): MentionResult {
    return {
        model: "TestModel",
        mentioned: true,
        confidence: 80,
        providerStatus: "SUCCESS",
        snippet: "test snippet",
        ...overrides,
    };
}

// =============================================================================
// normalize.ts
// =============================================================================

describe("normalizeChecks", () => {
    it("fills status from passed when status is missing", () => {
        const raw = [
            { id: "a", category: "content" as const, label: "A", passed: true, impact: "high" as const, detail: "", recommendation: "" },
            { id: "b", category: "schema" as const, label: "B", passed: false, impact: "low" as const, detail: "", recommendation: "" },
        ];
        const result = normalizeChecks(raw as any);

        expect(result[0].status).toBe("PASS");
        expect(result[1].status).toBe("FAIL");
    });

    it("preserves existing status when already set", () => {
        const raw = [
            { id: "c", category: "technical" as const, label: "C", passed: false, status: "NOT_APPLICABLE" as CheckStatus, impact: "high" as const, detail: "", recommendation: "" },
        ];
        const result = normalizeChecks(raw as any);

        expect(result[0].status).toBe("NOT_APPLICABLE");
    });
});

describe("scorableChecks", () => {
    it("excludes NOT_APPLICABLE and UNKNOWN checks", () => {
        const checks: AeoCheck[] = [
            makeCheck({ id: "pass", status: "PASS" }),
            makeCheck({ id: "fail", status: "FAIL" }),
            makeCheck({ id: "na", status: "NOT_APPLICABLE", passed: false }),
            makeCheck({ id: "unknown", status: "UNKNOWN", passed: false }),
        ];
        const result = scorableChecks(checks);

        expect(result).toHaveLength(2);
        expect(result.map(c => c.id)).toEqual(["pass", "fail"]);
    });
});

describe("isCheckEarned", () => {
    it("returns true for PASS", () => {
        expect(isCheckEarned(makeCheck({ id: "t", status: "PASS" }))).toBe(true);
    });

    it("returns true for PARTIAL", () => {
        expect(isCheckEarned(makeCheck({ id: "t", status: "PARTIAL" }))).toBe(true);
    });

    it("returns false for FAIL", () => {
        expect(isCheckEarned(makeCheck({ id: "t", status: "FAIL", passed: false }))).toBe(false);
    });

    it("returns false for NOT_APPLICABLE", () => {
        expect(isCheckEarned(makeCheck({ id: "t", status: "NOT_APPLICABLE", passed: false }))).toBe(false);
    });
});

// =============================================================================
// aggregate.ts
// =============================================================================

describe("computeWeightedScore", () => {
    it("returns 100 when all checks pass", () => {
        const checks = [
            makeCheck({ id: "a", impact: "high", status: "PASS" }),
            makeCheck({ id: "b", impact: "medium", status: "PASS" }),
            makeCheck({ id: "c", impact: "low", status: "PASS" }),
        ];
        expect(computeWeightedScore(checks)).toBe(100);
    });

    it("returns 0 when all checks fail", () => {
        const checks = [
            makeCheck({ id: "a", impact: "high", status: "FAIL", passed: false }),
            makeCheck({ id: "b", impact: "medium", status: "FAIL", passed: false }),
        ];
        expect(computeWeightedScore(checks)).toBe(0);
    });

    it("returns -1 when no scorable checks exist", () => {
        const checks = [
            makeCheck({ id: "a", status: "NOT_APPLICABLE", passed: false }),
        ];
        expect(computeWeightedScore(checks)).toBe(-1);
    });

    it("weights high-impact checks correctly", () => {
        // 1 high pass (15) + 1 medium fail (0) = 15/23 ≈ 65
        const checks = [
            makeCheck({ id: "a", impact: "high", status: "PASS" }),
            makeCheck({ id: "b", impact: "medium", status: "FAIL", passed: false }),
        ];
        expect(computeWeightedScore(checks)).toBe(Math.round((15 / 23) * 100));
    });

    it("counts PARTIAL as earned", () => {
        const checks = [
            makeCheck({ id: "a", impact: "high", status: "PARTIAL" }),
            makeCheck({ id: "b", impact: "high", status: "FAIL", passed: false }),
        ];
        // 15/30 = 50
        expect(computeWeightedScore(checks)).toBe(50);
    });

    it("excludes UNKNOWN from denominator", () => {
        const checks = [
            makeCheck({ id: "a", impact: "high", status: "PASS" }),
            makeCheck({ id: "b", impact: "high", status: "UNKNOWN", passed: false }),
        ];
        // Only 1 scorable check, and it passes → 100
        expect(computeWeightedScore(checks)).toBe(100);
    });
});

describe("computeLayerScore", () => {
    it("filters by category before scoring", () => {
        const checks = [
            makeCheck({ id: "a", category: "schema", impact: "high", status: "PASS" }),
            makeCheck({ id: "b", category: "content", impact: "high", status: "FAIL", passed: false }),
        ];
        // schema layer: 1 pass → 100
        expect(computeLayerScore(checks, ["schema"])).toBe(100);
        // content layer: 1 fail → 0
        expect(computeLayerScore(checks, ["content"])).toBe(0);
    });

    it("returns -1 for empty category set", () => {
        const checks = [
            makeCheck({ id: "a", category: "schema", status: "PASS" }),
        ];
        expect(computeLayerScore(checks, ["geo"])).toBe(-1);
    });
});

describe("scoreToGrade", () => {
    it.each([
        [100, "A"], [85, "A"], [84, "B"], [70, "B"],
        [69, "C"], [55, "C"], [54, "D"], [40, "D"],
        [39, "F"], [0, "F"],
    ])("maps score %i to grade %s", (score, expected) => {
        expect(scoreToGrade(score)).toBe(expected);
    });
});

describe("predictCitationLikelihood", () => {
    it("returns 100 when all citation-predictive checks pass", () => {
        const checks = [
            makeCheck({ id: "schema_faq", status: "PASS" }),
            makeCheck({ id: "schema_organization", status: "PASS" }),
            makeCheck({ id: "eeat_author", status: "PASS" }),
            makeCheck({ id: "eeat_about", status: "PASS" }),
            makeCheck({ id: "content_definitions", status: "PASS" }),
            makeCheck({ id: "content_statistics", status: "PASS" }),
            makeCheck({ id: "content_entity_density", status: "PASS" }),
            makeCheck({ id: "content_micro_answers", status: "PASS" }),
            makeCheck({ id: "tech_robots", status: "PASS" }),
            makeCheck({ id: "tech_canonical", status: "PASS" }),
        ];
        expect(predictCitationLikelihood(checks)).toBe(100);
    });

    it("returns 0 when all citation-predictive checks fail", () => {
        const checks = [
            makeCheck({ id: "schema_faq", status: "FAIL", passed: false }),
            makeCheck({ id: "content_entity_density", status: "FAIL", passed: false }),
        ];
        expect(predictCitationLikelihood(checks)).toBe(0);
    });

    it("ignores checks without citation prediction weights", () => {
        const checks = [
            makeCheck({ id: "unknown_check", status: "PASS" }),
        ];
        // No weighted checks → 0/0 guarded by || 1 → 0
        expect(predictCitationLikelihood(checks)).toBe(0);
    });
});

describe("buildTopRecommendations", () => {
    it("picks one rec from each layer (AEO, GEO, AIO)", () => {
        const checks = [
            makeCheck({ id: "s1", category: "schema", status: "FAIL", passed: false, impact: "high", recommendation: "Fix schema" }),
            makeCheck({ id: "g1", category: "geo", status: "FAIL", passed: false, impact: "high", recommendation: "Add geo signals" }),
            makeCheck({ id: "a1", category: "aio", status: "FAIL", passed: false, impact: "high", recommendation: "Optimize for AIO" }),
        ];
        const recs = buildTopRecommendations(checks);
        expect(recs).toContain("Fix schema");
        expect(recs).toContain("Add geo signals");
        expect(recs).toContain("Optimize for AIO");
    });

    it("limits to 5 recommendations", () => {
        const checks = Array.from({ length: 10 }, (_, i) =>
            makeCheck({
                id: `c${i}`,
                category: "schema",
                status: "FAIL",
                passed: false,
                impact: "high",
                recommendation: `Rec ${i}`,
            })
        );
        expect(buildTopRecommendations(checks)).toHaveLength(5);
    });

    it("deduplicates recommendations", () => {
        const checks = [
            makeCheck({ id: "s1", category: "schema", status: "FAIL", passed: false, impact: "high", recommendation: "Same rec" }),
            makeCheck({ id: "s2", category: "eeat", status: "FAIL", passed: false, impact: "high", recommendation: "Same rec" }),
        ];
        const recs = buildTopRecommendations(checks);
        expect(recs.filter(r => r === "Same rec")).toHaveLength(1);
    });
});

// =============================================================================
// dimensions.ts
// =============================================================================

describe("computeDimensions", () => {
    it("maps categories to the correct dimensions", () => {
        const checks = [
            makeCheck({ id: "s1", category: "schema", status: "PASS", impact: "high" }),
            makeCheck({ id: "t1", category: "technical", status: "PASS", impact: "high" }),
            makeCheck({ id: "e1", category: "eeat", status: "FAIL", passed: false, impact: "high" }),
            makeCheck({ id: "c1", category: "content", status: "PASS", impact: "high" }),
            makeCheck({ id: "ct1", category: "citation", status: "FAIL", passed: false, impact: "high" }),
        ];

        const dims = computeDimensions(checks, 75);

        // technicalReadiness: schema(pass) + technical(pass) + eeat(fail) = 2/3 ≈ 67
        expect(dims.technicalReadiness).toBe(Math.round((30 / 45) * 100));
        // contentReadiness: content(pass) = 100
        expect(dims.contentReadiness).toBe(100);
        // aiVisibility = GSoV passthrough
        expect(dims.aiVisibility).toBe(75);
        // citationQuality: citation(fail) = 0
        expect(dims.citationQuality).toBe(0);
    });
});

// =============================================================================
// confidence.ts
// =============================================================================

describe("computeAuditConfidence", () => {
    it("returns high confidence when all providers succeed", () => {
        const results = [
            makeMentionResult({ providerStatus: "SUCCESS" }),
            makeMentionResult({ providerStatus: "SUCCESS" }),
            makeMentionResult({ providerStatus: "NO_RESULT" }),
        ];
        const conf = computeAuditConfidence(results);

        expect(conf.level).toBe("high");
        expect(conf.score).toBe(100);
        expect(conf.successfulProviders).toBe(3);
        expect(conf.totalProviders).toBe(3);
    });

    it("returns low confidence when most providers fail", () => {
        const results = [
            makeMentionResult({ providerStatus: "PROVIDER_ERROR" }),
            makeMentionResult({ providerStatus: "PROVIDER_ERROR" }),
            makeMentionResult({ providerStatus: "SUCCESS" }),
            makeMentionResult({ providerStatus: "PROVIDER_ERROR" }),
            makeMentionResult({ providerStatus: "PROVIDER_ERROR" }),
        ];
        const conf = computeAuditConfidence(results);

        expect(conf.level).toBe("low");
        expect(conf.successfulProviders).toBe(1);
    });

    it("returns medium confidence at boundary", () => {
        const results = [
            makeMentionResult({ providerStatus: "SUCCESS" }),
            makeMentionResult({ providerStatus: "PROVIDER_ERROR" }),
            makeMentionResult({ providerStatus: "SUCCESS" }),
            makeMentionResult({ providerStatus: "PROVIDER_ERROR" }),
            makeMentionResult({ providerStatus: "PROVIDER_ERROR" }),
        ];
        const conf = computeAuditConfidence(results);

        // 2/5 = 40 → medium
        expect(conf.level).toBe("medium");
        expect(conf.score).toBe(40);
    });

    it("handles empty results array", () => {
        const conf = computeAuditConfidence([]);
        expect(conf.level).toBe("low");
        expect(conf.score).toBe(0);
    });

    it("counts NO_RESULT as successful (API responded, brand not found)", () => {
        const results = [
            makeMentionResult({ providerStatus: "NO_RESULT", mentioned: false }),
        ];
        const conf = computeAuditConfidence(results);
        expect(conf.successfulProviders).toBe(1);
    });
});

describe("confidenceLabel", () => {
    it("returns descriptive string with provider counts", () => {
        const conf = computeAuditConfidence([
            makeMentionResult({ providerStatus: "SUCCESS" }),
            makeMentionResult({ providerStatus: "PROVIDER_ERROR" }),
        ]);
        const label = confidenceLabel(conf);
        expect(label).toContain("1/2");
    });
});

describe("isConfidenceSufficientForAlerts", () => {
    it("returns false for low confidence", () => {
        const conf = computeAuditConfidence([
            makeMentionResult({ providerStatus: "PROVIDER_ERROR" }),
            makeMentionResult({ providerStatus: "PROVIDER_ERROR" }),
            makeMentionResult({ providerStatus: "SUCCESS" }),
        ]);
        expect(isConfidenceSufficientForAlerts(conf)).toBe(false);
    });

    it("returns true for high confidence with >= 2 providers", () => {
        const conf = computeAuditConfidence([
            makeMentionResult({ providerStatus: "SUCCESS" }),
            makeMentionResult({ providerStatus: "SUCCESS" }),
            makeMentionResult({ providerStatus: "SUCCESS" }),
        ]);
        expect(isConfidenceSufficientForAlerts(conf)).toBe(true);
    });
});

// =============================================================================
// methodology.ts
// =============================================================================

describe("getScoringMethodology", () => {
    it("returns a versioned methodology object", () => {
        const m = getScoringMethodology();
        expect(m.version).toBe(METHODOLOGY_VERSION);
        expect(m.impactWeights).toEqual(IMPACT_WEIGHTS);
        expect(m.gradeThresholds).toHaveLength(5);
        expect(m.scoringNotes.length).toBeGreaterThan(0);
    });

    it("returns serializable JSON", () => {
        const m = getScoringMethodology();
        const json = JSON.stringify(m);
        const parsed = JSON.parse(json);
        expect(parsed.version).toBe(METHODOLOGY_VERSION);
    });
});
