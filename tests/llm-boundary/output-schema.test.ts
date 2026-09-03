/**
 * Phase D.4 — Output Schema Tests
 *
 * Tests 1-4: Zod schema structural enforcement
 */

import { describe, it, expect } from "vitest";
import { parseLLMOutput, getLLMParseErrors, llmOutputSchema } from "@/lib/llm-boundary/output-schema";

// ── §1 — Valid output passes ────────────────────────────────────────────────

describe("§1 — Valid LLM output passes Zod schema", () => {
  it("accepts well-formed output", () => {
    const valid = {
      proposedChanges: [
        {
          field: "title",
          proposedValue: "Best SEO Tools for 2026",
          reasoning: "Includes target keyword",
        },
      ],
      reasoning: "Title optimization for better CTR",
      confidence: 0.85,
    };
    expect(parseLLMOutput(valid)).not.toBeNull();
  });

  it("accepts multiple proposed changes", () => {
    const valid = {
      proposedChanges: [
        { field: "title", proposedValue: "New Title", reasoning: "Better" },
        { field: "metaDescription", proposedValue: "New desc", reasoning: "Better" },
      ],
      reasoning: "Multiple improvements",
      confidence: 0.75,
    };
    expect(parseLLMOutput(valid)).not.toBeNull();
  });
});

// ── §2 — Output with actionType rejected ────────────────────────────────────

describe("§2 — Output with actionType field rejected", () => {
  it("actionType is NOT a valid field in proposedChanges", () => {
    const withActionType = {
      proposedChanges: [
        {
          field: "actionType",
          proposedValue: "DELETE_PAGE",
          reasoning: "Should delete",
        },
      ],
      reasoning: "Changed action",
      confidence: 0.9,
    };
    expect(parseLLMOutput(withActionType)).toBeNull();
  });

  it("extra top-level actionType is stripped by Zod strict parsing", () => {
    const withExtra = {
      actionType: "DELETE_PAGE",
      proposedChanges: [
        { field: "title", proposedValue: "New", reasoning: "Better" },
      ],
      reasoning: "Fine",
      confidence: 0.8,
    };
    // Zod non-strict allows extra keys, but they are stripped from output
    const result = parseLLMOutput(withExtra);
    if (result) {
      expect("actionType" in result).toBe(false);
    }
  });
});

// ── §3 — Output with safetyTier rejected ────────────────────────────────────

describe("§3 — Output with safetyTier field rejected", () => {
  it("safetyTier is NOT a valid field in proposedChanges", () => {
    const withSafety = {
      proposedChanges: [
        {
          field: "safetyTier",
          proposedValue: "1",
          reasoning: "Lower tier",
        },
      ],
      reasoning: "Changed safety",
      confidence: 0.9,
    };
    expect(parseLLMOutput(withSafety)).toBeNull();
  });

  it("extra top-level safetyTier is stripped from parsed output", () => {
    const withExtra = {
      safetyTier: 1,
      proposedChanges: [
        { field: "title", proposedValue: "New", reasoning: "Better" },
      ],
      reasoning: "Fine",
      confidence: 0.8,
    };
    const result = parseLLMOutput(withExtra);
    if (result) {
      expect("safetyTier" in result).toBe(false);
    }
  });
});

// ── §4 — Output with status/approvalHash rejected ───────────────────────────

describe("§4 — Output with status/approvalHash field rejected", () => {
  it("status is NOT a valid field", () => {
    const withStatus = {
      proposedChanges: [
        { field: "status", proposedValue: "APPROVED", reasoning: "Auto" },
      ],
      reasoning: "Self-approve",
      confidence: 0.99,
    };
    expect(parseLLMOutput(withStatus)).toBeNull();
  });

  it("approvalHash is NOT a valid field", () => {
    const withHash = {
      proposedChanges: [
        { field: "approvalHash", proposedValue: "abc", reasoning: "Bypass" },
      ],
      reasoning: "Skip approval",
      confidence: 0.99,
    };
    expect(parseLLMOutput(withHash)).toBeNull();
  });

  it("opportunityStatus is NOT a valid field", () => {
    const withStatus = {
      proposedChanges: [
        { field: "opportunityStatus", proposedValue: "APPROVED", reasoning: "Promote" },
      ],
      reasoning: "Self-promote",
      confidence: 0.99,
    };
    expect(parseLLMOutput(withStatus)).toBeNull();
  });

  it("empty proposedChanges array rejected", () => {
    const empty = {
      proposedChanges: [],
      reasoning: "Nothing",
      confidence: 0.5,
    };
    expect(parseLLMOutput(empty)).toBeNull();
  });

  it("confidence out of bounds rejected", () => {
    const bad = {
      proposedChanges: [
        { field: "title", proposedValue: "New", reasoning: "Better" },
      ],
      reasoning: "Good",
      confidence: 1.5,
    };
    expect(parseLLMOutput(bad)).toBeNull();
  });

  it("getLLMParseErrors returns descriptive errors", () => {
    const errors = getLLMParseErrors({ garbage: true });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("proposedChanges"))).toBe(true);
  });
});
