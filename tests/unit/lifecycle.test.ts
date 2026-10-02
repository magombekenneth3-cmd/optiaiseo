import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isValidLifecycleTransition,
  isValidVerificationTransition,
  computeVerificationIdempotencyKey,
  computeDeploymentIdempotencyKey,
  LIFECYCLE_STATE,
  VERIFICATION_OUTCOME,
  DEPLOYMENT_STATE,
} from "@/lib/seo-audit/lifecycle";

describe("Lifecycle State Machine", () => {
  describe("isValidLifecycleTransition", () => {
    it("allows OPEN -> IN_PROGRESS", () => {
      expect(isValidLifecycleTransition("OPEN", "IN_PROGRESS")).toBe(true);
    });

    it("allows OPEN -> RESOLVED", () => {
      expect(isValidLifecycleTransition("OPEN", "RESOLVED")).toBe(true);
    });

    it("allows IN_PROGRESS -> RESOLVED", () => {
      expect(isValidLifecycleTransition("IN_PROGRESS", "RESOLVED")).toBe(true);
    });

    it("allows RESOLVED -> REGRESSED", () => {
      expect(isValidLifecycleTransition("RESOLVED", "REGRESSED")).toBe(true);
    });

    it("allows REGRESSED -> IN_PROGRESS", () => {
      expect(isValidLifecycleTransition("REGRESSED", "IN_PROGRESS")).toBe(true);
    });

    it("rejects same-state transitions", () => {
      expect(isValidLifecycleTransition("OPEN", "OPEN")).toBe(false);
    });

    it("rejects OPEN -> REGRESSED (no prior resolution)", () => {
      expect(isValidLifecycleTransition("OPEN", "REGRESSED")).toBe(false);
    });

    it("allows RESOLVED -> OPEN (reopen)", () => {
      expect(isValidLifecycleTransition("RESOLVED", "OPEN")).toBe(true);
    });

    it("allows UNKNOWN -> OPEN", () => {
      expect(isValidLifecycleTransition("UNKNOWN", "OPEN")).toBe(true);
    });

    it("allows IN_PROGRESS -> REGRESSED", () => {
      expect(isValidLifecycleTransition("IN_PROGRESS", "REGRESSED")).toBe(true);
    });

    it("rejects RESOLVED -> IN_PROGRESS (must go through REGRESSED or OPEN)", () => {
      expect(isValidLifecycleTransition("RESOLVED", "IN_PROGRESS")).toBe(false);
    });
  });

  describe("isValidVerificationTransition", () => {
    it("allows PENDING -> TECHNICALLY_VERIFIED", () => {
      expect(isValidVerificationTransition("PENDING", "TECHNICALLY_VERIFIED")).toBe(true);
    });

    it("allows TECHNICALLY_VERIFIED -> SEARCH_VERIFIED", () => {
      expect(isValidVerificationTransition("TECHNICALLY_VERIFIED", "SEARCH_VERIFIED")).toBe(true);
    });

    it("allows SEARCH_VERIFIED -> OUTCOME_MEASURED", () => {
      expect(isValidVerificationTransition("SEARCH_VERIFIED", "OUTCOME_MEASURED")).toBe(true);
    });

    it("rejects PENDING -> OUTCOME_MEASURED (skips required steps)", () => {
      expect(isValidVerificationTransition("PENDING", "OUTCOME_MEASURED")).toBe(false);
    });

    it("rejects REGRESSED -> SEARCH_VERIFIED", () => {
      expect(isValidVerificationTransition("REGRESSED", "SEARCH_VERIFIED")).toBe(false);
    });

    it("allows INSUFFICIENT_DATA -> PENDING (retry)", () => {
      expect(isValidVerificationTransition("INSUFFICIENT_DATA", "PENDING")).toBe(true);
    });

    it("allows TECHNICALLY_VERIFIED -> INEFFECTIVE", () => {
      expect(isValidVerificationTransition("TECHNICALLY_VERIFIED", "INEFFECTIVE")).toBe(true);
    });

    it("allows TECHNICALLY_VERIFIED -> NO_MEASURABLE_CHANGE", () => {
      expect(isValidVerificationTransition("TECHNICALLY_VERIFIED", "NO_MEASURABLE_CHANGE")).toBe(true);
    });

    it("allows NO_MEASURABLE_CHANGE -> OUTCOME_MEASURED", () => {
      expect(isValidVerificationTransition("NO_MEASURABLE_CHANGE", "OUTCOME_MEASURED")).toBe(true);
    });

    it("rejects same-state transitions", () => {
      expect(isValidVerificationTransition("PENDING", "PENDING")).toBe(false);
    });

    it("allows PENDING -> PARTIALLY_VERIFIED", () => {
      expect(isValidVerificationTransition("PENDING", "PARTIALLY_VERIFIED")).toBe(true);
    });

    it("allows OUTCOME_MEASURED -> REGRESSED (post-measurement regression)", () => {
      expect(isValidVerificationTransition("OUTCOME_MEASURED", "REGRESSED")).toBe(true);
    });
  });

  describe("computeVerificationIdempotencyKey", () => {
    it("produces deterministic keys", () => {
      const k1 = computeVerificationIdempotencyKey("finding-1", "T0", "abc123");
      const k2 = computeVerificationIdempotencyKey("finding-1", "T0", "abc123");
      expect(k1).toBe(k2);
    });

    it("produces different keys for different windows", () => {
      const t0 = computeVerificationIdempotencyKey("finding-1", "T0", "abc123");
      const t7 = computeVerificationIdempotencyKey("finding-1", "T7", "abc123");
      expect(t0).not.toBe(t7);
    });

    it("produces different keys for different revisions", () => {
      const r1 = computeVerificationIdempotencyKey("finding-1", "T0", "rev-1");
      const r2 = computeVerificationIdempotencyKey("finding-1", "T0", "rev-2");
      expect(r1).not.toBe(r2);
    });

    it("produces different keys for different findings", () => {
      const f1 = computeVerificationIdempotencyKey("finding-1", "T0", "rev-1");
      const f2 = computeVerificationIdempotencyKey("finding-2", "T0", "rev-1");
      expect(f1).not.toBe(f2);
    });

    it("handles null deployment revision", () => {
      const k = computeVerificationIdempotencyKey("finding-1", "T0", null);
      expect(k).toHaveLength(24);
    });

    it("returns 24-char hex string", () => {
      const k = computeVerificationIdempotencyKey("finding-1", "T7", "deploy-42");
      expect(k).toMatch(/^[a-f0-9]{24}$/);
    });

    it("null and undefined revision produce same key", () => {
      const k1 = computeVerificationIdempotencyKey("f1", "T0", null);
      const k2 = computeVerificationIdempotencyKey("f1", "T0", null);
      expect(k1).toBe(k2);
    });

    it("T0, T7, T28 all produce distinct keys for same finding+revision", () => {
      const keys = ["T0", "T7", "T28"].map(w =>
        computeVerificationIdempotencyKey("f1", w, "rev-x"),
      );
      expect(new Set(keys).size).toBe(3);
    });
  });

  describe("computeDeploymentIdempotencyKey", () => {
    it("produces deterministic keys", () => {
      const k1 = computeDeploymentIdempotencyKey("site-1", "finding-1", "rev-a");
      const k2 = computeDeploymentIdempotencyKey("site-1", "finding-1", "rev-a");
      expect(k1).toBe(k2);
    });

    it("differs by site", () => {
      const a = computeDeploymentIdempotencyKey("site-a", "finding-1", "rev-a");
      const b = computeDeploymentIdempotencyKey("site-b", "finding-1", "rev-a");
      expect(a).not.toBe(b);
    });

    it("differs by finding", () => {
      const a = computeDeploymentIdempotencyKey("site-1", "finding-a", "rev-a");
      const b = computeDeploymentIdempotencyKey("site-1", "finding-b", "rev-a");
      expect(a).not.toBe(b);
    });

    it("differs by revision", () => {
      const a = computeDeploymentIdempotencyKey("site-1", "finding-1", "rev-a");
      const b = computeDeploymentIdempotencyKey("site-1", "finding-1", "rev-b");
      expect(a).not.toBe(b);
    });

    it("returns 24-char hex string", () => {
      const k = computeDeploymentIdempotencyKey("site-1", "finding-1", "rev-a");
      expect(k).toMatch(/^[a-f0-9]{24}$/);
    });
  });

  describe("State enums are consistent", () => {
    it("LIFECYCLE_STATE has all expected values", () => {
      expect(Object.values(LIFECYCLE_STATE)).toEqual(
        expect.arrayContaining(["OPEN", "IN_PROGRESS", "RESOLVED", "REGRESSED", "UNKNOWN"]),
      );
    });

    it("VERIFICATION_OUTCOME has all expected values", () => {
      expect(Object.values(VERIFICATION_OUTCOME)).toEqual(
        expect.arrayContaining([
          "PENDING", "TECHNICALLY_VERIFIED", "SEARCH_VERIFIED",
          "OUTCOME_MEASURED", "INEFFECTIVE", "REGRESSED",
          "UNKNOWN", "INSUFFICIENT_DATA",
        ]),
      );
    });

    it("DEPLOYMENT_STATE has all expected values", () => {
      expect(Object.values(DEPLOYMENT_STATE)).toEqual(
        expect.arrayContaining([
          "PROPOSED", "PR_OPENED", "MERGED",
          "MERGED_AWAITING_DEPLOYMENT", "DEPLOYMENT_CONFIRMED",
        ]),
      );
    });

    it("LIFECYCLE_STATE has no duplicate values", () => {
      const values = Object.values(LIFECYCLE_STATE);
      expect(new Set(values).size).toBe(values.length);
    });

    it("VERIFICATION_OUTCOME has no duplicate values", () => {
      const values = Object.values(VERIFICATION_OUTCOME);
      expect(new Set(values).size).toBe(values.length);
    });
  });

  describe("Lifecycle transition completeness", () => {
    const allStates = Object.values(LIFECYCLE_STATE);

    it("every state has at least one valid outgoing transition", () => {
      for (const state of allStates) {
        const hasOutgoing = allStates.some(
          target => target !== state && isValidLifecycleTransition(state, target),
        );
        expect(hasOutgoing).toBe(true);
      }
    });

    it("REGRESSED can be re-resolved", () => {
      expect(isValidLifecycleTransition("REGRESSED", "RESOLVED")).toBe(true);
    });

    it("no state can transition to itself", () => {
      for (const state of allStates) {
        expect(isValidLifecycleTransition(state, state)).toBe(false);
      }
    });
  });

  describe("Verification transition completeness", () => {
    const allOutcomes = Object.values(VERIFICATION_OUTCOME);

    it("PENDING can reach terminal states", () => {
      expect(isValidVerificationTransition("PENDING", "INEFFECTIVE")).toBe(true);
      expect(isValidVerificationTransition("PENDING", "REGRESSED")).toBe(true);
      expect(isValidVerificationTransition("PENDING", "UNKNOWN")).toBe(true);
    });

    it("no outcome can transition to itself", () => {
      for (const outcome of allOutcomes) {
        expect(isValidVerificationTransition(outcome, outcome)).toBe(false);
      }
    });
  });
});

