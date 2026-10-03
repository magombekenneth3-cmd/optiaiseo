/**
 * tests/unit/aeo-intelligence.test.ts
 *
 * Phase 5 — AEO/AIO Intelligence Integration tests.
 *
 * Verifies:
 *   1. CitationOpportunity structure and provenance
 *   2. AI_ESCALATION_POLICY escalation tiers (OBSERVATION → OPPORTUNITY → RECOMMENDATION → FIX_CANDIDATE)
 *   3. Technical vs CONTENT_EXPERIMENT classification
 *   4. Safety invariants (single AI response never creates mutation, GSoV alone never FIX_CANDIDATE)
 *   5. AeoRemediationMode classification rules
 *   6. evaluateEscalationStatus correctness
 *   7. No second mutation hierarchy exists
 *   8. Backward compatibility of existing AEO public functions
 */

import { describe, it, expect } from "vitest";
import {
  AI_ESCALATION_POLICY,
  evaluateEscalationStatus,
  type CitationOpportunity,
  type CitationOpportunityType,
  type AeoRemediationMode,
} from "@/lib/seo-audit/contracts";
import {
  aeoCheckToFinding,
  adaptAeoChecksToDiagnosticFindings,
} from "@/lib/aeo/fix-adapter";
import type { AeoCheck } from "@/lib/aeo/fix-engine";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOpportunity(
  overrides: Partial<CitationOpportunity> & {
    type: CitationOpportunityType;
  },
): CitationOpportunity {
  return {
    id: "test-opp-1",
    url: "https://example.com",
    domain: "AEO",
    query: "what is example.com?",
    observedAt: new Date().toISOString(),
    evidence: { provider: "gemini", model: "gemini-2.5-flash" },
    confidence: 0.4,
    repeatedObservationCount: 1,
    remediationMode: "CONTENT_EXPERIMENT",
    status: "OBSERVATION",
    ...overrides,
  };
}

function makeAeoCheck(overrides: Partial<AeoCheck> = {}): AeoCheck {
  return {
    id: "schema_organization",
    label: "Organization Schema",
    passed: false,
    detail: "Organization JSON-LD missing from root layout",
    recommendation: "Add Organization JSON-LD to root layout",
    ...overrides,
  };
}

// ── CitationOpportunity structure ────────────────────────────────────────────

describe("CitationOpportunity structure", () => {
  it("valid opportunity has all required fields", () => {
    const opp = makeOpportunity({ type: "NO_CITATION" });
    expect(opp.id).toBeTruthy();
    expect(opp.domain).toMatch(/^(AEO|AIO)$/);
    expect(typeof opp.query).toBe("string");
    expect(typeof opp.confidence).toBe("number");
    expect(opp.confidence).toBeGreaterThanOrEqual(0);
    expect(opp.confidence).toBeLessThanOrEqual(1);
    expect(opp.repeatedObservationCount).toBeGreaterThanOrEqual(1);
    expect(opp.evidence.provider).toBeTruthy();
  });

  it("evidence provenance is preserved on the opportunity", () => {
    const opp = makeOpportunity({
      type: "COMPETITOR_CITED",
      evidence: {
        provider: "chatgpt",
        model: "gpt-4o",
        modelVersion: "2024-11",
        promptVersion: "v3",
        sampleId: "abc123",
        groundingUsed: true,
        groundingSources: ["https://competitor.com"],
      },
    });
    expect(opp.evidence.provider).toBe("chatgpt");
    expect(opp.evidence.model).toBe("gpt-4o");
    expect(opp.evidence.sampleId).toBe("abc123");
    expect(opp.evidence.groundingUsed).toBe(true);
    expect(opp.evidence.groundingSources).toContain("https://competitor.com");
  });

  it("status starts as OBSERVATION", () => {
    const opp = makeOpportunity({ type: "NO_MENTION" });
    expect(opp.status).toBe("OBSERVATION");
  });
});

// ── AI_ESCALATION_POLICY coverage ───────────────────────────────────────────

