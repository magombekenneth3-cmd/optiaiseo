/**
 * Phase D.1 — Freshness Policy Tests
 */

import { describe, it, expect } from "vitest";
import {
  FRESHNESS_POLICIES,
  getMaxEvidenceAge,
  isEvidenceFresh,
  computeAggregateExpiry,
  shouldRefreshSource,
  getSourceExpiry,
  wouldCreateExpiredCandidate,
} from "@/lib/discovery/freshness";
import type { DiscoveryEvidence } from "@/lib/discovery/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function makeEvidence(daysAgo: number): DiscoveryEvidence {
  return {
    sourceType: "GSC",
    metric: "position",
    value: "5",
    observedAt: new Date(Date.now() - daysAgo * MS_PER_DAY),
  };
}

describe("§1 Source-Specific Evidence Age", () => {
  it("GSC max evidence age is 14 days", () => {
    expect(getMaxEvidenceAge("GSC")).toBe(14);
  });

  it("CRAWL max evidence age is 30 days", () => {
    expect(getMaxEvidenceAge("CRAWL")).toBe(30);
  });

  it("COMPETITOR max evidence age is 7 days", () => {
    expect(getMaxEvidenceAge("COMPETITOR")).toBe(7);
  });

  it("CONTENT max evidence age is 30 days", () => {
    expect(getMaxEvidenceAge("CONTENT")).toBe(30);
  });

  it("PERFORMANCE max evidence age is 7 days", () => {
    expect(getMaxEvidenceAge("PERFORMANCE")).toBe(7);
  });
});

describe("§2 Evidence Freshness", () => {
  it("fresh evidence for GSC (within 14 days)", () => {
    expect(isEvidenceFresh(makeEvidence(10), "GSC")).toBe(true);
  });

  it("stale evidence for GSC (beyond 14 days)", () => {
    expect(isEvidenceFresh(makeEvidence(15), "GSC")).toBe(false);
  });

  it("fresh evidence for CONTENT (within 30 days)", () => {
    expect(isEvidenceFresh(makeEvidence(20), "CONTENT")).toBe(true);
  });

  it("stale evidence for CONTENT (beyond 30 days)", () => {
    expect(isEvidenceFresh(makeEvidence(35), "CONTENT")).toBe(false);
  });

  it("stale evidence for COMPETITOR (beyond 7 days)", () => {
    expect(isEvidenceFresh(makeEvidence(8), "COMPETITOR")).toBe(false);
  });

  it("boundary: exactly at max age is still fresh", () => {
    const now = new Date();
    const exactly14Days = new Date(now.getTime() - 14 * MS_PER_DAY);
    const evidence: DiscoveryEvidence = {
      sourceType: "GSC",
      metric: "position",
      value: "5",
      observedAt: exactly14Days,
    };
    expect(isEvidenceFresh(evidence, "GSC", now)).toBe(true);
  });
});

describe("§3 Aggregate Expiry", () => {
  it("returns earliest expiry across multiple sources", () => {
    const now = new Date();
    const sources = [
      { source: "GSC" as const, observedAt: now },       // expires in 14d
      { source: "CONTENT" as const, observedAt: now },    // expires in 30d
      { source: "COMPETITOR" as const, observedAt: now },  // expires in 7d ← earliest
    ];

    const expiry = computeAggregateExpiry(sources);
    const daysUntilExpiry = (expiry.getTime() - now.getTime()) / MS_PER_DAY;
    expect(daysUntilExpiry).toBeCloseTo(7, 0);
  });

  it("returns current time for empty sources", () => {
    const before = Date.now();
    const expiry = computeAggregateExpiry([]);
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before - 100);
    expect(expiry.getTime()).toBeLessThanOrEqual(Date.now() + 100);
  });

  it("handles single source correctly", () => {
    const observedAt = new Date();
    const expiry = computeAggregateExpiry([{ source: "GSC", observedAt }]);
    const expectedExpiry = observedAt.getTime() + 14 * MS_PER_DAY;
    expect(expiry.getTime()).toBe(expectedExpiry);
  });
});

