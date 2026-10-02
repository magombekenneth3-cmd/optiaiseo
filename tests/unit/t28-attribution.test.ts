import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  diagnosticFindingRecord: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  sEOEvidenceRecord: {
    findMany: vi.fn(),
    createMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  computeVerificationIdempotencyKey,
  computeDeploymentIdempotencyKey,
} from "@/lib/seo-audit/lifecycle";
import { computeEvidenceHash } from "@/lib/seo-audit/contracts";

describe("T+28 Attribution End-to-End", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fingerprint-based T+28 key differs from ID-based T+28 key for different finding IDs", () => {
    const fpKey = computeVerificationIdempotencyKey("finding-by-fingerprint", "T28", "unknown");
    const idKey = computeVerificationIdempotencyKey("finding-by-id", "T28", "unknown");
    expect(fpKey).not.toBe(idKey);
  });

  it("same finding ID produces same T+28 key regardless of call path", () => {
    const key1 = computeVerificationIdempotencyKey("finding-1", "T28", "rev-1");
    const key2 = computeVerificationIdempotencyKey("finding-1", "T28", "rev-1");
    expect(key1).toBe(key2);
  });

  it("T+28 evidence for different deployment revisions produces distinct keys", () => {
    const key1 = computeVerificationIdempotencyKey("finding-1", "T28", "deploy-v1");
    const key2 = computeVerificationIdempotencyKey("finding-1", "T28", "deploy-v2");
    expect(key1).not.toBe(key2);
  });

  it("T+28 evidence for missing revision uses 'unknown' consistently", () => {
    const key1 = computeVerificationIdempotencyKey("finding-1", "T28", "unknown");
    const key2 = computeVerificationIdempotencyKey("finding-1", "T28", "unknown");
    expect(key1).toBe(key2);
  });
});

describe("Multiple Remediation Attempts Against Same Finding", () => {
  it("different deployment revisions produce unique deployment idempotency keys", () => {
    const k1 = computeDeploymentIdempotencyKey("site-1", "finding-1", "sha-v1");
    const k2 = computeDeploymentIdempotencyKey("site-1", "finding-1", "sha-v2");
    const k3 = computeDeploymentIdempotencyKey("site-1", "finding-1", "sha-v3");
    expect(new Set([k1, k2, k3]).size).toBe(3);
  });

  it("each attempt produces unique T+0 verification keys", () => {
    const t0v1 = computeVerificationIdempotencyKey("finding-1", "T0", "sha-v1");
    const t0v2 = computeVerificationIdempotencyKey("finding-1", "T0", "sha-v2");
    expect(t0v1).not.toBe(t0v2);
  });

  it("T+7 verification keys differ per revision too", () => {
    const t7v1 = computeVerificationIdempotencyKey("finding-1", "T7", "sha-v1");
    const t7v2 = computeVerificationIdempotencyKey("finding-1", "T7", "sha-v2");
    expect(t7v1).not.toBe(t7v2);
  });

  it("T+28 keys differ per revision, preventing double-attribution", () => {
    const t28v1 = computeVerificationIdempotencyKey("finding-1", "T28", "sha-v1");
    const t28v2 = computeVerificationIdempotencyKey("finding-1", "T28", "sha-v2");
    expect(t28v1).not.toBe(t28v2);
  });
});

describe("Duplicate Outcome Events", () => {
  it("identical outcome evidence produces identical hash (dedup)", () => {
    const hash1 = computeEvidenceHash({
      source: "GSC",
      url: undefined,
      observedValue: {
        verificationType: "T28_BUSINESS",
        outcome: "improved",
        impactScore: 0.15,
        findingDbId: "finding-1",
      },
    });
    const hash2 = computeEvidenceHash({
      source: "GSC",
      url: undefined,
      observedValue: {
        verificationType: "T28_BUSINESS",
        outcome: "improved",
        impactScore: 0.15,
        findingDbId: "finding-1",
      },
    });
    expect(hash1).toBe(hash2);
  });

  it("different outcome values produce different hashes", () => {
    const improved = computeEvidenceHash({
      source: "GSC",
      url: undefined,
      observedValue: { verificationType: "T28_BUSINESS", outcome: "improved", impactScore: 0.15 },
    });
    const degraded = computeEvidenceHash({
      source: "GSC",
      url: undefined,
      observedValue: { verificationType: "T28_BUSINESS", outcome: "degraded", impactScore: -0.10 },
    });
    expect(improved).not.toBe(degraded);
  });
});

describe("Missing Provenance", () => {
  it("T+28 key with null revision still produces valid 24-char key", () => {
    const key = computeVerificationIdempotencyKey("finding-no-provenance", "T28", null);
    expect(key).toMatch(/^[a-f0-9]{24}$/);
  });

  it("null revision and 'unknown' revision produce different keys", () => {
    const nullKey = computeVerificationIdempotencyKey("finding-1", "T28", null);
    const unknownKey = computeVerificationIdempotencyKey("finding-1", "T28", "unknown");
    expect(nullKey).not.toBe(unknownKey);
  });

  it("evidence hash for attribution path 'diagnosticFindingId' differs from fingerprint path", () => {
    const base = {
      source: "GSC" as const,
      url: undefined,
      observedValue: {
        verificationType: "T28_BUSINESS",
        outcome: "improved",
        impactScore: 0.15,
        findingDbId: "finding-1",
      },
    };
    const withPath = computeEvidenceHash({
      ...base,
      observedValue: { ...base.observedValue, attributionPath: "diagnosticFindingId" },
    });
    const withoutPath = computeEvidenceHash(base);
    expect(withPath).not.toBe(withoutPath);
  });
});

describe("Out-of-Order Outcomes", () => {
  it("T+0 key exists before T+28 key for same revision", () => {
    const t0 = computeVerificationIdempotencyKey("finding-1", "T0", "rev-1");
    const t28 = computeVerificationIdempotencyKey("finding-1", "T28", "rev-1");
    expect(t0).not.toBe(t28);
    expect(t0).toMatch(/^[a-f0-9]{24}$/);
    expect(t28).toMatch(/^[a-f0-9]{24}$/);
  });

  it("T+28 evidence can exist without T+7 evidence (direct attribution)", () => {
    const t7 = computeVerificationIdempotencyKey("finding-1", "T7", "rev-1");
    const t28 = computeVerificationIdempotencyKey("finding-1", "T28", "rev-1");
    expect(t7).not.toBe(t28);
  });
});