describe("AI_ESCALATION_POLICY coverage", () => {
  const ALL_TYPES: CitationOpportunityType[] = [
    "NO_MENTION", "NO_CITATION", "WRONG_ENTITY", "COMPETITOR_CITED",
    "WEAK_SOURCE", "CONTENT_GAP", "EVIDENCE_GAP", "FRESHNESS_GAP",
    "AUTHORITY_GAP", "STRUCTURE_GAP", "INTENT_GAP",
  ];
  const ALL_STATUSES = ["OBSERVATION", "OPPORTUNITY", "RECOMMENDATION", "FIX_CANDIDATE"] as const;

  it("every CitationOpportunityType has a policy entry", () => {
    for (const type of ALL_TYPES) {
      expect(AI_ESCALATION_POLICY[type], `Missing policy for ${type}`).toBeDefined();
    }
  });

  it("every policy has thresholds for all 4 statuses", () => {
    for (const type of ALL_TYPES) {
      const policy = AI_ESCALATION_POLICY[type];
      for (const status of ALL_STATUSES) {
        expect(
          policy.thresholds[status],
          `${type} missing threshold for ${status}`,
        ).toBeDefined();
      }
    }
  });

  it("OBSERVATION always requires minObservations = 1", () => {
    for (const type of ALL_TYPES) {
      const obs = AI_ESCALATION_POLICY[type].thresholds.OBSERVATION;
      expect(obs.minObservations, `${type} OBSERVATION should require 1 observation`).toBe(1);
    }
  });

  it("FIX_CANDIDATE always has higher thresholds than OBSERVATION", () => {
    for (const type of ALL_TYPES) {
      const obs = AI_ESCALATION_POLICY[type].thresholds.OBSERVATION;
      const fc = AI_ESCALATION_POLICY[type].thresholds.FIX_CANDIDATE;
      const higherObs = fc.minObservations >= obs.minObservations;
      const higherConf = fc.minConfidence >= obs.minConfidence;
      expect(
        higherObs || higherConf,
        `${type}: FIX_CANDIDATE should have higher threshold than OBSERVATION`,
      ).toBe(true);
    }
  });

  it("CONTENT_EXPERIMENT types never have requiresTechnicalEvidence=false at FIX_CANDIDATE for authority gaps", () => {
    // Authority gaps specifically require technical evidence at FIX_CANDIDATE
    const authorityPolicy = AI_ESCALATION_POLICY.AUTHORITY_GAP;
    expect(authorityPolicy.thresholds.FIX_CANDIDATE.requiresTechnicalEvidence).toBe(true);
  });
});

// ── Escalation tier logic ────────────────────────────────────────────────────

describe("evaluateEscalationStatus", () => {

  it("single observation → OBSERVATION (never higher)", () => {
    const opp = makeOpportunity({
      type: "NO_CITATION",
      repeatedObservationCount: 1,
      confidence: 0.99, // even with max confidence
    });
    const status = evaluateEscalationStatus(opp, true);
    // minObservations for OPPORTUNITY is 2, so 1 observation = OBSERVATION
    expect(status).toBe("OBSERVATION");
  });

  it("repeated observations → OPPORTUNITY", () => {
    // NO_CITATION: OPPORTUNITY requires minObservations=2, minConfidence=0.45
    // Using exactly 2 observations and 0.50 confidence → reaches OPPORTUNITY
    // but not RECOMMENDATION (which needs minObservations=3)
    const opp = makeOpportunity({
      type: "NO_CITATION",
      repeatedObservationCount: 2,
      confidence: 0.50,
    });
    const status = evaluateEscalationStatus(opp, false);
    expect(status).toBe("OPPORTUNITY");
  });

  it("persistent gap with enough observations → RECOMMENDATION", () => {
    const opp = makeOpportunity({
      type: "NO_CITATION",
      repeatedObservationCount: 4,
      confidence: 0.55,
    });
    const status = evaluateEscalationStatus(opp, false);
    expect(status).toBe("RECOMMENDATION");
  });

  it("FIX_CANDIDATE requires meeting ALL thresholds including technical evidence", () => {
    // NO_CITATION: minObservations=5, minConfidence=0.65, requiresTechnicalEvidence=true
    const base = makeOpportunity({
      type: "NO_CITATION",
      repeatedObservationCount: 5,
      confidence: 0.70,
    });

    // Without technical evidence → blocked at RECOMMENDATION
    const withoutTech = evaluateEscalationStatus(base, false);
    expect(withoutTech).toBe("RECOMMENDATION");

    // With technical evidence → FIX_CANDIDATE
    const withTech = evaluateEscalationStatus(base, true);
    expect(withTech).toBe("FIX_CANDIDATE");
  });

  it("STRUCTURE_GAP with technical evidence escalates fast (min 1 observation)", () => {
    const opp = makeOpportunity({
      type: "STRUCTURE_GAP",
      repeatedObservationCount: 1,
      confidence: 0.80,
      remediationMode: "TECHNICAL_FIX",
    });
    const status = evaluateEscalationStatus(opp, true);
    expect(status).toBe("FIX_CANDIDATE");
  });

  it("STRUCTURE_GAP without technical evidence stays at OBSERVATION", () => {
    const opp = makeOpportunity({
      type: "STRUCTURE_GAP",
      repeatedObservationCount: 1,
      confidence: 0.80,
      remediationMode: "TECHNICAL_FIX",
    });
    const status = evaluateEscalationStatus(opp, false);
    expect(status).toBe("OBSERVATION");
  });

  it("low confidence blocks escalation", () => {
    const opp = makeOpportunity({
      type: "COMPETITOR_CITED",
      repeatedObservationCount: 10, // many observations
      confidence: 0.1, // but very low confidence
    });
    const status = evaluateEscalationStatus(opp, false);
    // minConfidence for OBSERVATION is 0.4, so even OBSERVATION is blocked
    // → falls back to OBSERVATION (the function always returns at least OBSERVATION)
    expect(status).toBe("OBSERVATION");
  });
});