describe("§4 Refresh Checks", () => {
  it("needs refresh when never refreshed", () => {
    expect(shouldRefreshSource("GSC", null)).toBe(true);
    expect(shouldRefreshSource("GSC", undefined)).toBe(true);
  });

  it("needs refresh when interval has elapsed", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * MS_PER_DAY);
    // GSC refresh interval = 7 days
    expect(shouldRefreshSource("GSC", eightDaysAgo)).toBe(true);
  });

  it("does NOT need refresh when interval has not elapsed", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * MS_PER_DAY);
    // GSC refresh interval = 7 days
    expect(shouldRefreshSource("GSC", twoDaysAgo)).toBe(false);
  });

  it("COMPETITOR refresh interval is 3 days", () => {
    const fourDaysAgo = new Date(Date.now() - 4 * MS_PER_DAY);
    expect(shouldRefreshSource("COMPETITOR", fourDaysAgo)).toBe(true);

    const twoDaysAgo = new Date(Date.now() - 2 * MS_PER_DAY);
    expect(shouldRefreshSource("COMPETITOR", twoDaysAgo)).toBe(false);
  });
});

describe("§5 Source Expiry", () => {
  it("computes correct GSC expiry (14 days)", () => {
    const observedAt = new Date("2024-01-01");
    const expiry = getSourceExpiry("GSC", observedAt);
    expect(expiry.getTime()).toBe(observedAt.getTime() + 14 * MS_PER_DAY);
  });

  it("computes correct CRAWL expiry (30 days)", () => {
    const observedAt = new Date("2024-01-01");
    const expiry = getSourceExpiry("CRAWL", observedAt);
    expect(expiry.getTime()).toBe(observedAt.getTime() + 30 * MS_PER_DAY);
  });
});

describe("§6 Policy Completeness", () => {
  it("has policies for all sources", () => {
    const sources = ["GSC", "CRAWL", "AUDIT", "COMPETITOR", "CONTENT", "PERFORMANCE"];
    for (const source of sources) {
      const policy = FRESHNESS_POLICIES[source as keyof typeof FRESHNESS_POLICIES];
      expect(policy).toBeDefined();
      expect(policy.ttlDays).toBeGreaterThan(0);
      expect(policy.maxEvidenceAgeDays).toBeGreaterThan(0);
      expect(policy.refreshIntervalDays).toBeGreaterThan(0);
    }
  });

  it("refresh interval <= TTL for all sources", () => {
    for (const [source, policy] of Object.entries(FRESHNESS_POLICIES)) {
      expect(policy.refreshIntervalDays).toBeLessThanOrEqual(policy.ttlDays);
    }
  });

  it("maxEvidenceAgeDays <= ttlDays for all sources", () => {
    for (const [source, policy] of Object.entries(FRESHNESS_POLICIES)) {
      expect(policy.maxEvidenceAgeDays).toBeLessThanOrEqual(policy.ttlDays);
    }
  });
});

describe("§7 Expired-on-Creation Guard", () => {
  it("returns true when all evidence would create an expired candidate", () => {
    // Evidence from 20 days ago + GSC TTL of 14 days = expired 6 days ago
    const evidence = [makeEvidence(20)];
    expect(wouldCreateExpiredCandidate(evidence, "GSC")).toBe(true);
  });

  it("returns false when evidence produces a valid candidate", () => {
    // Evidence from 5 days ago + GSC TTL of 14 days = expires in 9 days
    const evidence = [makeEvidence(5)];
    expect(wouldCreateExpiredCandidate(evidence, "GSC")).toBe(false);
  });

  it("returns false if ANY evidence is valid (mixed ages)", () => {
    const evidence = [
      makeEvidence(20), // Would expire (20 > 14 TTL for GSC)
      makeEvidence(5),  // Would NOT expire (5 < 14 TTL for GSC)
    ];
    expect(wouldCreateExpiredCandidate(evidence, "GSC")).toBe(false);
  });

  it("returns true for empty evidence array", () => {
    expect(wouldCreateExpiredCandidate([], "GSC")).toBe(true);
  });

  it("CONTENT evidence from 25 days ago does NOT expire (TTL=30)", () => {
    const evidence = [makeEvidence(25)];
    expect(wouldCreateExpiredCandidate(evidence, "CONTENT")).toBe(false);
  });

  it("CONTENT evidence from 35 days ago DOES expire (TTL=30)", () => {
    const evidence = [makeEvidence(35)];
    expect(wouldCreateExpiredCandidate(evidence, "CONTENT")).toBe(true);
  });
});
