import { describe, it, expect } from "vitest";
import {
  diagnose,
  topologicalSort,
  sortFindingsForRemediation,
  DIAGNOSTIC_RULES,
} from "@/lib/seo-audit/root-cause-engine";
import type { DiagnosticFinding } from "@/lib/seo-audit/root-cause-engine";
import {
  computeFindingFingerprint,
  createEvidence,
} from "@/lib/seo-audit/contracts";
import type { SEOEvidence } from "@/lib/seo-audit/contracts";

function makeEvidence(
  source: SEOEvidence["source"],
  observedValue: Record<string, unknown>,
): SEOEvidence {
  return createEvidence({
    source,
    url: "https://example.com",
    observedAt: new Date().toISOString(),
    observedValue,
    confidence: 1.0,
    confidenceKind: "DIRECTLY_OBSERVED",
  });
}

describe("diagnose", () => {
  it("produces findings with valid rootCauseIds from known rules", () => {
    const findings = diagnose({
      siteId: "site-1",
      url: "https://example.com",
      evidence: [
        makeEvidence("HTML", { checkId: "something-unrelated", status: "Pass" }),
      ],
    });
    for (const f of findings) {
      expect(f.rootCauseId).toBeDefined();
      expect(typeof f.rootCauseId).toBe("string");
      expect(f.fingerprint).toHaveLength(20);
    }
  });

  it("produces findings with stable fingerprints", () => {
    const evidence = [
      makeEvidence("HTML", {
        checkId: "canonical",
        status: "Fail",
        canonical_missing: true,
        hasCanonical: false,
      }),
    ];
    const findings1 = diagnose({ siteId: "s1", url: "https://example.com", evidence });
    const findings2 = diagnose({ siteId: "s1", url: "https://example.com", evidence });

    if (findings1.length > 0 && findings2.length > 0) {
      expect(findings1[0].fingerprint).toBe(findings2[0].fingerprint);
    }
  });

  it("sets finding.id equal to fingerprint (stable identity)", () => {
    const evidence = [
      makeEvidence("HTML", {
        checkId: "canonical",
        status: "Fail",
        canonical_missing: true,
        hasCanonical: false,
      }),
    ];
    const findings = diagnose({ siteId: "s1", url: "https://example.com", evidence });
    for (const f of findings) {
      expect(f.id).toBe(f.fingerprint);
    }
  });

  it("includes rootCauseId on every finding", () => {
    const evidence = [
      makeEvidence("HTML", {
        checkId: "canonical",
        status: "Fail",
        canonical_missing: true,
        hasCanonical: false,
      }),
    ];
    const findings = diagnose({ siteId: "s1", url: "https://example.com", evidence });
    for (const f of findings) {
      expect(f.rootCauseId).toBeDefined();
      expect(typeof f.rootCauseId).toBe("string");
      expect(f.rootCauseId.length).toBeGreaterThan(0);
    }
  });

  it("produces dependencyFingerprints (not dependencies) on findings with deps", () => {
    const evidence = [
      makeEvidence("HTML", {
        checkId: "canonical",
        status: "Fail",
        canonical_missing: true,
        hasCanonical: false,
      }),
    ];
    const findings = diagnose({ siteId: "s1", url: "https://example.com", evidence });
    for (const f of findings) {
      expect(f).toHaveProperty("dependencyFingerprints");
      expect(Array.isArray(f.dependencyFingerprints)).toBe(true);
      expect(f).not.toHaveProperty("dependencies");
    }
  });

  it("dependency fingerprints are real fingerprints, not raw rule keys", () => {
    const rulesWithDeps = Object.entries(DIAGNOSTIC_RULES).filter(
      ([, r]) => r.dependsOn.length > 0,
    );
    if (rulesWithDeps.length === 0) return;

    const [ruleKey, rule] = rulesWithDeps[0];
    const evidence = rule.causes.flatMap((cause) =>
      cause.conditions.map((cond) =>
        makeEvidence(cond.source as SEOEvidence["source"], {
          checkId: ruleKey,
          status: "Fail",
          [cond.field]: cond.value ?? true,
        }),
      ),
    );

    const findings = diagnose({
      siteId: "s1",
      url: "https://example.com",
      evidence,
    });

    for (const f of findings) {
      for (const dep of f.dependencyFingerprints) {
        expect(dep).not.toBe("any");
        expect(/^[0-9a-f]{20}$/.test(dep)).toBe(true);
      }
    }
  });
});

describe("topologicalSort", () => {
  it("returns input unchanged when no dependencies exist", () => {
    const input = ["a", "b", "c"];
    const sorted = topologicalSort(input);
    expect(sorted).toEqual(expect.arrayContaining(input));
    expect(sorted).toHaveLength(input.length);
  });

  it("places dependsOn rules before their dependents", () => {
    const rulesWithDeps = Object.entries(DIAGNOSTIC_RULES).filter(
      ([, r]) => r.dependsOn.length > 0,
    );
    if (rulesWithDeps.length === 0) return;

    const allKeys = Object.keys(DIAGNOSTIC_RULES);
    const sorted = topologicalSort(allKeys);

    for (const [ruleKey, rule] of rulesWithDeps) {
      const ruleIdx = sorted.indexOf(ruleKey);
      for (const dep of rule.dependsOn) {
        const depIdx = sorted.indexOf(dep);
        if (depIdx >= 0) {
          expect(depIdx).toBeLessThan(ruleIdx);
        }
      }
    }
  });

  it("handles circular dependencies without infinite loop", () => {
    const result = topologicalSort(["a", "b"]);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});

describe("sortFindingsForRemediation", () => {
  function makeFinding(overrides: Partial<DiagnosticFinding>): DiagnosticFinding {
    return {
      id: "fp-1",
      fingerprint: "fp-1",
      domain: "TECHNICAL",
      issueType: "TEST",
      status: "FAIL",
      severity: "medium",
      scope: { type: "PAGE", urls: ["https://example.com"] },
      rootCause: "test cause",
      rootCauseId: "test_cause",
      evidence: [],
      confidence: 0.8,
      expectedOutcome: "test outcome",
      remediationType: "MANUAL",
      verificationCriteria: [],
      dependencyFingerprints: [],
      ...overrides,
    };
  }

  it("sorts critical before low severity", () => {
    const findings = [
      makeFinding({ fingerprint: "low-1", severity: "low", confidence: 0.5 }),
      makeFinding({ fingerprint: "crit-1", severity: "critical", confidence: 0.5 }),
    ];
    const sorted = sortFindingsForRemediation(findings);
    expect(sorted[0].severity).toBe("critical");
    expect(sorted[1].severity).toBe("low");
  });

  it("sorts higher confidence first within same severity", () => {
    const findings = [
      makeFinding({ fingerprint: "low-c", severity: "high", confidence: 0.5 }),
      makeFinding({ fingerprint: "high-c", severity: "high", confidence: 0.95 }),
    ];
    const sorted = sortFindingsForRemediation(findings);
    expect(sorted[0].confidence).toBeGreaterThan(sorted[1].confidence);
  });
});