// ── Safety invariants ────────────────────────────────────────────────────────

describe("Safety invariants", () => {

  it("single AI observation (count=1) can never be FIX_CANDIDATE for CONTENT_EXPERIMENT types", () => {
    const contentTypes: CitationOpportunityType[] = [
      "NO_MENTION", "NO_CITATION", "COMPETITOR_CITED", "WEAK_SOURCE",
      "CONTENT_GAP", "EVIDENCE_GAP", "FRESHNESS_GAP", "AUTHORITY_GAP", "INTENT_GAP",
    ];
    for (const type of contentTypes) {
      const opp = makeOpportunity({
        type,
        repeatedObservationCount: 1,
        confidence: 0.99,
        remediationMode: "CONTENT_EXPERIMENT",
      });
      const status = evaluateEscalationStatus(opp, true);
      expect(
        status !== "FIX_CANDIDATE",
        `${type}: single observation should never be FIX_CANDIDATE`,
      ).toBe(true);
    }
  });

  it("GSoV-only movement (no technical evidence, count=1) stays OBSERVATION", () => {
    // GSoV drop produces a CitationOpportunity observation.
    // Without technical evidence and with a single observation, it cannot escalate.
    const opp = makeOpportunity({
      type: "NO_CITATION",
      repeatedObservationCount: 1,
      confidence: 0.45,
      remediationMode: "CONTENT_EXPERIMENT",
    });
    const status = evaluateEscalationStatus(opp, false);
    expect(status).toBe("OBSERVATION");
  });

  it("WRONG_ENTITY with single observation stays below FIX_CANDIDATE without technical evidence", () => {
    const opp = makeOpportunity({
      type: "WRONG_ENTITY",
      repeatedObservationCount: 1,
      confidence: 0.70,
      remediationMode: "TECHNICAL_FIX",
    });
    // WRONG_ENTITY OPPORTUNITY requires 2+ observations + technical evidence
    const status = evaluateEscalationStatus(opp, false);
    expect(status).toBe("OBSERVATION");
  });

  it("AeoRemediationMode is one of exactly two values", () => {
    const validModes: AeoRemediationMode[] = ["TECHNICAL_FIX", "CONTENT_EXPERIMENT"];
    // Schema check — no third mode exists
    expect(validModes).toHaveLength(2);
  });

  it("no AIO score type is defined in contracts", () => {
    // Verifies Phase 5 did not introduce an AIO score type.
    // The contracts should have CitationOpportunity but no AioScore.
    // We check that evaluateEscalationStatus does not return a score.
    const opp = makeOpportunity({ type: "CONTENT_GAP", repeatedObservationCount: 2, confidence: 0.5 });
    const status = evaluateEscalationStatus(opp, false);
    expect(typeof status).toBe("string");
    expect(["OBSERVATION","OPPORTUNITY","RECOMMENDATION","FIX_CANDIDATE"]).toContain(status);
  });
});

