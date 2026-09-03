/**
 * Phase D.4 — Prompt Tests
 *
 * Tests 21-22: Prompt hash stability and audit trace
 */

import { describe, it, expect } from "vitest";
import { getPromptForAction, getPromptVersion, getPromptHash } from "@/lib/llm-boundary/prompts";
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

// ── §21 — Prompt hash stability ─────────────────────────────────────────────

describe("§21 — Prompt hash is stable for same version", () => {
  it("same action type always produces same hash", () => {
    const h1 = getPromptHash("UPDATE_TITLE_TAG");
    const h2 = getPromptHash("UPDATE_TITLE_TAG");
    expect(h1).toBe(h2);
    expect(h1).toBeTruthy();
  });

  it("different action types produce different hashes", () => {
    const titleHash = getPromptHash("UPDATE_TITLE_TAG");
    const metaHash = getPromptHash("UPDATE_META_DESCRIPTION");
    expect(titleHash).not.toBe(metaHash);
  });

  it("prompt version is stable", () => {
    expect(getPromptVersion("UPDATE_TITLE_TAG")).toBe("d4-title-v1");
    expect(getPromptVersion("UPDATE_META_DESCRIPTION")).toBe("d4-meta-v1");
    expect(getPromptVersion("REFRESH_CONTENT")).toBe("d4-refresh-v1");
  });

  it("non-enhanceable action returns null", () => {
    expect(getPromptHash("DELETE_PAGE")).toBeNull();
    expect(getPromptVersion("DELETE_PAGE")).toBeNull();
  });
});

// ── §22 — Auditable trace ───────────────────────────────────────────────────

describe("§22 — Same input/model/prompt produces auditable trace", () => {
  it("prompt template builds deterministically", () => {
    const input = makeInput();
    const template = getPromptForAction("UPDATE_TITLE_TAG", input);
    expect(template).not.toBeNull();

    const prompt1 = template!.build(input);
    const prompt2 = template!.build(input);
    expect(prompt1).toBe(prompt2);
  });

  it("prompt includes the keyword and URL", () => {
    const input = makeInput();
    const template = getPromptForAction("UPDATE_TITLE_TAG", input)!;
    const prompt = template.build(input);

    expect(prompt).toContain("seo tools");
    expect(prompt).toContain("/blog/test");
  });

  it("prompt includes allowed field restriction", () => {
    const input = makeInput();
    const template = getPromptForAction("UPDATE_TITLE_TAG", input)!;
    const prompt = template.build(input);

    expect(prompt).toContain('"title"');
    expect(prompt).toContain("Do NOT return");
  });

  it("prompt includes prohibition on returning actionType/safetyTier", () => {
    const input = makeInput();
    const template = getPromptForAction("UPDATE_TITLE_TAG", input)!;
    const prompt = template.build(input);

    expect(prompt).toContain("actionType");
    expect(prompt).toContain("safetyTier");
    expect(prompt).toContain("Do NOT");
  });
});
