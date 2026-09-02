/**
 * Phase B.5 — External-Effect Idempotency Tests
 *
 * Verifies that:
 *   §1 — Effect idempotency keys are deterministic and collision-free
 *   §2 — Operation idempotency keys prevent duplicate operations
 *   §3 — Effect registration is idempotent (same key → same row)
 *   §4 — No direct external API calls bypass the effect system
 *   §5 — Effect retry uses exponential backoff with max attempts
 *   §6 — Effect dispatch is channel-gated by kill switches
 */

import { describe, it, expect } from "vitest";
import { generateOperationKey, generateEffectKey } from "@/lib/mutations/idempotency";

// ══════════════════════════════════════════════════════════════════════════════
// §1 — Effect idempotency keys are deterministic
// ══════════════════════════════════════════════════════════════════════════════

describe("§1 Effect idempotency keys", () => {
  it("same params → same key (deterministic)", () => {
    const k1 = generateEffectKey("CMS_PUBLISH", { operationId: "op-1", slug: "/about" });
    const k2 = generateEffectKey("CMS_PUBLISH", { operationId: "op-1", slug: "/about" });
    expect(k1).toBe(k2);
  });

  it("different effectType → different key", () => {
    const k1 = generateEffectKey("CMS_PUBLISH", { operationId: "op-1" });
    const k2 = generateEffectKey("INDEXNOW", { operationId: "op-1" });
    expect(k1).not.toBe(k2);
  });

  it("different params → different key", () => {
    const k1 = generateEffectKey("INDEXNOW", { operationId: "op-1", url: "/about" });
    const k2 = generateEffectKey("INDEXNOW", { operationId: "op-1", url: "/pricing" });
    expect(k1).not.toBe(k2);
  });

  it("param order doesn't matter (keys are sorted internally)", () => {
    const k1 = generateEffectKey("CMS_PUBLISH", { operationId: "op-1", slug: "/about" });
    const k2 = generateEffectKey("CMS_PUBLISH", { slug: "/about", operationId: "op-1" });
    expect(k1).toBe(k2);
  });

  it("key format starts with 'fx:' prefix", () => {
    const key = generateEffectKey("CMS_PUBLISH", { operationId: "op-1" });
    expect(key).toMatch(/^fx:/);
  });

  it("key contains the effect type", () => {
    const key = generateEffectKey("CMS_PUBLISH", { operationId: "op-1" });
    expect(key).toContain("CMS_PUBLISH");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2 — Operation idempotency keys prevent duplicate operations
// ══════════════════════════════════════════════════════════════════════════════

describe("§2 Operation idempotency keys", () => {
  it("same params → same key (prevents duplicate creation)", () => {
    const k1 = generateOperationKey("growth", { targetModel: "Blog", targetId: "blog-1" });
    const k2 = generateOperationKey("growth", { targetModel: "Blog", targetId: "blog-1" });
    expect(k1).toBe(k2);
  });

  it("different targetId → different key", () => {
    const k1 = generateOperationKey("growth", { targetModel: "Blog", targetId: "blog-1" });
    const k2 = generateOperationKey("growth", { targetModel: "Blog", targetId: "blog-2" });
    expect(k1).not.toBe(k2);
  });

  it("key format starts with 'op:' prefix", () => {
    const key = generateOperationKey("growth", { targetModel: "Blog", targetId: "blog-1" });
    expect(key).toMatch(/^op:/);
  });

  it("decisionId makes operation keys unique per decision", () => {
    const k1 = generateOperationKey("growth", { decisionId: "dec-1", targetId: "blog-1" });
    const k2 = generateOperationKey("growth", { decisionId: "dec-2", targetId: "blog-1" });
    expect(k1).not.toBe(k2);
  });

  it("operation key is stable across retries (Inngest idempotency)", () => {
    // If Inngest retries the same decision execution, the same operation key
    // is generated → the existing operation is returned (not duplicated)
    const attempt1 = generateOperationKey("BLOG_CONTENT_UPDATE", {
      targetModel: "Blog",
      targetId: "blog-1",
      decisionId: "dec-42",
    });
    const attempt2 = generateOperationKey("BLOG_CONTENT_UPDATE", {
      targetModel: "Blog",
      targetId: "blog-1",
      decisionId: "dec-42",
    });
    expect(attempt1).toBe(attempt2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §3 — Effect registration is idempotent
// ══════════════════════════════════════════════════════════════════════════════

describe("§3 Effect registration idempotency", () => {
  it("registerEffect checks for existing effect before creating", async () => {
    // The registerEffect function:
    // 1. Generates idempotency key
    // 2. Calls findUnique with the key
    // 3. If exists → returns existing ID (no creation)
    // 4. If not → creates new effect
    //
    // This means crash-and-retry after registerEffect is safe:
    // the second call finds the existing effect and returns it.
    const fs = require("fs");
    const content = fs.readFileSync(
      "/Users/extremesales/Downloads/aiseo2_fixed 3/src/lib/mutations/operation.ts",
      "utf-8"
    );
    expect(content).toContain("findUnique");
    expect(content).toContain("idempotencyKey");
  });

  it("effect keys include operationId — scoped to parent operation", () => {
    const k1 = generateEffectKey("INDEXNOW", { operationId: "op-1", url: "/about" });
    const k2 = generateEffectKey("INDEXNOW", { operationId: "op-2", url: "/about" });
    // Same URL but different operations → different keys
    expect(k1).not.toBe(k2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §4 — No direct external API calls bypass the effect system
// ══════════════════════════════════════════════════════════════════════════════

describe("§4 No bypassed external calls in execution engine", () => {
  it("execution-engine.ts does NOT call triggerInstantIndexing directly", () => {
    const fs = require("fs");
    const content = fs.readFileSync(
      "/Users/extremesales/Downloads/aiseo2_fixed 3/src/lib/growth/execution-engine.ts",
      "utf-8"
    );
    // Should NOT import or call triggerInstantIndexing
    expect(content).not.toContain("import { triggerInstantIndexing }");
    // The comment mentioning it is fine, but an actual function call is not
    expect(content).not.toMatch(/await\s+triggerInstantIndexing\s*\(/);
  });

  it("execution-engine.ts registers INDEXNOW via registerEffect", () => {
    const fs = require("fs");
    const content = fs.readFileSync(
      "/Users/extremesales/Downloads/aiseo2_fixed 3/src/lib/growth/execution-engine.ts",
      "utf-8"
    );
    expect(content).toContain('effectType: "INDEXNOW"');
    expect(content).toContain("registerEffect");
  });

  it("execution-engine.ts registers GOOGLE_INDEXING via registerEffect", () => {
    const fs = require("fs");
    const content = fs.readFileSync(
      "/Users/extremesales/Downloads/aiseo2_fixed 3/src/lib/growth/execution-engine.ts",
      "utf-8"
    );
    expect(content).toContain('effectType: "GOOGLE_INDEXING"');
  });

  it("execution-engine.ts skips effects on leaseLost (checks execResult)", () => {
    // The execution engine checks execResult.success before registering effects.
    // If executeOperation() returned leaseLost, success = false → effects skipped.
    const fs = require("fs");
    const content = fs.readFileSync(
      "/Users/extremesales/Downloads/aiseo2_fixed 3/src/lib/growth/execution-engine.ts",
      "utf-8"
    );
    expect(content).toContain("if (!execResult.success)");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §5 — Effect retry uses exponential backoff with max attempts
// ══════════════════════════════════════════════════════════════════════════════

describe("§5 Effect retry semantics", () => {
  it("markEffectFailed uses exponential backoff: 2^attempts * 5000ms", () => {
    const fs = require("fs");
    const content = fs.readFileSync(
      "/Users/extremesales/Downloads/aiseo2_fixed 3/src/lib/inngest/functions/mutation-effects.ts",
      "utf-8"
    );
    // Verify the backoff formula exists
    expect(content).toContain("Math.pow(2, newAttempts)");
    expect(content).toContain("5000");
  });

  it("effect becomes FAILED (terminal) after maxAttempts exceeded", () => {
    const fs = require("fs");
    const content = fs.readFileSync(
      "/Users/extremesales/Downloads/aiseo2_fixed 3/src/lib/inngest/functions/mutation-effects.ts",
      "utf-8"
    );
    expect(content).toContain("isTerminal");
    expect(content).toContain("maxAttempts");
    expect(content).toContain('status: isTerminal ? "FAILED" : "QUEUED"');
  });

  it("default maxAttempts = 5 (from registerEffect)", () => {
    const fs = require("fs");
    const content = fs.readFileSync(
      "/Users/extremesales/Downloads/aiseo2_fixed 3/src/lib/mutations/operation.ts",
      "utf-8"
    );
    expect(content).toContain("maxAttempts: params.maxAttempts ?? 5");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §6 — Effect dispatch is channel-gated by kill switches
// ══════════════════════════════════════════════════════════════════════════════

describe("§6 Kill switch channel gating", () => {
  it("effect processor checks channel kill switch before dispatching", () => {
    const fs = require("fs");
    const content = fs.readFileSync(
      "/Users/extremesales/Downloads/aiseo2_fixed 3/src/lib/inngest/functions/mutation-effects.ts",
      "utf-8"
    );
    expect(content).toContain("assertEffectChannelEnabled");
    expect(content).toContain("EFFECT_TO_CHANNEL");
  });

  it("EFFECT_TO_CHANNEL maps all known effect types", () => {
    const fs = require("fs");
    const content = fs.readFileSync(
      "/Users/extremesales/Downloads/aiseo2_fixed 3/src/lib/inngest/functions/mutation-effects.ts",
      "utf-8"
    );
    expect(content).toContain("CMS_PUBLISH:");
    expect(content).toContain("GITHUB_PR:");
    expect(content).toContain("INDEXNOW:");
    expect(content).toContain("GOOGLE_INDEXING:");
  });

  it("blocked effects are skipped (not failed) — they can retry later", () => {
    const fs = require("fs");
    const content = fs.readFileSync(
      "/Users/extremesales/Downloads/aiseo2_fixed 3/src/lib/inngest/functions/mutation-effects.ts",
      "utf-8"
    );
    // MutationBlockedError → skip (continue), not mark as failed
    expect(content).toContain("blocked++");
    expect(content).toContain("continue");
  });
});