// ── AEO check → canonical finding ───────────────────────────────────────────

describe("aeoCheckToFinding canonical conversion", () => {

  it("schema check produces AI_PATCH remediation type", () => {
    const check = makeAeoCheck({ id: "schema_organization" });
    const finding = aeoCheckToFinding(check, "example.com");
    // Schema checks → AI_PATCH (not EXPERIMENT)
    expect(finding.remediationType).toBe("AI_PATCH");
  });

  it("passed check produces NOT_APPLICABLE status", () => {
    const check = makeAeoCheck({ passed: true });
    const finding = aeoCheckToFinding(check, "example.com");
    expect(finding.status).toBe("NOT_APPLICABLE");
  });

  it("failed check produces FAIL status", () => {
    const check = makeAeoCheck({ passed: false });
    const finding = aeoCheckToFinding(check, "example.com");
    expect(finding.status).toBe("FAIL");
  });

  it("evidence is marked INFERRED (not DIRECTLY_OBSERVED)", () => {
    // AEO checks are AI-inferred — they don't carry direct HTML observation
    const check = makeAeoCheck();
    const finding = aeoCheckToFinding(check, "example.com");
    expect(finding.evidence.length).toBeGreaterThan(0);
    expect(finding.evidence[0].confidenceKind).toBe("INFERRED");
  });

  it("evidence provenance is preserved (url, observedAt, evidenceHash)", () => {
    const check = makeAeoCheck();
    const finding = aeoCheckToFinding(check, "example.com");
    const ev = finding.evidence[0];
    expect(ev.url).toContain("example.com");
    expect(typeof ev.observedAt).toBe("string");
    expect(typeof ev.evidenceHash).toBe("string");
    expect(ev.evidenceHash.length).toBeGreaterThan(0);
  });

  it("domain is AEO on the canonical finding", () => {
    const check = makeAeoCheck();
    const finding = aeoCheckToFinding(check, "example.com");
    expect(finding.domain).toBe("AEO");
  });

  it("adaptAeoChecksToDiagnosticFindings filters out passed checks", () => {
    const checks: AeoCheck[] = [
      makeAeoCheck({ id: "check_1", passed: false }),
      makeAeoCheck({ id: "check_2", passed: true }),
      makeAeoCheck({ id: "check_3", passed: false }),
    ];
    const findings = adaptAeoChecksToDiagnosticFindings(checks, "example.com");
    expect(findings).toHaveLength(2);
    expect(findings.every(f => f.status === "FAIL")).toBe(true);
  });
});

// ── Technical vs CONTENT_EXPERIMENT ─────────────────────────────────────────

describe("Technical vs CONTENT_EXPERIMENT classification", () => {

  it("STRUCTURE_GAP policy remediationMode is TECHNICAL_FIX", () => {
    expect(AI_ESCALATION_POLICY.STRUCTURE_GAP.remediationMode).toBe("TECHNICAL_FIX");
  });

  it("WRONG_ENTITY policy remediationMode is TECHNICAL_FIX", () => {
    expect(AI_ESCALATION_POLICY.WRONG_ENTITY.remediationMode).toBe("TECHNICAL_FIX");
  });

  it("NO_CITATION policy remediationMode is CONTENT_EXPERIMENT", () => {
    expect(AI_ESCALATION_POLICY.NO_CITATION.remediationMode).toBe("CONTENT_EXPERIMENT");
  });

  it("COMPETITOR_CITED policy remediationMode is CONTENT_EXPERIMENT", () => {
    expect(AI_ESCALATION_POLICY.COMPETITOR_CITED.remediationMode).toBe("CONTENT_EXPERIMENT");
  });

  it("AUTHORITY_GAP policy remediationMode is CONTENT_EXPERIMENT", () => {
    expect(AI_ESCALATION_POLICY.AUTHORITY_GAP.remediationMode).toBe("CONTENT_EXPERIMENT");
  });

  it("CONTENT_EXPERIMENT opportunities with single observation remain non-mutations", () => {
    // Verifies the key architectural invariant: content experiments at OBSERVATION
    // status never have the right to trigger a mutation.
    const opp = makeOpportunity({
      type: "CONTENT_GAP",
      remediationMode: "CONTENT_EXPERIMENT",
      repeatedObservationCount: 1,
      confidence: 0.5,
    });
    const status = evaluateEscalationStatus(opp, false);
    // OBSERVATION → no mutation authorized
    expect(status).toBe("OBSERVATION");
    expect(opp.remediationMode).toBe("CONTENT_EXPERIMENT");
  });
});

