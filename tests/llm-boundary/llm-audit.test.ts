/**
 * Phase D.4 — LLM Audit Tests
 *
 * Tests 27-34: Architectural boundary enforcement
 * These are static analysis tests that verify D.4 never crosses
 * into Phase C authorization, mutations, budget, or execution.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  LLM_ENHANCEABLE_ACTIONS,
  ACTION_FIELD_ALLOWLIST,
} from "@/lib/llm-boundary/types";
import { llmOutputSchema } from "@/lib/llm-boundary/output-schema";

const LLM_BOUNDARY_DIR = path.resolve(
  process.cwd(),
  "src/lib/llm-boundary"
);

function getAllSourceFiles(): string[] {
  const files = fs.readdirSync(LLM_BOUNDARY_DIR);
  return files
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(LLM_BOUNDARY_DIR, f));
}

function readAllSource(): string {
  return getAllSourceFiles()
    .map((f) => fs.readFileSync(f, "utf-8"))
    .join("\n");
}

/**
 * Strip comment lines from source code for checking executable code only.
 * Strips single-line // comments and lines that are part of block comments.
 */
function stripComments(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const trimmed = l.trim();
      return (
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("/*") &&
        !trimmed.startsWith("*/")
      );
    })
    .join("\n");
}

// ── §27 — No Phase C imports ────────────────────────────────────────────────

describe("§27 — No Phase C imports in llm-boundary/", () => {
  it("does not import safety-policy", () => {
    const src = readAllSource();
    expect(src).not.toMatch(/from\s+["'].*safety-policy/);
  });

  it("does not import opportunity-lifecycle", () => {
    const src = readAllSource();
    expect(src).not.toMatch(/from\s+["'].*opportunity-lifecycle/);
  });

  it("does not import approval logic", () => {
    const src = readAllSource();
    expect(src).not.toMatch(/from\s+["'].*evaluatePolicy/);
    expect(src).not.toMatch(/from\s+["'].*approveProposal/);
  });
});

// ── §28 — No mutation imports ───────────────────────────────────────────────

describe("§28 — No mutation imports in llm-boundary/", () => {
  it("does not import from mutations/", () => {
    const src = readAllSource();
    expect(src).not.toMatch(/from\s+["']@\/lib\/mutations/);
  });

  it("does not import MutationOperation", () => {
    const src = readAllSource();
    expect(src).not.toMatch(/MutationOperation/);
  });
});

// ── §29 — Cannot create APPROVED proposal ───────────────────────────────────

describe("§29 — D.4 cannot create APPROVED proposal", () => {
  it("source code never assigns status to APPROVED", () => {
    const src = readAllSource();
    const code = stripComments(src);
    expect(code).not.toMatch(/status\s*[:=]\s*["']APPROVED["']/);
  });
});

// ── §30 — Cannot reserve budget ─────────────────────────────────────────────

describe("§30 — D.4 cannot reserve budget", () => {
  it("does not import budget-enforcer", () => {
    const src = readAllSource();
    expect(src).not.toMatch(/from\s+["'].*budget-enforcer/);
  });

  it("does not call reserveBudget in executable code", () => {
    const src = readAllSource();
    const code = stripComments(src);
    // reserveBudget() function call (not string literal in blocklist)
    expect(code).not.toMatch(/reserveBudget\s*\(/);
    // budgetReservation as a variable/property access (not string literal)
    expect(code).not.toMatch(/\.budgetReservation/);
  });
});

// ── §31 — Cannot acquire execution claim ────────────────────────────────────

describe("§31 — D.4 cannot acquire execution claim", () => {
  it("does not import execution-claim", () => {
    const src = readAllSource();
    expect(src).not.toMatch(/from\s+["'].*execution-claim/);
  });

  it("does not call acquireClaim in executable code", () => {
    const src = readAllSource();
    const code = stripComments(src);
    // acquireClaim() function call (not string literal in blocklist)
    expect(code).not.toMatch(/acquireClaim\s*\(/);
    // executionClaim as property access (not string literal)
    expect(code).not.toMatch(/\.executionClaim/);
  });
});

// ── §32 — Cannot transition opportunity status ──────────────────────────────

describe("§32 — D.4 cannot transition opportunity status", () => {
  it("does not import transitionOpportunity", () => {
    const src = readAllSource();
    expect(src).not.toMatch(/transitionOpportunity/);
  });

  it("does not set opportunityStatus in executable code", () => {
    const src = readAllSource();
    const code = stripComments(src);
    expect(code).not.toMatch(/opportunityStatus\s*[:=]\s*["']/);
  });
});

// ── §33 — Destructive actions never LLM-enhanced ───────────────────────────

describe("§33 — Destructive actions never LLM-enhanced", () => {
  it("LLM_ENHANCEABLE_ACTIONS does not include destructive actions", () => {
    const destructive = [
      "DELETE_PAGE",
      "CONSOLIDATE_CONTENT",
      "MASS_REDIRECT",
      "SITE_WIDE_CHANGE",
      "REDIRECT_URL",
    ];
    for (const action of destructive) {
      expect(
        LLM_ENHANCEABLE_ACTIONS.has(action),
        `${action} must NOT be LLM-enhanceable`
      ).toBe(false);
    }
  });

  it("ACTION_FIELD_ALLOWLIST does not include destructive actions", () => {
    const destructive = [
      "DELETE_PAGE",
      "CONSOLIDATE_CONTENT",
      "MASS_REDIRECT",
      "SITE_WIDE_CHANGE",
    ];
    for (const action of destructive) {
      expect(ACTION_FIELD_ALLOWLIST[action]).toBeUndefined();
    }
  });
});

// ── §34 — Constraints are readonly ──────────────────────────────────────────

describe("§34 — LLM constraints are readonly (no output → constraint path)", () => {
  it("no source code writes to constraints", () => {
    const src = readAllSource();
    const code = stripComments(src);
    expect(code).not.toMatch(/constraints\.allowedFields\s*=/);
    expect(code).not.toMatch(/constraints\.safetyTier\s*=/);
    expect(code).not.toMatch(/constraints\.maxContentLength\s*=/);
  });

  it("output validator does not modify constraints", () => {
    const validatorSrc = fs.readFileSync(
      path.join(LLM_BOUNDARY_DIR, "output-validator.ts"),
      "utf-8"
    );
    expect(validatorSrc).toContain("constraints.allowedFields");
    expect(validatorSrc).not.toMatch(/constraints\.[a-zA-Z]+\s*=/);
  });

  it("LLM output schema has no safetyTier, actionType, or status fields", () => {
    const shape = llmOutputSchema.shape;
    const keys = Object.keys(shape);
    expect(keys).not.toContain("safetyTier");
    expect(keys).not.toContain("actionType");
    expect(keys).not.toContain("status");
  });
});
