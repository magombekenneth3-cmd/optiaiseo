/**
 * tests/unit/remediation-safety.test.ts
 *
 * Phase 3 — Remediation Safety tests.
 *
 * Verifies:
 *   1. EVIDENCE_QUALITY_GATES enforce remediation type restrictions
 *   2. gateRemediationType() downgrades correctly
 *   3. bestEvidenceConfidence() returns correct ranks
 *   4. AiPatchResult contract is enforced
 *   5. AEO fix adapter produces canonical DiagnosticFindings
 *   6. Remediation planner uses evidence gates
 */

import { describe, it, expect } from "vitest";

import {
  EVIDENCE_QUALITY_GATES,
  CONFIDENCE_RANK,
  bestEvidenceConfidence,
  gateRemediationType,
  type EvidenceConfidenceKind,
  type RemediationType,
  type SEOEvidence,
  type AiPatchResult,
} from "@/lib/seo-audit/contracts";

import {
  aeoCheckToFinding,
  constrainAeoPatch,
  adaptAeoChecksToDiagnosticFindings,
} from "@/lib/aeo/fix-adapter";

// ── EVIDENCE_QUALITY_GATES ──────────────────────────────────────────────────

describe("EVIDENCE_QUALITY_GATES", () => {
  it("DIRECTLY_OBSERVED allows all remediation types", () => {
    const allowed = EVIDENCE_QUALITY_GATES.DIRECTLY_OBSERVED;
    expect(allowed).toContain("DETERMINISTIC");
    expect(allowed).toContain("AI_PATCH");
    expect(allowed).toContain("MANUAL");
    expect(allowed).toContain("EXPERIMENT");
  });

  it("DERIVED does NOT allow DETERMINISTIC", () => {
    const allowed = EVIDENCE_QUALITY_GATES.DERIVED;
    expect(allowed).not.toContain("DETERMINISTIC");
    expect(allowed).toContain("AI_PATCH");
    expect(allowed).toContain("MANUAL");
  });

  it("INFERRED only allows EXPERIMENT and MANUAL", () => {
    const allowed = EVIDENCE_QUALITY_GATES.INFERRED;
    expect(allowed).not.toContain("DETERMINISTIC");
    expect(allowed).not.toContain("AI_PATCH");
    expect(allowed).toContain("EXPERIMENT");
    expect(allowed).toContain("MANUAL");
  });

  it("UNAVAILABLE allows NOTHING — never auto-fix", () => {
    expect(EVIDENCE_QUALITY_GATES.UNAVAILABLE).toHaveLength(0);
  });
});

// ── CONFIDENCE_RANK ─────────────────────────────────────────────────────────

describe("CONFIDENCE_RANK", () => {
  it("ranks DIRECTLY_OBSERVED highest", () => {
    expect(CONFIDENCE_RANK.DIRECTLY_OBSERVED).toBeGreaterThan(CONFIDENCE_RANK.DERIVED);
    expect(CONFIDENCE_RANK.DERIVED).toBeGreaterThan(CONFIDENCE_RANK.INFERRED);
    expect(CONFIDENCE_RANK.INFERRED).toBeGreaterThan(CONFIDENCE_RANK.UNAVAILABLE);
  });
});

// ── bestEvidenceConfidence ──────────────────────────────────────────────────

describe("bestEvidenceConfidence", () => {
  const makeEvidence = (kind: EvidenceConfidenceKind): SEOEvidence => ({
    source: "HTML",
    url: "https://example.com",
    observedAt: new Date().toISOString(),
    observedValue: "test",
    confidence: 0.5,
    confidenceKind: kind,
    evidenceHash: "testhash123",
  });

  it("returns UNAVAILABLE for empty evidence array", () => {
    expect(bestEvidenceConfidence([])).toBe("UNAVAILABLE");
  });

  it("returns DIRECTLY_OBSERVED when any evidence is directly observed", () => {
    const evidence = [
      makeEvidence("INFERRED"),
      makeEvidence("DIRECTLY_OBSERVED"),
      makeEvidence("DERIVED"),
    ];
    expect(bestEvidenceConfidence(evidence)).toBe("DIRECTLY_OBSERVED");
  });

  it("returns DERIVED when no directly observed evidence exists", () => {
    const evidence = [
      makeEvidence("INFERRED"),
      makeEvidence("DERIVED"),
    ];
    expect(bestEvidenceConfidence(evidence)).toBe("DERIVED");
  });

  it("returns INFERRED when only inferred evidence exists", () => {
    const evidence = [makeEvidence("INFERRED")];
    expect(bestEvidenceConfidence(evidence)).toBe("INFERRED");
  });
});

// ── gateRemediationType ─────────────────────────────────────────────────────