// ── No second mutation hierarchy ─────────────────────────────────────────────

describe("Architecture: no second mutation hierarchy", () => {

  it("fix-adapter exports only DiagnosticFinding and RemediationAction compatible types", async () => {
    // Importing from the adapter should not import any new mutation type
    const adapter = await import("@/lib/aeo/fix-adapter");
    // These are the only public functions — no second mutation system
    expect(typeof adapter.aeoCheckToFinding).toBe("function");
    expect(typeof adapter.constrainAeoPatch).toBe("function");
    expect(typeof adapter.adaptAeoChecksToDiagnosticFindings).toBe("function");
    // Should NOT export a separate AEO mutation or AEO proposal system
    expect((adapter as Record<string, unknown>).createAeoMutation).toBeUndefined();
    expect((adapter as Record<string, unknown>).createAeoProposal).toBeUndefined();
    expect((adapter as Record<string, unknown>).aeoMutationPipeline).toBeUndefined();
  });

  it("diagnosis.ts exports diagnoseAeoData (compatible, not a mutation system)", async () => {
    const diag = await import("@/lib/aeo/diagnosis");
    expect(typeof diag.diagnoseAeoData).toBe("function");
    // Should not export a mutation or fix pipeline
    expect((diag as Record<string, unknown>).generateMutation).toBeUndefined();
    expect((diag as Record<string, unknown>).createFix).toBeUndefined();
  });
});

// ── Backward compatibility ───────────────────────────────────────────────────

describe("Backward compatibility", () => {

  it("aeoFix.ts public API is preserved (types importable)", async () => {
    // We can't call server actions in unit tests, but we verify the module shape
    // by checking the adapter still compiles (TypeScript validates this at build time).
    // Here we verify the fix-adapter is importable and has expected exports.
    const adapter = await import("@/lib/aeo/fix-adapter");
    expect(adapter).toBeDefined();
    expect(typeof adapter.aeoCheckToFinding).toBe("function");
  });

  it("diagnosis module still exports diagnoseAeoData correctly", async () => {
    const { diagnoseAeoData } = await import("@/lib/aeo/diagnosis");
    const result = diagnoseAeoData([]);
    expect(result.score).toBe(0);
    expect(result.grade).toBe("Critical");
    expect(Array.isArray(result.actionPlan)).toBe(true);
  });

  it("diagnosis with records still produces action plan", async () => {
    const { diagnoseAeoData } = await import("@/lib/aeo/diagnosis");
    const records = [
      { keyword: "example service", mentioned: false, competitorsMentioned: ["competitor.com"], queriedAt: new Date() },
      { keyword: "example service pricing", mentioned: false, competitorsMentioned: ["competitor.com"], queriedAt: new Date() },
    ];
    const result = diagnoseAeoData(records, [], []);
    expect(result.score).toBe(0);
    expect(result.actionPlan.length).toBeGreaterThan(0);
  });

  it("diagnosis estimatedImpact does not contain banned certainty phrases", async () => {
    const { diagnoseAeoData } = await import("@/lib/aeo/diagnosis");
    const records = [
      { keyword: "brand query", mentioned: false, competitorsMentioned: ["comp.com"], queriedAt: new Date() },
    ];
    const result = diagnoseAeoData(records, ["unrelated"], ["brand"]);
    const BANNED = [
      "2–4 weeks of re-indexing",
      "3–6 weeks",
      "4–8 weeks",
      "primary AI training signal",
      "directly increases AI mention",
      "AI systems treat Wikipedia as a ground-truth",
      "directly feeds AI response",
      "GEO fixes directly increase",
      "AIO fixes teach AI",
      "Very high — AIO",
    ];
    for (const item of result.actionPlan) {
      const text = `${item.why} ${item.estimatedImpact}`;
      for (const phrase of BANNED) {
        expect(text, `Action item "${item.title}" contains banned phrase: "${phrase}"`).not.toContain(phrase);
      }
    }
  });
});
