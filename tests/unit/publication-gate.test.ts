import { describe, it, expect } from "vitest";
import {
    getPublicationBlockers,
    canPublishBlog,
    buildPublicationDecision,
    type IndependentGateResult,
    type GateStatus,
} from "@/lib/blog/publication-gate";

function makeGate(overrides: Partial<IndependentGateResult> = {}): IndependentGateResult {
    return {
        name: "Test",
        status: "PASS",
        isHard: false,
        issues: [],
        warnings: [],
        ...overrides,
    };
}

describe("getPublicationBlockers", () => {
    it("returns empty when all gates pass", () => {
        const gates = [
            makeGate({ name: "Research", isHard: true }),
            makeGate({ name: "Evidence", isHard: true }),
            makeGate({ name: "SEO", isHard: false }),
        ];
        expect(getPublicationBlockers(gates)).toHaveLength(0);
    });

    it("returns blockers only from hard gates that FAIL", () => {
        const gates = [
            makeGate({ name: "Research", isHard: true, status: "FAIL", issues: ["No sources."] }),
            makeGate({ name: "SEO", isHard: false, status: "FAIL", issues: ["Missing keyword."] }),
            makeGate({ name: "Evidence", isHard: true, status: "PASS" }),
        ];
        const blockers = getPublicationBlockers(gates);
        expect(blockers).toHaveLength(1);
        expect(blockers[0]).toContain("[Research]");
        expect(blockers[0]).toContain("No sources.");
    });

    it("ignores hard gates in REVIEW status", () => {
        const gates = [
            makeGate({ name: "Schema", isHard: true, status: "REVIEW", issues: ["Title too long."] }),
        ];
        expect(getPublicationBlockers(gates)).toHaveLength(0);
    });
});

describe("canPublishBlog", () => {
    it("returns true when all hard gates pass", () => {
        const gates = [
            makeGate({ name: "Research", isHard: true, status: "PASS" }),
            makeGate({ name: "Evidence", isHard: true, status: "PASS" }),
            makeGate({ name: "Claims", isHard: true, status: "PASS" }),
            makeGate({ name: "Schema", isHard: true, status: "PASS" }),
            makeGate({ name: "Originality", isHard: false, status: "FAIL" }),
        ];
        expect(canPublishBlog(gates)).toBe(true);
    });

    it("returns false when any hard gate fails", () => {
        const gates = [
            makeGate({ name: "Research", isHard: true, status: "PASS" }),
            makeGate({ name: "Claims", isHard: true, status: "FAIL", issues: ["Fabrication risk."] }),
        ];
        expect(canPublishBlog(gates)).toBe(false);
    });

    it("returns true when hard gates are REVIEW but not FAIL", () => {
        const gates = [
            makeGate({ name: "Research", isHard: true, status: "REVIEW" }),
            makeGate({ name: "Evidence", isHard: true, status: "PASS" }),
        ];
        expect(canPublishBlog(gates)).toBe(true);
    });
});