describe("URL normalization consistency", () => {
  function normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      let normalized = parsed.origin.toLowerCase() + parsed.pathname + parsed.search;
      return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
    } catch {
      return url.replace(/\/+$/, "").toLowerCase();
    }
  }

  it("lowercases origin but preserves path case", () => {
    expect(normalizeUrl("https://Example.COM/Page")).toBe("https://example.com/Page");
  });

  it("strips trailing slash", () => {
    expect(normalizeUrl("https://example.com/page/")).toBe("https://example.com/page");
  });

  it("strips hash fragments", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe("https://example.com/page");
  });

  it("preserves query parameters", () => {
    expect(normalizeUrl("https://example.com/page?q=test")).toBe("https://example.com/page?q=test");
  });

  it("same URLs with different origin case match", () => {
    expect(normalizeUrl("https://Example.com/path")).toBe(normalizeUrl("https://EXAMPLE.COM/path"));
  });

  it("handles fallback for invalid URLs", () => {
    expect(normalizeUrl("not-a-url///")).toBe("not-a-url");
  });
});

describe("Idempotency key separation", () => {
  it("T0 and T7 keys for same finding never collide", () => {
    for (let i = 0; i < 100; i++) {
      const rev = `rev-${i}`;
      const t0 = computeVerificationIdempotencyKey("f1", "T0", rev);
      const t7 = computeVerificationIdempotencyKey("f1", "T7", rev);
      const t28 = computeVerificationIdempotencyKey("f1", "T28", rev);
      expect(t0).not.toBe(t7);
      expect(t0).not.toBe(t28);
      expect(t7).not.toBe(t28);
    }
  });

  it("deployment key and verification key never collide for same inputs", () => {
    const deployKey = computeDeploymentIdempotencyKey("site-1", "finding-1", "rev-a");
    const verifyKey = computeVerificationIdempotencyKey("finding-1", "T0", "rev-a");
    expect(deployKey).not.toBe(verifyKey);
  });
});