describe("gateRemediationType", () => {
  const makeEvidence = (kind: EvidenceConfidenceKind): SEOEvidence => ({
    source: "HTML",
    url: "https://example.com",
    observedAt: new Date().toISOString(),
    observedValue: "test",
    confidence: 0.5,
    confidenceKind: kind,
    evidenceHash: "testhash123",
  });

  it("allows DETERMINISTIC with DIRECTLY_OBSERVED evidence", () => {
    const result = gateRemediationType("DETERMINISTIC", [makeEvidence("DIRECTLY_OBSERVED")]);
    expect(result.allowed).toBe(true);
    expect(result.effectiveType).toBe("DETERMINISTIC");
  });

  it("blocks DETERMINISTIC with DERIVED evidence → downgrades to AI_PATCH", () => {
    const result = gateRemediationType("DETERMINISTIC", [makeEvidence("DERIVED")]);
    expect(result.allowed).toBe(false);
    expect(result.effectiveType).toBe("AI_PATCH");
    expect(result.reason).toContain("DERIVED");
  });

  it("blocks AI_PATCH with INFERRED evidence → downgrades to EXPERIMENT", () => {
    const result = gateRemediationType("AI_PATCH", [makeEvidence("INFERRED")]);
    expect(result.allowed).toBe(false);
    expect(result.effectiveType).toBe("EXPERIMENT");
  });

  it("blocks everything with UNAVAILABLE evidence → returns null", () => {
    const result = gateRemediationType("DETERMINISTIC", [makeEvidence("UNAVAILABLE")]);
    expect(result.allowed).toBe(false);
    expect(result.effectiveType).toBeNull();
    expect(result.reason).toContain("UNAVAILABLE");
  });

  it("blocks everything with NO evidence → returns null", () => {
    const result = gateRemediationType("AI_PATCH", []);
    expect(result.allowed).toBe(false);
    expect(result.effectiveType).toBeNull();
  });

  it("allows MANUAL with any evidence level (even INFERRED)", () => {
    const result = gateRemediationType("MANUAL", [makeEvidence("INFERRED")]);
    expect(result.allowed).toBe(true);
    expect(result.effectiveType).toBe("MANUAL");
  });
});

// ── AEO Fix Adapter ────────────────────────────────────────────────────────

describe("aeoCheckToFinding", () => {
  const failedCheck = {
    id: "schema-faq",
    label: "FAQ schema missing",
    detail: "No FAQPage JSON-LD found",
    recommendation: "Add FAQPage structured data",
    passed: false,
  };

  it("produces a DiagnosticFinding with domain AEO", () => {
    const finding = aeoCheckToFinding(failedCheck, "example.com");
    expect(finding.domain).toBe("AEO");
  });

  it("generates a stable fingerprint", () => {
    const a = aeoCheckToFinding(failedCheck, "example.com");
    const b = aeoCheckToFinding(failedCheck, "example.com");
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("sets remediationType to AI_PATCH for failed checks", () => {
    const finding = aeoCheckToFinding(failedCheck, "example.com");
    expect(finding.remediationType).toBe("AI_PATCH");
  });

  it("sets remediationType to MANUAL for passed checks", () => {
    const finding = aeoCheckToFinding({ ...failedCheck, passed: true }, "example.com");
    expect(finding.remediationType).toBe("MANUAL");
  });

  it("marks evidence as INFERRED (AEO checks lack direct observations)", () => {
    const finding = aeoCheckToFinding(failedCheck, "example.com");
    expect(finding.evidence[0].confidenceKind).toBe("INFERRED");
  });

  it("includes verification criteria", () => {
    const finding = aeoCheckToFinding(failedCheck, "example.com");
    expect(finding.verificationCriteria.length).toBeGreaterThan(0);
  });
});

describe("constrainAeoPatch", () => {
  it("produces an AiPatchResult with risk classification", () => {
    const check = {
      id: "schema-faq",
      label: "FAQ schema missing",
      passed: false,
    };
    const result = constrainAeoPatch(
      check,
      '<script type="application/ld+json">{"@type":"FAQPage"}</script>',
      "src/app/layout.tsx",
      "example.com",
      "gemini-3.8-flash",
    );

    expect(result.filePath).toBe("src/app/layout.tsx");
    expect(result.risk).toBe("LOW"); // schema addition
    expect(result.domain).toBe("AEO");
    expect(result.verification.length).toBeGreaterThan(0);
    expect(result.aiModel).toBe("gemini-3.8-flash");
    expect(result.findingFingerprint).toHaveLength(16);
  });

  it("classifies content changes as MEDIUM risk", () => {
    const check = {
      id: "content-structure",
      label: "Heading structure needs improvement",
      passed: false,
    };
    const result = constrainAeoPatch(check, "diff...", "src/pages/about.tsx", "example.com");
    expect(result.risk).toBe("MEDIUM");
  });
});

describe("adaptAeoChecksToDiagnosticFindings", () => {
  it("filters out passed checks", () => {
    const checks = [
      { id: "check-1", label: "Check 1", passed: true },
      { id: "check-2", label: "Check 2", passed: false },
      { id: "check-3", label: "Check 3", passed: false },
    ];
    const findings = adaptAeoChecksToDiagnosticFindings(checks, "example.com");
    expect(findings).toHaveLength(2);
  });

  it("returns empty array when all checks pass", () => {
    const checks = [
      { id: "check-1", label: "Check 1", passed: true },
    ];
    const findings = adaptAeoChecksToDiagnosticFindings(checks, "example.com");
    expect(findings).toHaveLength(0);
  });

  it("all findings have domain AEO", () => {
    const checks = [
      { id: "check-1", label: "Check 1", passed: false },
      { id: "check-2", label: "Check 2", passed: false },
    ];
    const findings = adaptAeoChecksToDiagnosticFindings(checks, "example.com");
    findings.forEach(f => expect(f.domain).toBe("AEO"));
  });
});

// ── Integration: Evidence Gates + AEO Adapter ──────────────────────────────

describe("AEO adapter findings respect evidence quality gates", () => {
  it("AEO findings have INFERRED evidence → AI_PATCH is blocked by gate", () => {
    const check = { id: "test", label: "Test", passed: false };
    const finding = aeoCheckToFinding(check, "example.com");

    // The finding wants AI_PATCH
    expect(finding.remediationType).toBe("AI_PATCH");

    // But evidence is INFERRED → gate blocks AI_PATCH
    const gate = gateRemediationType(finding.remediationType, finding.evidence);
    expect(gate.allowed).toBe(false);
    expect(gate.effectiveType).toBe("EXPERIMENT");
  });
});
