/**
 * D.5.2 — Variant Generation Tests
 *
 * Tests variant generation, assignment hash determinism, and validation.
 */

import { describe, it, expect } from "vitest";
import {
  generateVariants,
  computeAssignmentHash,
  validateVariants,
} from "@/lib/experiments/variant-generator";
import type { ActionPlan } from "@/lib/planning/types";

// ── Test Fixtures ───────────────────────────────────────────────────────────

const mockPlan: ActionPlan = {
  opportunityId: "opp-123",
  siteId: "site-456",
  actionType: "UPDATE_META_DESCRIPTION",
  resourceType: "PAGE",
  resourceId: "blog-789",
  targetUrl: "https://example.com/page-1",
  rationale: [{ rule: "low_ctr", details: "CTR below 2%" }],
  evidenceIds: ["ev-1"],
  expectedOutcome: "CTR improvement of ~2pp",
  constraints: { safetyTier: 1 },
  parameters: { metaDescription: "New meta description" },
  planningVersion: "d3-v1",
  evidenceHash: "abc123",
};

// ── Variant Generation ──────────────────────────────────────────────────────

describe("generateVariants", () => {
  it("produces exactly 1 control + 1 treatment", () => {
    const variants = generateVariants("exp-1", mockPlan, "test keyword");
    expect(variants).toHaveLength(2);

    const control = variants.find(v => v.isControl);
    const treatment = variants.find(v => !v.isControl);

    expect(control).toBeDefined();
    expect(treatment).toBeDefined();
  });

  it("control has no action type or parameters", () => {
    const variants = generateVariants("exp-1", mockPlan, "test keyword");
    const control = variants.find(v => v.isControl)!;

    expect(control.actionType).toBeNull();
    expect(control.actionParameters).toBeNull();
    expect(control.variantKey).toBe("control");
  });

  it("treatment inherits action type and parameters from plan", () => {
    const variants = generateVariants("exp-1", mockPlan, "test keyword");
    const treatment = variants.find(v => !v.isControl)!;

    expect(treatment.actionType).toBe("UPDATE_META_DESCRIPTION");
    expect(treatment.actionParameters).toEqual({ metaDescription: "New meta description" });
    expect(treatment.variantKey).toBe("treatment_a");
  });

  it("all variants target the same URL", () => {
    const variants = generateVariants("exp-1", mockPlan, "test keyword");
    const urls = new Set(variants.map(v => v.targetUrl));
    expect(urls.size).toBe(1);
    expect(urls.has("https://example.com/page-1")).toBe(true);
  });

  it("all variants carry the keyword", () => {
    const variants = generateVariants("exp-1", mockPlan, "seo tool");
    for (const v of variants) {
      expect(v.targetKeyword).toBe("seo tool");
    }
  });
});

// ── Assignment Hash ─────────────────────────────────────────────────────────

describe("computeAssignmentHash", () => {
  it("is deterministic", () => {
    const h1 = computeAssignmentHash("exp-1", "treatment_a", "https://example.com/page-1");
    const h2 = computeAssignmentHash("exp-1", "treatment_a", "https://example.com/page-1");
    expect(h1).toBe(h2);
  });

  it("produces 64-char hex SHA-256", () => {
    const hash = computeAssignmentHash("exp-1", "control", "https://example.com/page-1");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("different experimentIds produce different hashes", () => {
    const h1 = computeAssignmentHash("exp-1", "control", "https://example.com/page-1");
    const h2 = computeAssignmentHash("exp-2", "control", "https://example.com/page-1");
    expect(h1).not.toBe(h2);
  });

  it("different variantKeys produce different hashes", () => {
    const h1 = computeAssignmentHash("exp-1", "control", "https://example.com/page-1");
    const h2 = computeAssignmentHash("exp-1", "treatment_a", "https://example.com/page-1");
    expect(h1).not.toBe(h2);
  });

  it("different URLs produce different hashes", () => {
    const h1 = computeAssignmentHash("exp-1", "control", "https://example.com/page-1");
    const h2 = computeAssignmentHash("exp-1", "control", "https://example.com/page-2");
    expect(h1).not.toBe(h2);
  });
});

// ── Variant Validation ──────────────────────────────────────────────────────

describe("validateVariants", () => {
  it("valid: 1 control + 1 treatment, same URL", () => {
    const variants = generateVariants("exp-1", mockPlan, "keyword");
    const result = validateVariants(variants);
    expect(result.valid).toBe(true);
  });

  it("invalid: fewer than 2 variants", () => {
    const result = validateVariants([{
      variantKey: "control",
      isControl: true,
      targetUrl: "https://example.com",
      targetKeyword: null,
      actionType: null,
      actionParameters: null,
    }]);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("at least 2");
  });

  it("invalid: no control variant", () => {
    const result = validateVariants([
      { variantKey: "treatment_a", isControl: false, targetUrl: "https://example.com", targetKeyword: null, actionType: "UPDATE_META_DESCRIPTION", actionParameters: {} },
      { variantKey: "treatment_b", isControl: false, targetUrl: "https://example.com", targetKeyword: null, actionType: "UPDATE_TITLE_TAG", actionParameters: {} },
    ]);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("control");
  });

  it("invalid: control with action type", () => {
    const result = validateVariants([
      { variantKey: "control", isControl: true, targetUrl: "https://example.com", targetKeyword: null, actionType: "UPDATE_META_DESCRIPTION", actionParameters: {} },
      { variantKey: "treatment_a", isControl: false, targetUrl: "https://example.com", targetKeyword: null, actionType: "UPDATE_TITLE_TAG", actionParameters: {} },
    ]);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("actionType = null");
  });

  it("invalid: treatment without action type", () => {
    const result = validateVariants([
      { variantKey: "control", isControl: true, targetUrl: "https://example.com", targetKeyword: null, actionType: null, actionParameters: null },
      { variantKey: "treatment_a", isControl: false, targetUrl: "https://example.com", targetKeyword: null, actionType: null, actionParameters: null },
    ]);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("must have an actionType");
  });

  it("invalid: different URLs across variants", () => {
    const result = validateVariants([
      { variantKey: "control", isControl: true, targetUrl: "https://example.com/a", targetKeyword: null, actionType: null, actionParameters: null },
      { variantKey: "treatment_a", isControl: false, targetUrl: "https://example.com/b", targetKeyword: null, actionType: "UPDATE_META_DESCRIPTION", actionParameters: {} },
    ]);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("same URL");
  });

  it("invalid: duplicate variant keys", () => {
    const result = validateVariants([
      { variantKey: "control", isControl: true, targetUrl: "https://example.com", targetKeyword: null, actionType: null, actionParameters: null },
      { variantKey: "control", isControl: false, targetUrl: "https://example.com", targetKeyword: null, actionType: "UPDATE_META_DESCRIPTION", actionParameters: {} },
    ]);
    expect(result.valid).toBe(false);
  });
});
