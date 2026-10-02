import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isValidLifecycleTransition,
  computeVerificationIdempotencyKey,
  computeDeploymentIdempotencyKey,
  LIFECYCLE_STATE,
} from "@/lib/seo-audit/lifecycle";
import {
  computeEvidenceHash,
  computeFindingFingerprint,
  type SEOEvidence,
} from "@/lib/seo-audit/contracts";

describe("Audit: Out-of-order deployment revisions", () => {
  it("different revisions produce different idempotency keys — each gets its own verification chain", () => {
    const rev1Key = computeVerificationIdempotencyKey("finding-1", "T0", "rev-old");
    const rev2Key = computeVerificationIdempotencyKey("finding-1", "T0", "rev-new");
    expect(rev1Key).not.toBe(rev2Key);
  });

  it("deployment keys for the same finding with different revisions are distinct", () => {
    const deploy1 = computeDeploymentIdempotencyKey("site-1", "finding-1", "sha-old");
    const deploy2 = computeDeploymentIdempotencyKey("site-1", "finding-1", "sha-new");
    expect(deploy1).not.toBe(deploy2);
  });

  it("lifecycle transition from RESOLVED back to IN_PROGRESS is invalid (prevents out-of-order regression)", () => {
    expect(isValidLifecycleTransition("RESOLVED", "IN_PROGRESS")).toBe(false);
  });

  it("lifecycle requires RESOLVED -> REGRESSED -> IN_PROGRESS for re-verification", () => {
    expect(isValidLifecycleTransition("RESOLVED", "REGRESSED")).toBe(true);
    expect(isValidLifecycleTransition("REGRESSED", "IN_PROGRESS")).toBe(true);
  });
});

describe("Audit: T+0/T+7/T+28 linkage and missing-data cases", () => {
  it("T+0 key is distinct from T+7 key for same finding+revision", () => {
    const t0Key = computeVerificationIdempotencyKey("finding-1", "T0", "rev-abc");
    const t7Key = computeVerificationIdempotencyKey("finding-1", "T7", "rev-abc");
    const t28Key = computeVerificationIdempotencyKey("finding-1", "T28", "rev-abc");
    expect(new Set([t0Key, t7Key, t28Key]).size).toBe(3);
  });

  it("missing deploymentRevision uses consistent null handling", () => {
    const k1 = computeVerificationIdempotencyKey("finding-1", "T0", null);
    const k2 = computeVerificationIdempotencyKey("finding-1", "T0", null);
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[a-f0-9]{24}$/);
  });

  it("unknown revision string produces distinct key from null revision", () => {
    const nullKey = computeVerificationIdempotencyKey("finding-1", "T0", null);
    const unknownKey = computeVerificationIdempotencyKey("finding-1", "T0", "unknown");
    expect(nullKey).not.toBe(unknownKey);
  });

  it("evidence hash dedup: identical evidence produces identical hash", () => {
    const hash1 = computeEvidenceHash({ source: "HTML", url: "https://example.com", observedValue: { status: 200 } });
    const hash2 = computeEvidenceHash({ source: "HTML", url: "https://example.com", observedValue: { status: 200 } });
    expect(hash1).toBe(hash2);
  });

  it("evidence hash: different observed values produce different hashes", () => {
    const hash1 = computeEvidenceHash({ source: "HTML", url: "https://example.com", observedValue: { status: 200 } });
    const hash2 = computeEvidenceHash({ source: "HTML", url: "https://example.com", observedValue: { status: 404 } });
    expect(hash1).not.toBe(hash2);
  });

  it("evidence hash: same observation from different sources produce different hashes", () => {
    const hash1 = computeEvidenceHash({ source: "HTML", url: "https://example.com", observedValue: { x: 1 } });
    const hash2 = computeEvidenceHash({ source: "GSC", url: "https://example.com", observedValue: { x: 1 } });
    expect(hash1).not.toBe(hash2);
  });
});

