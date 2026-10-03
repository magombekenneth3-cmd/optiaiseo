import { describe, it, expect } from "vitest";
import {
  buildRemediationPlan,
  getExecutableActions,
  partitionByType,
} from "@/lib/seo-audit/remediation-planner";
import type { DiagnosticFinding } from "@/lib/seo-audit/root-cause-engine";
import { createEvidence } from "@/lib/seo-audit/contracts";

function makeFinding(overrides: Partial<DiagnosticFinding> = {}): DiagnosticFinding {
  return {
    id: "fp-test",
    fingerprint: "fp-test",
    domain: "TECHNICAL",
    issueType: "CANONICAL_ISSUES",
    status: "FAIL",
    severity: "high",
    scope: { type: "PAGE", urls: ["https://example.com"] },
    rootCause: "Missing canonical tag",
    rootCauseId: "canonical_missing",
    evidence: [
      createEvidence({
        source: "HTML",
        url: "https://example.com",
        observedAt: new Date().toISOString(),
        observedValue: { hasCanonical: false },
        confidence: 1.0,
        confidenceKind: "DIRECTLY_OBSERVED",
      }),
    ],
    confidence: 1.0,
    expectedOutcome: "Self-referencing canonical tag present",
    remediationType: "DETERMINISTIC",
    verificationCriteria: [
      { type: "HTML_SELECTOR", selector: 'link[rel="canonical"]', expected: "https://example.com" },
    ],
    dependencyFingerprints: [],
    ...overrides,
  };
}

describe("buildRemediationPlan", () => {
  const ctx = {
    siteId: "site-1",
    url: "https://example.com",
    domain: "example.com",
    totalPages: 50,
  };

  it("generates a plan with correct summary counts", () => {
    const findings: DiagnosticFinding[] = [
      makeFinding({ fingerprint: "f1", rootCauseId: "canonical_missing", remediationType: "DETERMINISTIC" }),
      makeFinding({ fingerprint: "f2", rootCauseId: "unknown_cause", remediationType: "AI_PATCH", issueType: "OTHER" }),
      makeFinding({ fingerprint: "f3", rootCauseId: "manual_only", remediationType: "MANUAL", issueType: "OTHER2" }),
    ];
    const plan = buildRemediationPlan(findings, ctx);
    expect(plan.findingsCount).toBe(3);
    expect(plan.summary.deterministic).toBeGreaterThanOrEqual(1);
    expect(plan.actions).toHaveLength(3);
  });

  it("uses rootCauseId for deterministic fix lookup", () => {
    const findings = [makeFinding({ fingerprint: "f1", rootCauseId: "canonical_missing" })];
    const plan = buildRemediationPlan(findings, ctx);
    const action = plan.actions[0];
    expect(action.rootCauseId).toBe("canonical_missing");
    expect(action.remediationType).toBe("DETERMINISTIC");
    expect(action.deterministicFix).toBeDefined();
  });

  it("sets findingId to fingerprint (not a synthetic timestamp ID)", () => {
    const findings = [makeFinding({ fingerprint: "abc123" })];
    const plan = buildRemediationPlan(findings, ctx);
    expect(plan.actions[0].findingId).toBe("abc123");
    expect(plan.actions[0].findingFingerprint).toBe("abc123");
  });

  it("populates blockedBy from dependencyFingerprints", () => {
    const findings = [
      makeFinding({ fingerprint: "f1", dependencyFingerprints: ["dep-a", "dep-b"] }),
    ];
    const plan = buildRemediationPlan(findings, ctx);
    expect(plan.actions[0].blockedBy).toEqual(["dep-a", "dep-b"]);
  });

  it("assigns priority scores between 0 and 100", () => {
    const findings = [makeFinding()];
    const plan = buildRemediationPlan(findings, ctx);
    expect(plan.actions[0].priority.score).toBeGreaterThanOrEqual(0);
    expect(plan.actions[0].priority.score).toBeLessThanOrEqual(100);
    expect(plan.actions[0].priority.policyVersion).toBe("priority-v4");
  });

  it("skips PASS findings", () => {
    const findings = [
      makeFinding({ fingerprint: "pass-1", status: "PASS" }),
      makeFinding({ fingerprint: "fail-1", status: "FAIL" }),
    ];
    const plan = buildRemediationPlan(findings, ctx);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].findingFingerprint).toBe("fail-1");
  });
});

describe("getExecutableActions", () => {
  it("returns unblocked PLANNED actions", () => {
    const findings = [
      makeFinding({ fingerprint: "f1", dependencyFingerprints: [] }),
      makeFinding({ fingerprint: "f2", dependencyFingerprints: ["f1"] }),
    ];
    const ctx = { siteId: "s", url: "u", domain: "d", totalPages: 1 };
    const plan = buildRemediationPlan(findings, ctx);

    const executable1 = getExecutableActions(plan, new Set());
    const unblockedFps = executable1.map((a) => a.findingFingerprint);
    expect(unblockedFps).toContain("f1");
    expect(unblockedFps).not.toContain("f2");

    const executable2 = getExecutableActions(plan, new Set(["f1"]));
    const unblockedFps2 = executable2.map((a) => a.findingFingerprint);
    expect(unblockedFps2).toContain("f2");
  });
});

describe("partitionByType", () => {
  it("partitions actions by remediation type", () => {
    const findings = [
      makeFinding({ fingerprint: "f1", remediationType: "DETERMINISTIC", rootCauseId: "canonical_missing" }),
      makeFinding({ fingerprint: "f2", remediationType: "MANUAL", rootCauseId: "unknown", issueType: "OTHER" }),
    ];
    const ctx = { siteId: "s", url: "u", domain: "d", totalPages: 1 };
    const plan = buildRemediationPlan(findings, ctx);
    const parts = partitionByType(plan);
    expect(parts.deterministic.length + parts.aiPatch.length + parts.manual.length + parts.experiment.length)
      .toBe(plan.actions.length);
  });
});
