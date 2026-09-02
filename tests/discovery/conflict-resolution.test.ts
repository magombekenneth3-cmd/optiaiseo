/**
 * Phase D.1 — Conflict Resolution Tests
 */

import { describe, it, expect } from "vitest";
import {
  resolveConflict,
  resolveAllConflicts,
  CATEGORY_PRIORITY,
  CATEGORY_TO_ACTION,
} from "@/lib/discovery/conflict-resolution";
import type { RawDiscoverySignal } from "@/lib/discovery/types";
import { createHash } from "node:crypto";

// ── Helpers ─────────────────────────────────────────────────────────────────

const FP = createHash("sha256").update("test:fingerprint").digest("hex");

function makeSignal(overrides?: Partial<RawDiscoverySignal>): RawDiscoverySignal {
  return {
    siteId: "site_1",
    source: "GSC",
    sourceRunId: "run_1",
    fingerprint: FP,
    category: "QUICK_WIN",
    suggestedAction: "OPTIMIZE_TITLE",
    resourceType: "PAGE",
    resourceId: "/blog/test",
    confidence: 0.7,
    evidence: [{
      sourceType: "GSC",
      metric: "position",
      value: "8.5",
      observedAt: new Date(),
    }],
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("§1 Category Priority", () => {
  it("DECLINING has highest priority", () => {
    expect(CATEGORY_PRIORITY[0]).toBe("DECLINING");
  });

  it("DEAD_WEIGHT has lowest priority", () => {
    expect(CATEGORY_PRIORITY[CATEGORY_PRIORITY.length - 1]).toBe("DEAD_WEIGHT");
  });

  it("all known categories are in priority list", () => {
    const known = ["DECLINING", "CANNIBALIZATION", "QUICK_WIN", "ALMOST_RANKING", "ORPHANED", "STALE", "DEAD_WEIGHT"];
    for (const cat of known) {
      expect(CATEGORY_PRIORITY).toContain(cat);
    }
  });
});

describe("§2 CATEGORY_TO_ACTION Mapping", () => {
  it("every category maps to exactly one action", () => {
    for (const cat of CATEGORY_PRIORITY) {
      expect(CATEGORY_TO_ACTION[cat]).toBeDefined();
      expect(typeof CATEGORY_TO_ACTION[cat]).toBe("string");
    }
  });

  it("DECLINING maps to REFRESH_CONTENT", () => {
    expect(CATEGORY_TO_ACTION["DECLINING"]).toBe("REFRESH_CONTENT");
  });

  it("CANNIBALIZATION maps to CONSOLIDATE_CONTENT", () => {
    expect(CATEGORY_TO_ACTION["CANNIBALIZATION"]).toBe("CONSOLIDATE_CONTENT");
  });
});

describe("§3 Single-Signal Resolution", () => {
  it("returns the signal unchanged when only one", () => {
    const signal = makeSignal({ confidence: 0.85 });
    const resolved = resolveConflict([signal]);

    expect(resolved.category).toBe("QUICK_WIN");
    expect(resolved.action).toBe("OPTIMIZE_TITLE");
    expect(resolved.confidence).toBe(0.85);
    expect(resolved.contributingSources).toEqual(["GSC"]);
    expect(resolved.mergedEvidence.length).toBe(1);
  });
});

describe("§4 Multi-Source Conflict Resolution", () => {
  it("selects higher-priority category, not highest-confidence source", () => {
    // GSC: QUICK_WIN, confidence=0.91
    // AUDIT: DECLINING, confidence=0.72
    // DECLINING has higher priority than QUICK_WIN → should win
    const gscSignal = makeSignal({
      source: "GSC",
      sourceRunId: "gsc_run",
      category: "QUICK_WIN",
      suggestedAction: "OPTIMIZE_TITLE",
      confidence: 0.91,
    });

    const auditSignal = makeSignal({
      source: "AUDIT",
      sourceRunId: "audit_run",
      category: "DECLINING",
      suggestedAction: "REFRESH_CONTENT",
      confidence: 0.72,
      evidence: [{
        sourceType: "AUDIT",
        metric: "positionDrop",
        value: "3.5",
        observedAt: new Date(),
      }],
    });

    const resolved = resolveConflict([gscSignal, auditSignal]);

    // Category = DECLINING (higher priority, even though lower confidence)
    expect(resolved.category).toBe("DECLINING");
    expect(resolved.action).toBe("REFRESH_CONTENT");

    // Confidence = max across sources = 0.91
    expect(resolved.confidence).toBe(0.91);

    // Both sources retained
    expect(resolved.contributingSources.sort()).toEqual(["AUDIT", "GSC"]);
    expect(resolved.sourceRunIds.sort()).toEqual(["audit_run", "gsc_run"]);

    // Evidence merged
    expect(resolved.mergedEvidence.length).toBe(2);
  });

  it("merges metadata from all sources", () => {
    const s1 = makeSignal({ metadata: { impressions: 500 } });
    const s2 = makeSignal({
      source: "AUDIT",
      sourceRunId: "run_2",
      metadata: { findingType: "LOW_CTR" },
    });

    const resolved = resolveConflict([s1, s2]);
    expect(resolved.metadata).toBeDefined();
    expect(resolved.metadata?.impressions).toBe(500);
    expect(resolved.metadata?.findingType).toBe("LOW_CTR");
  });
});

describe("§5 resolveAllConflicts", () => {
  it("groups by fingerprint and resolves each group", () => {
    const fp2 = createHash("sha256").update("different").digest("hex");

    const signals = [
      makeSignal({ fingerprint: FP, source: "GSC" }),
      makeSignal({ fingerprint: FP, source: "AUDIT", sourceRunId: "run_2" }),
      makeSignal({ fingerprint: fp2, source: "CONTENT", sourceRunId: "run_3" }),
    ];

    const resolved = resolveAllConflicts(signals);
    expect(resolved.length).toBe(2);

    const fpGroup = resolved.find((r) => r.fingerprint === FP);
    expect(fpGroup?.contributingSources.length).toBe(2);

    const fp2Group = resolved.find((r) => r.fingerprint === fp2);
    expect(fp2Group?.contributingSources.length).toBe(1);
  });
});

describe("§6 Determinism", () => {
  it("produces the same result regardless of signal order", () => {
    const gsc = makeSignal({ source: "GSC", confidence: 0.91, category: "QUICK_WIN" });
    const audit = makeSignal({ source: "AUDIT", sourceRunId: "r2", confidence: 0.72, category: "DECLINING" });

    const result1 = resolveConflict([gsc, audit]);
    const result2 = resolveConflict([audit, gsc]);

    expect(result1.category).toBe(result2.category);
    expect(result1.action).toBe(result2.action);
    expect(result1.confidence).toBe(result2.confidence);
  });

  it("throws on empty signal group", () => {
    expect(() => resolveConflict([])).toThrow("Cannot resolve empty signal group");
  });
});
