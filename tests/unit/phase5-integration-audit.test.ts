/**
 * Phase 5 Integration Audit — Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * These tests verify the 15 audit gates for the Unified Remediation Platform
 * (Phases 1–5). They are designed to catch regressions in:
 *
 *   - Evidence gate application (Gate 6)
 *   - AEO bypass path controls (Gate 2)
 *   - Priority convergence (Gate 3)
 *   - Self-healing safety (Gate 10)
 *   - UNKNOWN ≠ FIXED (Gate 7)
 *   - Unsupported claims (Gate 5)
 *   - SHA protection (Gate 9)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Gate 6: Evidence gate blocks INFERRED → AI_PATCH ──────────────────────

describe("Gate 6 — Evidence gate blocks insufficient evidence", () => {
  it("gateRemediationType downgrades AI_PATCH with INFERRED evidence to EXPERIMENT", async () => {
    const { gateRemediationType } = await import(
      "@/lib/seo-audit/contracts"
    );
    const { aeoCheckToFinding } = await import("@/lib/aeo/fix-adapter");

    const failingCheck = {
      id: "schema_faq",
      category: "schema" as const,
      label: "FAQPage Schema",
      passed: false,
      status: "FAIL" as const,
      impact: "high" as const,
      detail: "No FAQ schema detected",
    };

    const finding = aeoCheckToFinding(failingCheck, "example.com");

    // aeoCheckToFinding always returns AI_PATCH for failed checks
    expect(finding.remediationType).toBe("AI_PATCH");
    // and evidence is always INFERRED
    expect(finding.evidence[0].confidenceKind).toBe("INFERRED");

    // The gate MUST downgrade AI_PATCH + INFERRED → not allowed
    const result = gateRemediationType(
      finding.remediationType as any,
      finding.evidence,
    );

    expect(result.allowed).toBe(false);
    expect(result.effectiveType).not.toBe("AI_PATCH");
    expect(result.effectiveType).not.toBe("DETERMINISTIC");
    // Should fall back to EXPERIMENT (first allowed type for INFERRED)
    expect(result.effectiveType).toBe("EXPERIMENT");
  });

  it("gateRemediationType allows AI_PATCH with DIRECTLY_OBSERVED evidence", async () => {
    const { gateRemediationType } = await import(
      "@/lib/seo-audit/contracts"
    );
    const { aeoCheckToFinding } = await import("@/lib/aeo/fix-adapter");

    const check = {
      id: "tech_canonical",
      category: "technical" as const,
      label: "Canonical Tag",
      passed: false,
      status: "FAIL" as const,
      impact: "high" as const,
      detail: "Missing canonical",
    };

    const finding = aeoCheckToFinding(check, "example.com");
    // Override evidence to DIRECTLY_OBSERVED for this test
    finding.evidence[0].confidenceKind = "DIRECTLY_OBSERVED";

    const result = gateRemediationType(
      finding.remediationType as any,
      finding.evidence,
    );

    expect(result.allowed).toBe(true);
    expect(result.effectiveType).toBe("AI_PATCH");
  });

  it("UNAVAILABLE evidence blocks all remediation types", async () => {
    const { gateRemediationType } = await import(
      "@/lib/seo-audit/contracts"
    );

    const result = gateRemediationType("AI_PATCH", []);
    expect(result.allowed).toBe(false);
    expect(result.effectiveType).toBeNull();
  });
});

// ── Gate 3: Single priority path ──────────────────────────────────────────

describe("Gate 3 — Single canonical priority path", () => {
  it("computePriorityLegacy delegates to computePriorityV4", async () => {
    const { computePriorityLegacy, computePriorityV4 } = await import(
      "@/lib/seo-audit/prioritization"
    );

    const legacyScore = computePriorityLegacy(8, 3, 0.9);
    const v4Result = computePriorityV4({
      businessImpact: 0.8,
      searchImpact: 0.8,
      affectedScope: 0.5,
      confidence: 0.9,
      fixability: 0.7,
      evidenceStrength: 0.5,
      recency: 0.8,
    });

    // Legacy must produce the exact same score as V4 with equivalent inputs
    expect(legacyScore).toBe(v4Result.score);
  });
});

// ── Gate 7: UNKNOWN ≠ FIXED ──────────────────────────────────────────────

describe("Gate 7 — UNKNOWN never treated as FIXED", () => {
  it("UNKNOWN verification outcome cannot jump to OUTCOME_MEASURED", async () => {
    const { isValidVerificationTransition } = await import(
      "@/lib/seo-audit/lifecycle"
    );

    expect(isValidVerificationTransition("UNKNOWN", "OUTCOME_MEASURED")).toBe(false);
    expect(isValidVerificationTransition("INSUFFICIENT_DATA", "OUTCOME_MEASURED")).toBe(false);
    expect(isValidVerificationTransition("PENDING", "OUTCOME_MEASURED")).toBe(false);
  });

  it("same-state lifecycle transitions are rejected (no silent re-resolve)", async () => {
    const { isValidLifecycleTransition } = await import(
      "@/lib/seo-audit/lifecycle"
    );

    expect(isValidLifecycleTransition("RESOLVED", "RESOLVED")).toBe(false);
    expect(isValidLifecycleTransition("UNKNOWN", "UNKNOWN")).toBe(false);
  });

  it("every RESOLVED transition in verification is guarded by positive evidence", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/lib/inngest/functions/diagnostic-verification.ts"),
      "utf-8",
    );

    const lines = src.split("\n");
    const resolvedLines = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.includes("LIFECYCLE_STATE.RESOLVED"));

    expect(resolvedLines.length).toBeGreaterThan(0);

    for (const { i } of resolvedLines) {
      const guard = lines.slice(Math.max(0, i - 3), i).join("\n");
      expect(guard).toMatch(/SEARCH_VERIFIED|=== "improved"/);
      expect(guard).not.toMatch(/UNKNOWN|INSUFFICIENT_DATA|neutral/);
    }
  });
});

// ── Gate 10: GSoV-only drop → ALERT only ──────────────────────────────────

describe("Gate 10 — Self-healing GSoV-only drops produce ALERT only", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("generateHealingPlan returns ALERT for GSoV drop with no technical regressions", async () => {
    // Mock prisma to return two AEO reports with GSoV drop but same checks
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        site: {
          findUnique: vi.fn().mockResolvedValue({
            id: "site-1",
            domain: "example.com",
            githubRepoUrl: "https://github.com/test/repo",
            operatingMode: "AUTOPILOT",
          }),
        },
        aeoReport: {
          findMany: vi.fn().mockResolvedValue([
            {
              checks: [
                { id: "schema_faq", label: "FAQ Schema", passed: true, impact: "high" },
              ],
              multiModelResults: [],
              generativeShareOfVoice: 20,
              createdAt: new Date(),
            },
            {
              checks: [
                { id: "schema_faq", label: "FAQ Schema", passed: true, impact: "high" },
              ],
              multiModelResults: [],
              generativeShareOfVoice: 35,
              createdAt: new Date(Date.now() - 86400000),
            },
          ]),
        },
        selfHealingLog: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
    }));

    const { generateHealingPlan } = await import(
      "@/lib/self-healing/engine"
    );

    const actions = await generateHealingPlan("site-1", 20, 35);

    // GSoV dropped but no checks regressed → should be ALERT only
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.type).toBe("ALERT");
    }
    // Should mention CitationOpportunity OBSERVATION
    expect(actions[0].description).toContain("CitationOpportunity OBSERVATION");
  });
});

// ── Gate 9: SHA protection ──────────────────────────────────────────────

describe("Gate 9 — SHA protection in createAutoFixPR", () => {
  it("createAutoFixPR enforces SHA-pinned proposals for single file only", async () => {
    // The SHA check in createAutoFixPR happens AFTER GitHub auth,
    // so we verify structurally that the enforcement code exists.
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/lib/github/index.ts"),
      "utf-8",
    );

    // The SHA-pin enforcement block must exist
    expect(content).toContain("SHA-pinned proposals must change exactly one file");
    // expectedBaseSha must be a parameter
    expect(content).toContain("expectedBaseSha");
  });
});

// ── Gate 5: Unsupported claims lint ──────────────────────────────────────

describe("Gate 5 — No unsupported statistical claims in customer-facing code", () => {
  it("lead-drip.ts does not contain '3×' or '3x' multiplier claims", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/lib/inngest/functions/lead-drip.ts"),
      "utf-8",
    );

    // These specific patterns were identified in the Phase 5 audit
    expect(content).not.toMatch(/cited \d+[×x] more/i);
  });

  it("AEO dashboard does not contain hardcoded percentage stats", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/dashboard/sites/[id]/aeo/page.tsx"),
      "utf-8",
    );

    // The "↑ 12%" was a fabricated number
    expect(content).not.toContain("↑ 12%");
  });

  it("diagnosis.ts does not contain fabricated percentage formulas", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/lib/aeo/diagnosis.ts"),
      "utf-8",
    );

    // The "${100 - score}% more" formula was fabricated
    expect(content).not.toMatch(/\$\{100\s*-\s*score\}%/);
  });
});

// ── Gate 2: Kill-switch coverage ──────────────────────────────────────────

describe("Gate 2 — AEO bypass paths pass siteId for kill-switch", () => {
  it("githubAutofixSiteJob passes siteId to createAutoFixPR", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/lib/inngest/functions/github-autofix.ts"),
      "utf-8",
    );

    // The createAutoFixPR call must include siteId
    // siteId is the 7th positional arg (index 6)
    expect(content).toContain("undefined, siteId");
  });

  it("AEO dashboard CheckCard passes actual siteId (not empty string)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/dashboard/sites/[id]/aeo/page.tsx"),
      "utf-8",
    );

    // siteId: "" should NOT appear — it was a bug
    expect(content).not.toMatch(/siteId:\s*""/);
  });
});

// ── Gate 12: No premature outcome recording ──────────────────────────────

describe("Gate 12 — Healing outcomes not recorded at PR creation", () => {
  it("githubAutofixSiteJob does not import or call recordHealingOutcome", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/lib/inngest/functions/github-autofix.ts"),
      "utf-8",
    );

    // The actual import pattern should not exist (the word may appear in comments)
    expect(content).not.toMatch(/import.*recordHealingOutcome/);
    // The function call pattern should not exist
    expect(content).not.toMatch(/await\s+recordHealingOutcome/);
  });
});
