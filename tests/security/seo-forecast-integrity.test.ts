/**
 * Phase 5 regression tests — SEO forecasts and data integrity.
 *
 * BUG-5A: Decision ranker must NOT hardcode confidence=88
 * BUG-5B: Traffic potential must use impression-based CTR curve
 * BUG-5C: Legacy tracker must NOT fabricate synthetic positive lift
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(`${ROOT}/${rel}`, "utf8");

const trackerSrc = read("src/lib/experiments/tracker.ts");
const rankerSrc = read("src/lib/opportunity-engine/decision-ranker.ts");
const findingsToOppSrc = read("src/lib/opportunity-engine/findings-to-opportunities.ts");
const calibrationSrc = read("src/lib/growth/empirical-calibration.ts");

// ─────────────────────────────────────────────────────────────────────────────
// BUG-5A: Decision ranker empirical confidence
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-5A: Decision ranker uses empirical confidence", () => {
    it("should NOT hardcode confidence = 88", () => {
        // Search for the exact hardcoded pattern (but not in comments)
        const lines = rankerSrc.split("\n");
        const codeLine = lines.find(
            (l) => l.includes("confidence = 88") && !l.trim().startsWith("//")
        );
        expect(codeLine).toBeUndefined();
    });

    it("should import calculateSampleWeightedConfidence", () => {
        expect(rankerSrc).toContain("calculateSampleWeightedConfidence");
        expect(rankerSrc).toContain("empirical-calibration");
    });

    it("should call calculateSampleWeightedConfidence for confidence", () => {
        expect(rankerSrc).toContain("calibration.calibratedConfidence");
    });

    it("calibration module should enforce bounded 0-100 output", () => {
        expect(calibrationSrc).toContain("Math.max(1, Math.min(100,");
    });

    it("calibration module should have evidence tiers with appropriate weights", () => {
        expect(calibrationSrc).toContain('"NONE"');
        expect(calibrationSrc).toContain('"WEAK"');
        expect(calibrationSrc).toContain('"MEANINGFUL"');
        expect(calibrationSrc).toContain('"STRONG"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-5B: Traffic potential uses impression-based CTR curve
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-5B: Traffic potential uses impression-based CTR curve", () => {
    it("should have an estimateImpressionsFromFinding helper", () => {
        expect(findingsToOppSrc).toContain("estimateImpressionsFromFinding");
    });

    it("should use impression-based CTR rates (4%, 12%, 22%)", () => {
        // These are the standard CTR curve values from decision-ranker.ts
        expect(findingsToOppSrc).toContain("estImpressions * 0.04");
        expect(findingsToOppSrc).toContain("estImpressions * 0.12");
        expect(findingsToOppSrc).toContain("estImpressions * 0.22");
    });

    it("should fall back to score-based when impressions unavailable", () => {
        expect(findingsToOppSrc).toContain("estImpressions > 0");
        expect(findingsToOppSrc).toContain("Math.round(finalScore *");
    });

    it("estimateImpressionsFromFinding should parse evidence metric values", () => {
        const helperIdx = findingsToOppSrc.indexOf("function estimateImpressionsFromFinding");
        expect(helperIdx).toBeGreaterThan(-1);
        const helperBlock = findingsToOppSrc.substring(helperIdx, helperIdx + 400);
        expect(helperBlock).toContain('ev.metric === "impressions"');
        expect(helperBlock).toContain("parseInt(ev.value, 10)");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-5C: No synthetic positive lift fabrication
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-5C: Legacy tracker does NOT fabricate synthetic lift", () => {
    it("should NOT contain synthetic post-metrics (position: 18, clicks: 15)", () => {
        // The old code had these hardcoded synthetic positive values
        expect(trackerSrc).not.toContain("position: 18.0");
        expect(trackerSrc).not.toContain("clicks: 15,");
        expect(trackerSrc).not.toContain("impressions: 700,");
    });

    it("should mark seed-baseline experiments as INSUFFICIENT_DATA", () => {
        expect(trackerSrc).toContain("Both baseline and post are synthetic");
        expect(trackerSrc).toContain("INSUFFICIENT_DATA");
    });

    it("should NOT override postMetrics with fabricated values", () => {
        // The old code assigned postMetrics = { position: 18.0, ... } for seed baselines
        // Ensure there's no assignment of fabricated metrics to postMetrics
        const seedBlock = trackerSrc.substring(
            trackerSrc.indexOf("baselineIsSeed"),
            trackerSrc.indexOf("baselineIsSeed") + 600
        );
        expect(seedBlock).not.toContain("postMetrics = {");
    });

    it("should log reason for INSUFFICIENT_DATA marking", () => {
        expect(trackerSrc).toContain("Cannot evaluate lift without real GSC data");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Data integrity invariants
// ─────────────────────────────────────────────────────────────────────────────
describe("Data integrity invariants", () => {
    const evaluatorSrc = read("src/lib/experiments/evaluator.ts");
    const safetySrc = read("src/lib/experiments/safety.ts");
    const evidenceSnapshotSrc = read("src/lib/opportunity-engine/evidence-snapshot.ts");

    it("D.5 evaluator should use difference-in-differences for outcome classification", () => {
        expect(evaluatorSrc).toContain("treatmentImprovement - controlImprovement");
    });

    it("evaluator should classify WIN, LOSS, and INCONCLUSIVE based on threshold", () => {
        expect(evaluatorSrc).toContain("delta >= threshold");
        expect(evaluatorSrc).toContain("delta <= -threshold");
        expect(evaluatorSrc).toContain('"INCONCLUSIVE"');
    });

    it("safety module should enforce duration cap", () => {
        expect(safetySrc).toContain("DURATION_EXCEEDED");
    });

    it("safety module should enforce position drop auto-abort", () => {
        expect(safetySrc).toContain("POSITION_DROP");
        expect(safetySrc).toContain("autoAbortPositionDrop");
    });

    it("evidence snapshots should use SHA-256 checksums", () => {
        expect(evidenceSnapshotSrc).toContain('createHash("sha256")');
    });

    it("evidence snapshots should be create-only (immutable)", () => {
        expect(evidenceSnapshotSrc).toContain("Create-only semantics");
        // Should not have Prisma .update() calls — only .create() and .findUnique()
        // The file does use createHash().update() for crypto, which is fine.
        expect(evidenceSnapshotSrc).not.toContain("evidenceSnapshot.update(");
        expect(evidenceSnapshotSrc).not.toContain("evidenceSnapshot.upsert(");
    });

    it("opportunity scoring weights should sum to 1.0", () => {
        const weightsMatch = findingsToOppSrc.match(
            /impact:\s*([\d.]+)[\s\S]*?confidence:\s*([\d.]+)[\s\S]*?trafficValue:\s*([\d.]+)[\s\S]*?effort:\s*([\d.]+)[\s\S]*?strategicValue:\s*([\d.]+)/
        );
        if (weightsMatch) {
            const sum = parseFloat(weightsMatch[1]) + parseFloat(weightsMatch[2]) +
                parseFloat(weightsMatch[3]) + parseFloat(weightsMatch[4]) + parseFloat(weightsMatch[5]);
            expect(sum).toBeCloseTo(1.0, 2);
        }
    });
});
