/**
 * Phase D.4 — Decision Trace Tests
 *
 * Tests 23-26: Audit envelope completeness, hash determinism, persistence
 */

import { describe, it, expect } from "vitest";
import { buildAuditEnvelope, buildFallbackEnvelope } from "@/lib/llm-boundary/decision-trace";
import { computeInputHash, computeOutputHash } from "@/lib/llm-boundary/input-builder";
import type { LLMDecisionInput } from "@/lib/llm-boundary/types";

function makeInput(): LLMDecisionInput {
  return Object.freeze({
    opportunityId: "opp_1",
    actionType: "UPDATE_TITLE_TAG",
    category: "QUICK_WIN",
    targetUrl: "/blog/test",
    primaryKeyword: "seo tools",
    currentState: Object.freeze({
      title: "Old Title",
      metaDescription: null,
      wordCount: 500,
      url: "/blog/test",
    }),
    evidence: Object.freeze([
      Object.freeze({ sourceType: "GSC", metric: "position", value: "8", daysAgo: 1 }),
    ]),
    constraints: Object.freeze({
      allowedFields: ["title"] as const,
      maxContentLength: 5000,
      safetyTier: 1,
    }),
  });
}

// ── §23 — Audit envelope contains all required fields ───────────────────────

describe("§23 — Audit envelope completeness", () => {
  it("contains all required fields", () => {
    const envelope = buildAuditEnvelope({
      modelId: "gemini-2.5-flash",
      promptVersion: "d4-title-v1",
      promptHash: "abc123",
      inputHash: "def456",
      outputHash: "ghi789",
      confidence: 0.85,
      validationResult: "VALID",
      fallbackUsed: false,
      latencyMs: 1200,
    });

    expect(envelope.modelId).toBe("gemini-2.5-flash");
    expect(envelope.promptVersion).toBe("d4-title-v1");
    expect(envelope.promptHash).toBe("abc123");
    expect(envelope.inputHash).toBe("def456");
    expect(envelope.outputHash).toBe("ghi789");
    expect(envelope.confidence).toBe(0.85);
    expect(envelope.validationResult).toBe("VALID");
    expect(envelope.fallbackUsed).toBe(false);
    expect(envelope.latencyMs).toBe(1200);
    expect(envelope.timestamp).toBeTruthy();
  });

  it("fallback envelope marks fallbackUsed=true", () => {
    const envelope = buildFallbackEnvelope("inp", "v1", "hash", "reason", 50);
    expect(envelope.fallbackUsed).toBe(true);
    expect(envelope.modelId).toBe("none");
    expect(envelope.outputHash).toBe("d3-template");
    expect(envelope.validationResult).toBe("REJECTED");
  });

  it("envelope is frozen (immutable)", () => {
    const envelope = buildAuditEnvelope({
      modelId: "gemini-2.5-flash",
      promptVersion: "v1",
      promptHash: "h",
      inputHash: "i",
      outputHash: "o",
      confidence: 0.5,
      validationResult: "VALID",
      fallbackUsed: false,
      latencyMs: 100,
    });
    expect(Object.isFrozen(envelope)).toBe(true);
  });
});

// ── §24 — inputHash is deterministic ────────────────────────────────────────

describe("§24 — inputHash determinism", () => {
  it("same input always produces same hash", () => {
    const input = makeInput();
    const h1 = computeInputHash(input);
    const h2 = computeInputHash(input);
    expect(h1).toBe(h2);
    expect(h1.length).toBe(64); // SHA-256 hex
  });

  it("different input produces different hash", () => {
    const input1 = makeInput();
    const input2 = {
      ...makeInput(),
      primaryKeyword: "different keyword",
    };
    const h1 = computeInputHash(input1);
    const h2 = computeInputHash(input2);
    expect(h1).not.toBe(h2);
  });
});

// ── §25 — outputHash is deterministic ───────────────────────────────────────

describe("§25 — outputHash determinism", () => {
  it("same output always produces same hash", () => {
    const output = {
      proposedChanges: [{ field: "title", proposedValue: "New", reasoning: "Better" }],
      reasoning: "Improvement",
      confidence: 0.8,
    };
    const h1 = computeOutputHash(output);
    const h2 = computeOutputHash(output);
    expect(h1).toBe(h2);
    expect(h1.length).toBe(64);
  });
});

// ── §26 — Audit envelope persistence shape ──────────────────────────────────

describe("§26 — Audit envelope persists on ActionProposal.metadata.llm", () => {
  it("envelope is JSON-serializable for Prisma Json field", () => {
    const envelope = buildAuditEnvelope({
      modelId: "gemini-2.5-flash",
      promptVersion: "d4-title-v1",
      promptHash: "abc",
      inputHash: "def",
      outputHash: "ghi",
      confidence: 0.85,
      validationResult: "VALID",
      fallbackUsed: false,
      latencyMs: 1200,
    });

    // Must be JSON-serializable
    const json = JSON.stringify({ llm: envelope });
    const parsed = JSON.parse(json);
    expect(parsed.llm.modelId).toBe("gemini-2.5-flash");
    expect(parsed.llm.inputHash).toBe("def");
    expect(parsed.llm.outputHash).toBe("ghi");
  });

  it("envelope does NOT contain raw input or output", () => {
    const envelope = buildAuditEnvelope({
      modelId: "gemini-2.5-flash",
      promptVersion: "v1",
      promptHash: "h",
      inputHash: "i",
      outputHash: "o",
      confidence: 0.5,
      validationResult: "VALID",
      fallbackUsed: false,
      latencyMs: 100,
    });

    const keys = Object.keys(envelope);
    expect(keys).not.toContain("rawInput");
    expect(keys).not.toContain("rawOutput");
    expect(keys).not.toContain("input");
    expect(keys).not.toContain("output");
  });
});
