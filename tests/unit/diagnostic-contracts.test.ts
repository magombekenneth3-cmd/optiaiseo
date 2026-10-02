import { describe, it, expect } from "vitest";
import {
  computeFindingFingerprint,
  computeEvidenceHash,
  createEvidence,
  createUnavailableEvidence,
  aggregateEvidenceConfidence,
  CONFIDENCE_BY_KIND,
} from "@/lib/seo-audit/contracts";
import type {
  SEOEvidence,
  EvidenceConfidenceKind,
  DiagnosticStatus,
  FindingSeverity,
} from "@/lib/seo-audit/contracts";

describe("computeFindingFingerprint", () => {
  it("produces a deterministic 20-char hex string", () => {
    const fp = computeFindingFingerprint("site-1", "CANONICAL_ISSUES", "https://example.com/", "canonical_missing");
    expect(fp).toHaveLength(20);
    expect(/^[0-9a-f]{20}$/.test(fp)).toBe(true);
  });

  it("is stable across identical inputs", () => {
    const a = computeFindingFingerprint("s", "type", "url", "cause");
    const b = computeFindingFingerprint("s", "type", "url", "cause");
    expect(a).toBe(b);
  });

  it("differs when any parameter changes", () => {
    const base = computeFindingFingerprint("s", "t", "u", "c");
    expect(computeFindingFingerprint("X", "t", "u", "c")).not.toBe(base);
    expect(computeFindingFingerprint("s", "X", "u", "c")).not.toBe(base);
    expect(computeFindingFingerprint("s", "t", "X", "c")).not.toBe(base);
    expect(computeFindingFingerprint("s", "t", "u", "X")).not.toBe(base);
  });

  it("normalises rootCauseId to lowercase and trims whitespace", () => {
    const a = computeFindingFingerprint("s", "t", "u", "Canonical_Missing");
    const b = computeFindingFingerprint("s", "t", "u", "  canonical_missing  ");
    expect(a).toBe(b);
  });
});

describe("computeEvidenceHash", () => {
  it("produces a 16-char hex string", () => {
    const hash = computeEvidenceHash({
      source: "HTML",
      url: "https://example.com/",
      observedValue: { metaRobots: "noindex" },
    });
    expect(hash).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(hash)).toBe(true);
  });

  it("is deterministic", () => {
    const params = { source: "HTML" as const, url: "u", observedValue: { a: 1 } };
    expect(computeEvidenceHash(params)).toBe(computeEvidenceHash(params));
  });

  it("changes when observed value changes", () => {
    const a = computeEvidenceHash({ source: "HTML", url: "u", observedValue: { a: 1 } });
    const b = computeEvidenceHash({ source: "HTML", url: "u", observedValue: { a: 2 } });
    expect(a).not.toBe(b);
  });
});

describe("createEvidence", () => {
  it("auto-computes evidenceHash", () => {
    const ev = createEvidence({
      source: "HTML",
      url: "https://example.com",
      observedAt: "2024-01-01T00:00:00Z",
      observedValue: { test: true },
      confidence: 0.9,
      confidenceKind: "DIRECTLY_OBSERVED",
    });
    expect(ev.evidenceHash).toBeDefined();
    expect(ev.evidenceHash).toHaveLength(16);
  });

  it("clamps confidence to [0, 1]", () => {
    const ev1 = createEvidence({
      source: "HTML",
      url: "u",
      observedAt: "2024-01-01T00:00:00Z",
      observedValue: {},
      confidence: 1.5,
      confidenceKind: "DIRECTLY_OBSERVED",
    });
    expect(ev1.confidence).toBe(1);

    const ev2 = createEvidence({
      source: "HTML",
      url: "u",
      observedAt: "2024-01-01T00:00:00Z",
      observedValue: {},
      confidence: -0.5,
      confidenceKind: "DIRECTLY_OBSERVED",
    });
    expect(ev2.confidence).toBe(0);
  });
});

describe("createUnavailableEvidence", () => {
  it("creates evidence with zero confidence and UNAVAILABLE kind", () => {
    const ev = createUnavailableEvidence("GSC", "https://example.com", "not connected");
    expect(ev.confidence).toBe(0);
    expect(ev.confidenceKind).toBe("UNAVAILABLE");
    expect((ev.observedValue as any).unavailable).toBe(true);
    expect((ev.observedValue as any).reason).toBe("not connected");
  });
});

describe("CONFIDENCE_BY_KIND", () => {
  it("has all four kinds with correct ordering", () => {
    expect(CONFIDENCE_BY_KIND.DIRECTLY_OBSERVED).toBeGreaterThan(CONFIDENCE_BY_KIND.DERIVED);
    expect(CONFIDENCE_BY_KIND.DERIVED).toBeGreaterThan(CONFIDENCE_BY_KIND.INFERRED);
    expect(CONFIDENCE_BY_KIND.INFERRED).toBeGreaterThan(CONFIDENCE_BY_KIND.UNAVAILABLE);
    expect(CONFIDENCE_BY_KIND.UNAVAILABLE).toBe(0);
  });
});

describe("aggregateEvidenceConfidence", () => {
  it("returns 0 for empty evidence", () => {
    expect(aggregateEvidenceConfidence([])).toBe(0);
  });

  it("returns high confidence for multiple DIRECTLY_OBSERVED from different sources", () => {
    const evidence: SEOEvidence[] = [
      createEvidence({
        source: "HTML",
        url: "u",
        observedAt: "2024-01-01",
        observedValue: {},
        confidence: 1.0,
        confidenceKind: "DIRECTLY_OBSERVED",
      }),
      createEvidence({
        source: "HTTP_HEADERS",
        url: "u",
        observedAt: "2024-01-01",
        observedValue: {},
        confidence: 1.0,
        confidenceKind: "DIRECTLY_OBSERVED",
      }),
      createEvidence({
        source: "ROBOTS",
        url: "u",
        observedAt: "2024-01-01",
        observedValue: {},
        confidence: 1.0,
        confidenceKind: "DIRECTLY_OBSERVED",
      }),
    ];
    const result = aggregateEvidenceConfidence(evidence);
    expect(result).toBeGreaterThan(0.9);
    expect(result).toBeLessThanOrEqual(1.0);
  });

  it("returns lower confidence for INFERRED evidence", () => {
    const evidence: SEOEvidence[] = [
      createEvidence({
        source: "HTML",
        url: "u",
        observedAt: "2024-01-01",
        observedValue: {},
        confidence: 0.5,
        confidenceKind: "INFERRED",
      }),
    ];
    const result = aggregateEvidenceConfidence(evidence);
    expect(result).toBeLessThan(0.7);
  });

  it("corroborating sources increase the aggregate", () => {
    const singleSource: SEOEvidence[] = [
      createEvidence({
        source: "HTML",
        url: "u",
        observedAt: "2024-01-01",
        observedValue: { a: 1 },
        confidence: 0.8,
        confidenceKind: "DERIVED",
      }),
    ];
    const multiSource: SEOEvidence[] = [
      createEvidence({
        source: "HTML",
        url: "u",
        observedAt: "2024-01-01",
        observedValue: { a: 1 },
        confidence: 0.8,
        confidenceKind: "DERIVED",
      }),
      createEvidence({
        source: "HTTP_HEADERS",
        url: "u",
        observedAt: "2024-01-01",
        observedValue: { a: 2 },
        confidence: 0.8,
        confidenceKind: "DERIVED",
      }),
    ];
    const single = aggregateEvidenceConfidence(singleSource);
    const multi = aggregateEvidenceConfidence(multiSource);
    expect(multi).toBeGreaterThan(single);
  });
});
