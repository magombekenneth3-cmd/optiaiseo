/**
 * Phase D.1 — Validator Tests
 */

import { describe, it, expect } from "vitest";
import { validateSignal, filterValidSignals, MIN_DISCOVERY_CONFIDENCE } from "@/lib/discovery/validators";
import type { RawDiscoverySignal, DiscoveryEvidence } from "@/lib/discovery/types";
import { createHash } from "node:crypto";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeFingerprint(): string {
  return createHash("sha256").update(`test:${Math.random()}`).digest("hex");
}

function makeEvidence(overrides?: Partial<DiscoveryEvidence>): DiscoveryEvidence {
  return {
    sourceType: "GSC",
    metric: "position",
    value: "5.2",
    observedAt: new Date(),
    ...overrides,
  };
}

function makeSignal(overrides?: Partial<RawDiscoverySignal>): RawDiscoverySignal {
  return {
    siteId: "site_1",
    source: "GSC",
    sourceRunId: "run_1",
    fingerprint: makeFingerprint(),
    category: "QUICK_WIN",
    suggestedAction: "OPTIMIZE_TITLE",
    resourceType: "PAGE",
    resourceId: "/blog/test",
    confidence: 0.8,
    evidence: [makeEvidence()],
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("§1 Signal Validation", () => {
  it("accepts a valid signal", () => {
    const result = validateSignal(makeSignal());
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("rejects confidence below MIN_DISCOVERY_CONFIDENCE", () => {
    const result = validateSignal(makeSignal({ confidence: 0.1 }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("below minimum");
  });

  it("rejects confidence above 1.0", () => {
    const result = validateSignal(makeSignal({ confidence: 1.5 }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("must be 0.0–1.0");
  });

  it("rejects negative confidence", () => {
    const result = validateSignal(makeSignal({ confidence: -0.1 }));
    expect(result.valid).toBe(false);
  });

  it("accepts confidence exactly at minimum", () => {
    const result = validateSignal(makeSignal({ confidence: MIN_DISCOVERY_CONFIDENCE }));
    expect(result.valid).toBe(true);
  });

  it("rejects signal with no evidence", () => {
    const result = validateSignal(makeSignal({ evidence: [] }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("No evidence items");
  });

  it("rejects signal with all stale evidence (source-specific age)", () => {
    const staleDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
    // GSC max evidence age = 14 days
    const result = validateSignal(makeSignal({
      source: "GSC",
      evidence: [makeEvidence({ observedAt: staleDate })],
    }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("stale");
  });

  it("accepts signal with fresh evidence for CONTENT source (30-day max)", () => {
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    // CONTENT maxEvidenceAgeDays = 30
    const result = validateSignal(makeSignal({
      source: "CONTENT",
      evidence: [makeEvidence({ observedAt: twentyDaysAgo })],
    }));
    expect(result.valid).toBe(true);
  });

  it("rejects empty resourceId", () => {
    const result = validateSignal(makeSignal({ resourceId: "" }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Empty resourceId");
  });

  it("rejects whitespace-only resourceId", () => {
    const result = validateSignal(makeSignal({ resourceId: "   " }));
    expect(result.valid).toBe(false);
  });

  it("rejects unknown category", () => {
    const result = validateSignal(makeSignal({ category: "UNKNOWN_CAT" as any }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Unknown category");
  });

  it("rejects unknown action", () => {
    const result = validateSignal(makeSignal({ suggestedAction: "NUKE_SITE" as any }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Unknown action");
  });

  it("rejects unknown resourceType", () => {
    const result = validateSignal(makeSignal({ resourceType: "VIDEO" as any }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Unknown resourceType");
  });

  it("rejects malformed fingerprint", () => {
    const result = validateSignal(makeSignal({ fingerprint: "not-a-sha256" }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Malformed fingerprint");
  });

  it("rejects empty sourceRunId", () => {
    const result = validateSignal(makeSignal({ sourceRunId: "" }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Empty sourceRunId");
  });
});

describe("§2 Batch Validation", () => {
  it("splits signals into valid and rejected", () => {
    const signals = [
      makeSignal(),
      makeSignal({ confidence: 0.1 }), // below min
      makeSignal(),
      makeSignal({ evidence: [] }),     // no evidence
    ];

    const { valid, rejected } = filterValidSignals(signals);
    expect(valid.length).toBe(2);
    expect(rejected.length).toBe(2);
    expect(rejected[0].reason).toContain("below minimum");
    expect(rejected[1].reason).toBe("No evidence items");
  });

  it("returns all valid when all pass", () => {
    const signals = [makeSignal(), makeSignal(), makeSignal()];
    const { valid, rejected } = filterValidSignals(signals);
    expect(valid.length).toBe(3);
    expect(rejected.length).toBe(0);
  });
});
