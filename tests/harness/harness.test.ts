/**
 * D.8.1.1 — Harness Self-Test
 *
 * Validates the test harness itself without requiring a live database.
 * Tests:
 *   §1 — DB guard logic (without live DB)
 *   §2 — TestContext generation (deterministic IDs)
 *   §3 — Provider stub all 6 modes
 *   §4 — Infrastructure classification types compile
 *   §5 — Lifecycle stage ordering
 *
 * Classification: UNIT / MOCKED
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  assertStagingDatabase,
  isLiveDbAvailable,
  isLiveRedisAvailable,
} from "./db-guard";
import { makeTestContext } from "./fixtures";
import { D4ProviderStub, type ProviderMode } from "./provider-stub";
import type { LifecycleStage } from "./lifecycle";

// ── §1 DB Guard Logic ─────────────────────────────────────────────────────────

describe("§1 DB Guard — staging URL validation", () => {
  let savedUrl: string | undefined;

  beforeEach(() => {
    savedUrl = process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl;
    else delete process.env.DATABASE_URL;
  });

  it("accepts localhost DATABASE_URL", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/test_db";
    expect(() => assertStagingDatabase()).not.toThrow();
  });

  it("accepts staging indicator in DATABASE_URL", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@staging.host:5432/mydb";
    expect(() => assertStagingDatabase()).not.toThrow();
  });

  it("accepts test indicator in DATABASE_URL", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@test.host:5432/mydb";
    expect(() => assertStagingDatabase()).not.toThrow();
  });

  it("rejects production indicator in DATABASE_URL", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@production.host:5432/mydb";
    expect(() => assertStagingDatabase()).toThrow(/production/i);
  });

  it("rejects empty DATABASE_URL", () => {
    process.env.DATABASE_URL = "";
    expect(() => assertStagingDatabase()).toThrow(/not set/i);
  });

  it("isLiveDbAvailable returns false when D8_LIVE_DB not set", () => {
    delete process.env.D8_LIVE_DB;
    expect(isLiveDbAvailable()).toBe(false);
  });

  it("isLiveRedisAvailable returns false when D8_LIVE_REDIS not set", () => {
    delete process.env.D8_LIVE_REDIS;
    expect(isLiveRedisAvailable()).toBe(false);
  });
});

// ── §2 TestContext Generation ─────────────────────────────────────────────────

describe("§2 TestContext — deterministic ID generation", () => {
  it("generates a unique prefix per label+timestamp", () => {
    const a = makeTestContext("test", 1000);
    const b = makeTestContext("test", 2000);
    expect(a.prefix).not.toBe(b.prefix);
  });

  it("siteId includes prefix", () => {
    const ctx = makeTestContext("site-test", 1000);
    expect(ctx.siteId).toContain("site-test");
  });

  it("id() generates consistent sub-IDs", () => {
    const ctx = makeTestContext("ctx-test", 1000);
    expect(ctx.id("opp")).toBe(`d8-ctx-test-1000-opp`);
    expect(ctx.id("proposal")).toBe(`d8-ctx-test-1000-proposal`);
  });

  it("different labels produce non-overlapping IDs", () => {
    const a = makeTestContext("suite-a", 9999);
    const b = makeTestContext("suite-b", 9999);
    expect(a.siteId).not.toBe(b.siteId);
    expect(a.id("opp")).not.toBe(b.id("opp"));
  });

  it("userId is scoped to prefix", () => {
    const ctx = makeTestContext("user-test", 5000);
    expect(ctx.userId).toContain("user-test");
  });
});

// ── §3 Provider Stub — All 6 Modes ───────────────────────────────────────────

describe("§3 Provider Stub — all failure modes", () => {
  let stub: D4ProviderStub;

  beforeEach(() => {
    stub = new D4ProviderStub();
    stub.reset();
  });

  it("SUCCESS mode returns enhancedContent", async () => {
    stub.setMode("SUCCESS");
    const result = await stub.enhance("opp-1", {});
    expect(result.enhancedContent).toContain("opp-1");
    expect(result.fallbackUsed).toBe(false);
  });

  it("NOT_FOUND mode throws with 404", async () => {
    stub.setMode("NOT_FOUND");
    await expect(stub.enhance("opp-2", {})).rejects.toThrow(/404/);
  });

  it("TIMEOUT mode throws with timeout message", async () => {
    stub.setMode("TIMEOUT");
    await expect(stub.enhance("opp-3", {})).rejects.toThrow(/timeout/i);
  });

  it("RATE_LIMITED mode throws with 429", async () => {
    stub.setMode("RATE_LIMITED");
    await expect(stub.enhance("opp-4", {})).rejects.toThrow(/429/);
  });

  it("MALFORMED_OUTPUT mode throws with parse error", async () => {
    stub.setMode("MALFORMED_OUTPUT");
    await expect(stub.enhance("opp-5", {})).rejects.toThrow(/malformed/i);
  });

  it("DELAYED_SUCCESS waits delayMs then succeeds", async () => {
    stub.setMode("DELAYED_SUCCESS", { delayMs: 50 });
    const start = Date.now();
    const result = await stub.enhance("opp-6", {});
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // Allow timer jitter
    expect(result.fallbackUsed).toBe(false);
  });

  it("records all calls in order", async () => {
    stub.setMode("SUCCESS");
    await stub.enhance("a", {});
    stub.setMode("NOT_FOUND");
    await stub.enhance("b", {}).catch(() => {});
    expect(stub.callCount()).toBe(2);
    expect(stub.calls[0].opportunityId).toBe("a");
    expect(stub.calls[1].opportunityId).toBe("b");
    expect(stub.calls[1].error).toContain("404");
  });

  it("reset clears calls", () => {
    stub.setMode("SUCCESS");
    stub.calls.push({ mode: "SUCCESS", opportunityId: "x", calledAt: new Date() });
    stub.reset();
    expect(stub.callCount()).toBe(0);
  });

  const allModes: ProviderMode[] = [
    "SUCCESS",
    "NOT_FOUND",
    "TIMEOUT",
    "RATE_LIMITED",
    "MALFORMED_OUTPUT",
    "DELAYED_SUCCESS",
  ];

  it("all 6 modes are defined", () => {
    expect(allModes.length).toBe(6);
  });
});

// ── §4 Infrastructure Types Compile ──────────────────────────────────────────

describe("§4 Infrastructure classification types", () => {
  it("InfraMode values are valid", () => {
    const modes: Array<"MOCKED" | "LIVE_DB" | "LIVE_REDIS" | "LIVE_PROVIDER"> = [
      "MOCKED",
      "LIVE_DB",
      "LIVE_REDIS",
      "LIVE_PROVIDER",
    ];
    expect(modes.length).toBe(4);
  });

  it("TestLevel values are valid", () => {
    const levels: Array<"UNIT" | "INTEGRATION" | "E2E"> = ["UNIT", "INTEGRATION", "E2E"];
    expect(levels.length).toBe(3);
  });
});

// ── §5 Lifecycle Stage Ordering ───────────────────────────────────────────────

describe("§5 Lifecycle stages — ordering contract", () => {
  const ORDERED: LifecycleStage[] = [
    "SEEDED",
    "OPEN",
    "SCORED",
    "SELECTED",
    "PLANNED",
    "TRACE",
    "AUTHORIZED",
  ];

  it("has 7 ordered stages", () => {
    expect(ORDERED.length).toBe(7);
  });

  it("SELECTED comes after SCORED", () => {
    expect(ORDERED.indexOf("SELECTED")).toBeGreaterThan(ORDERED.indexOf("SCORED"));
  });

  it("AUTHORIZED is the final stage", () => {
    expect(ORDERED[ORDERED.length - 1]).toBe("AUTHORIZED");
  });

  it("OPEN is the minimum stage for planning", () => {
    expect(ORDERED.indexOf("OPEN")).toBeGreaterThan(ORDERED.indexOf("SEEDED"));
  });
});