describe("Audit: Re-audit resolution and regression", () => {
  it("OPEN finding can be resolved by re-audit", () => {
    expect(isValidLifecycleTransition("OPEN", "RESOLVED")).toBe(true);
  });

  it("IN_PROGRESS finding can be resolved by re-audit", () => {
    expect(isValidLifecycleTransition("IN_PROGRESS", "RESOLVED")).toBe(true);
  });

  it("RESOLVED finding can regress when re-audit finds issue again", () => {
    expect(isValidLifecycleTransition("RESOLVED", "REGRESSED")).toBe(true);
  });

  it("IN_PROGRESS finding can regress", () => {
    expect(isValidLifecycleTransition("IN_PROGRESS", "REGRESSED")).toBe(true);
  });

  it("REGRESSED finding can be resolved again", () => {
    expect(isValidLifecycleTransition("REGRESSED", "RESOLVED")).toBe(true);
  });

  it("already-RESOLVED finding cannot be re-resolved (same state transition rejected)", () => {
    expect(isValidLifecycleTransition("RESOLVED", "RESOLVED")).toBe(false);
  });

  it("REGRESSED finding can move to IN_PROGRESS (new fix attempt)", () => {
    expect(isValidLifecycleTransition("REGRESSED", "IN_PROGRESS")).toBe(true);
  });

  it("full lifecycle cycle is valid: OPEN -> IN_PROGRESS -> RESOLVED -> REGRESSED -> IN_PROGRESS -> RESOLVED", () => {
    const transitions: [string, string][] = [
      ["OPEN", "IN_PROGRESS"],
      ["IN_PROGRESS", "RESOLVED"],
      ["RESOLVED", "REGRESSED"],
      ["REGRESSED", "IN_PROGRESS"],
      ["IN_PROGRESS", "RESOLVED"],
    ];
    for (const [from, to] of transitions) {
      expect(isValidLifecycleTransition(from as any, to as any)).toBe(true);
    }
  });
});

describe("Audit: Legacy rows without diagnostic finding provenance", () => {
  it("fingerprint computation is deterministic for same inputs", () => {
    const fp1 = computeFindingFingerprint("site-1", "missing_canonical", "https://example.com/page", "canonical_missing");
    const fp2 = computeFindingFingerprint("site-1", "missing_canonical", "https://example.com/page", "canonical_missing");
    expect(fp1).toBe(fp2);
  });

  it("fingerprint differs by site", () => {
    const fp1 = computeFindingFingerprint("site-a", "missing_canonical", "https://example.com", "canonical_missing");
    const fp2 = computeFindingFingerprint("site-b", "missing_canonical", "https://example.com", "canonical_missing");
    expect(fp1).not.toBe(fp2);
  });

  it("fingerprint differs by issue type", () => {
    const fp1 = computeFindingFingerprint("site-1", "missing_canonical", "https://example.com", "canonical_missing");
    const fp2 = computeFindingFingerprint("site-1", "robots_blocked", "https://example.com", "robots_disallow");
    expect(fp1).not.toBe(fp2);
  });

  it("fingerprint returns 20-char hex string", () => {
    const fp = computeFindingFingerprint("site-1", "issue", "url", "cause");
    expect(fp).toMatch(/^[a-f0-9]{20}$/);
  });

  it("verification key with unknown revision is still deterministic", () => {
    const k1 = computeVerificationIdempotencyKey("old-finding-no-revision", "T0", "unknown");
    const k2 = computeVerificationIdempotencyKey("old-finding-no-revision", "T0", "unknown");
    expect(k1).toBe(k2);
  });
});

describe("Audit: Worker retries and duplicate events", () => {
  it("same event data produces same idempotency key — second worker run will hit dedup", () => {
    const eventData = { findingDbId: "finding-123", window: "T0", revision: "sha-abc" };
    const key1 = computeVerificationIdempotencyKey(eventData.findingDbId, eventData.window, eventData.revision);
    const key2 = computeVerificationIdempotencyKey(eventData.findingDbId, eventData.window, eventData.revision);
    expect(key1).toBe(key2);
  });

  it("deployment idempotency key is deterministic for retry scenarios", () => {
    const key1 = computeDeploymentIdempotencyKey("site-1", "finding-1", "sha-xyz");
    const key2 = computeDeploymentIdempotencyKey("site-1", "finding-1", "sha-xyz");
    expect(key1).toBe(key2);
  });

  it("different T0 runs for different revisions produce different evidence records (not deduped)", () => {
    const key1 = computeVerificationIdempotencyKey("finding-1", "T0", "deploy-v1");
    const key2 = computeVerificationIdempotencyKey("finding-1", "T0", "deploy-v2");
    expect(key1).not.toBe(key2);
  });
});