describe("buildPublicationDecision", () => {
    it("returns DRAFT when all gates pass", () => {
        const gates = [
            makeGate({ name: "Research", isHard: true, status: "PASS" }),
            makeGate({ name: "Evidence", isHard: true, status: "PASS" }),
            makeGate({ name: "Claims", isHard: true, status: "PASS" }),
            makeGate({ name: "Schema", isHard: true, status: "PASS" }),
            makeGate({ name: "SEO", isHard: false, status: "PASS" }),
        ];
        const decision = buildPublicationDecision(gates, "AVAILABLE");
        expect(decision.canPublish).toBe(true);
        expect(decision.status).toBe("DRAFT");
        expect(decision.blockers).toHaveLength(0);
        expect(decision.legacyResult.passed).toBe(true);
    });

    it("returns EVIDENCE_REVIEW when research gate fails", () => {
        const gates = [
            makeGate({ name: "Research", isHard: true, status: "FAIL", issues: ["No sources available."] }),
            makeGate({ name: "Evidence", isHard: true, status: "PASS" }),
            makeGate({ name: "Claims", isHard: true, status: "PASS" }),
            makeGate({ name: "Schema", isHard: true, status: "PASS" }),
        ];
        const decision = buildPublicationDecision(gates, "AVAILABLE");
        expect(decision.canPublish).toBe(false);
        expect(decision.status).toBe("EVIDENCE_REVIEW");
        expect(decision.blockers.length).toBeGreaterThan(0);
    });

    it("returns REJECTED when fabrication detected in claims gate", () => {
        const gates = [
            makeGate({ name: "Research", isHard: true, status: "PASS" }),
            makeGate({ name: "Evidence", isHard: true, status: "PASS" }),
            makeGate({ name: "Claims", isHard: true, status: "FAIL", issues: ["Fabrication risk: invented statistic."] }),
            makeGate({ name: "Schema", isHard: true, status: "PASS" }),
        ];
        const decision = buildPublicationDecision(gates, "AVAILABLE");
        expect(decision.canPublish).toBe(false);
        expect(decision.status).toBe("REJECTED");
    });

    it("returns NEEDS_REVIEW when only soft gates have issues", () => {
        const gates = [
            makeGate({ name: "Research", isHard: true, status: "PASS" }),
            makeGate({ name: "Evidence", isHard: true, status: "PASS" }),
            makeGate({ name: "Claims", isHard: true, status: "PASS" }),
            makeGate({ name: "Schema", isHard: true, status: "PASS" }),
            makeGate({ name: "Originality", isHard: false, status: "REVIEW", issues: ["Weak sections detected."] }),
        ];
        const decision = buildPublicationDecision(gates, "AVAILABLE");
        expect(decision.canPublish).toBe(false);
        expect(decision.status).toBe("NEEDS_REVIEW");
        expect(decision.reviewReasons.length).toBeGreaterThan(0);
    });

    it("returns EVIDENCE_REVIEW when evidence not available regardless of gates", () => {
        const gates = [
            makeGate({ name: "Research", isHard: true, status: "PASS" }),
            makeGate({ name: "Evidence", isHard: true, status: "PASS" }),
            makeGate({ name: "Claims", isHard: true, status: "PASS" }),
            makeGate({ name: "Schema", isHard: true, status: "PASS" }),
        ];
        const decision = buildPublicationDecision(gates, "UNAVAILABLE");
        expect(decision.canPublish).toBe(false);
        expect(decision.status).toBe("EVIDENCE_REVIEW");
    });

    it("provides human-readable summary", () => {
        const gates = [
            makeGate({ name: "Research", isHard: true, status: "PASS" }),
            makeGate({ name: "Schema", isHard: true, status: "FAIL", issues: ["Content is 50 words — minimum is 300."] }),
        ];
        const decision = buildPublicationDecision(gates, "AVAILABLE");
        expect(decision.summary).toContain("blocked");
        expect(decision.summary).toContain("Schema");
    });

    it("preserves legacy result shape", () => {
        const gates = [
            makeGate({ name: "Research", isHard: true, status: "PASS" }),
            makeGate({ name: "Evidence", isHard: true, status: "PASS" }),
            makeGate({ name: "Claims", isHard: true, status: "PASS" }),
            makeGate({ name: "Schema", isHard: true, status: "PASS" }),
        ];
        const decision = buildPublicationDecision(gates, "AVAILABLE");
        const legacy = decision.legacyResult;
        expect(legacy).toHaveProperty("passed");
        expect(legacy).toHaveProperty("status");
        expect(legacy).toHaveProperty("evidenceAvailability");
        expect(legacy).toHaveProperty("blockingIssues");
        expect(legacy).toHaveProperty("warnings");
        expect(legacy).toHaveProperty("evidenceIssues");
        expect(legacy).toHaveProperty("originalityIssues");
        expect(legacy).toHaveProperty("repetitionIssues");
        expect(legacy).toHaveProperty("fabricationIssues");
    });

    it("each gate has independent status", () => {
        const gates: IndependentGateResult[] = [
            makeGate({ name: "Research", isHard: true, status: "PASS" }),
            makeGate({ name: "Evidence", isHard: true, status: "FAIL", issues: ["Missing sources."] }),
            makeGate({ name: "Claims", isHard: true, status: "REVIEW", warnings: ["Weak evidence."] }),
            makeGate({ name: "Originality", isHard: false, status: "PASS" }),
            makeGate({ name: "SEO", isHard: false, status: "REVIEW", warnings: ["Missing keyword."] }),
            makeGate({ name: "Schema", isHard: true, status: "PASS" }),
            makeGate({ name: "Editorial", isHard: false, status: "PASS" }),
        ];
        const decision = buildPublicationDecision(gates, "AVAILABLE");
        expect(decision.gates).toHaveLength(7);
        expect(decision.gates.find(g => g.name === "Evidence")?.status).toBe("FAIL");
        expect(decision.gates.find(g => g.name === "Claims")?.status).toBe("REVIEW");
        expect(decision.gates.find(g => g.name === "Originality")?.status).toBe("PASS");
        expect(decision.canPublish).toBe(false);
    });
});
