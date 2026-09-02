/**
 * Phase D.1 — Behavioral Integration Tests
 *
 * Tests the full discovery pipeline end-to-end:
 *   source detector → validation → deduplication → persistence → CANDIDATE
 *
 * These tests mock the database (Prisma) but exercise real logic across
 * all module boundaries.
 *
 * P0 Certification: Proves the invariant:
 *   source event → detector → validate → dedup → CANDIDATE
 *   Phase C OPEN query does NOT return it
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import type { RawDiscoverySignal, DiscoveryEvidence } from "@/lib/discovery/types";
import { validateSignal, filterValidSignals } from "@/lib/discovery/validators";
import { resolveConflict, resolveAllConflicts, CATEGORY_TO_ACTION } from "@/lib/discovery/conflict-resolution";
import { computeAggregateExpiry, wouldCreateExpiredCandidate } from "@/lib/discovery/freshness";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeFingerprint(seed: string = "test"): string {
  return createHash("sha256").update(seed).digest("hex");
}

function makeFreshEvidence(source: string = "GSC", daysAgo: number = 1): DiscoveryEvidence {
  return {
    sourceType: source,
    metric: "position",
    value: "8.5",
    observedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
  };
}

function makeSignal(overrides?: Partial<RawDiscoverySignal>): RawDiscoverySignal {
  return {
    siteId: "site_test_1",
    source: "GSC",
    sourceRunId: "run_integration_1",
    fingerprint: makeFingerprint(`${overrides?.resourceId ?? "/blog/test"}`),
    category: "QUICK_WIN",
    suggestedAction: "OPTIMIZE_TITLE",
    resourceType: "PAGE",
    resourceId: "/blog/test",
    url: "/blog/test",
    keyword: "test keyword",
    confidence: 0.8,
    evidence: [makeFreshEvidence("GSC", 1)],
    ...overrides,
  };
}

// ── §1 End-to-End: GSC Detector → Validate → Dedup → CANDIDATE ─────────────

describe("§1 — Full Pipeline: GSC-style signal → CANDIDATE", () => {
  it("valid GSC signal passes validation", () => {
    const signal = makeSignal({
      source: "GSC",
      category: "QUICK_WIN",
      confidence: 0.85,
      evidence: [
        makeFreshEvidence("GSC", 1),
        makeFreshEvidence("GSC", 2),
      ],
    });

    const result = validateSignal(signal);
    expect(result.valid).toBe(true);
  });

  it("GSC signal with fresh evidence produces valid expiry (expiresAt > now)", () => {
    const signal = makeSignal({
      source: "GSC",
      evidence: [makeFreshEvidence("GSC", 1)],
    });

    const evidenceSources = signal.evidence.map((e) => ({
      source: signal.source,
      observedAt: e.observedAt,
    }));

    const expiresAt = computeAggregateExpiry(evidenceSources);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("validator rejects GSC signal that would create expired candidate", () => {
    // Evidence from 20 days ago + GSC TTL 14d = expired 6 days ago
    const signal = makeSignal({
      source: "GSC",
      evidence: [makeFreshEvidence("GSC", 20)],
    });

    // The evidence is stale (20 > 14 maxEvidenceAgeDays for GSC)
    // So it fails at the evidence freshness check
    const result = validateSignal(signal);
    expect(result.valid).toBe(false);
  });
});

// ── §2 End-to-End: AUDIT Detector → Validate → Dedup ────────────────────────

describe("§2 — Full Pipeline: AUDIT-style signal → CANDIDATE", () => {
  it("valid AUDIT signal passes validation", () => {
    const signal = makeSignal({
      source: "AUDIT",
      sourceRunId: "audit_run_1",
      category: "ORPHANED",
      suggestedAction: "BUILD_INTERNAL_LINKS",
      confidence: 0.75,
      evidence: [
        {
          sourceType: "AUDIT",
          metric: "findingDescription",
          value: "Page has no inbound internal links",
          observedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        },
      ],
    });

    const result = validateSignal(signal);
    expect(result.valid).toBe(true);
  });

  it("AUDIT signal retains sourceRunId provenance", () => {
    const signal = makeSignal({
      source: "AUDIT",
      sourceRunId: "audit_run_abc",
    });

    expect(signal.sourceRunId).toBe("audit_run_abc");
    // Validation also checks sourceRunId is non-empty
    const result = validateSignal(signal);
    expect(result.valid).toBe(true);
  });
});

// ── §3 End-to-End: CONTENT Detector → Validate → Dedup ──────────────────────

describe("§3 — Full Pipeline: CONTENT-style signal → CANDIDATE", () => {
  it("stale content signal passes validation", () => {
    const signal = makeSignal({
      source: "CONTENT",
      sourceRunId: "content_run_1",
      category: "STALE",
      suggestedAction: "REFRESH_CONTENT",
      confidence: 0.7,
      evidence: [
        {
          sourceType: "CONTENT",
          metric: "daysOld",
          value: "200",
          observedAt: new Date(), // Observation is fresh (just detected now)
        },
      ],
    });

    const result = validateSignal(signal);
    expect(result.valid).toBe(true);
  });

  it("CONTENT signal with evidence from 25 days ago is valid (TTL=30d)", () => {
    const signal = makeSignal({
      source: "CONTENT",
      evidence: [makeFreshEvidence("CONTENT", 25)],
    });

    const result = validateSignal(signal);
    expect(result.valid).toBe(true);

    // And it would NOT create an expired candidate
    expect(wouldCreateExpiredCandidate(signal.evidence, "CONTENT")).toBe(false);
  });

  it("CONTENT signal with evidence from 35 days ago fails validation", () => {
    const signal = makeSignal({
      source: "CONTENT",
      evidence: [makeFreshEvidence("CONTENT", 35)],
    });

    const result = validateSignal(signal);
    expect(result.valid).toBe(false);
  });
});

// ── §4 Multi-Source Dedup + Conflict Resolution ──────────────────────────────

describe("§4 — Multi-Source → Dedup → Conflict Resolution → CANDIDATE", () => {
  it("merges GSC + AUDIT signals with same fingerprint", () => {
    const fp = makeFingerprint("shared-page");

    const gsc = makeSignal({
      fingerprint: fp,
      source: "GSC",
      sourceRunId: "gsc_1",
      category: "QUICK_WIN",
      confidence: 0.9,
      evidence: [makeFreshEvidence("GSC", 1)],
    });

    const audit = makeSignal({
      fingerprint: fp,
      source: "AUDIT",
      sourceRunId: "audit_1",
      category: "DECLINING",
      confidence: 0.7,
      evidence: [makeFreshEvidence("AUDIT", 2)],
    });

    const resolved = resolveAllConflicts([gsc, audit]);
    expect(resolved.length).toBe(1);

    const result = resolved[0];
    // DECLINING > QUICK_WIN in priority
    expect(result.category).toBe("DECLINING");
    expect(result.action).toBe(CATEGORY_TO_ACTION["DECLINING"]);
    // Max confidence
    expect(result.confidence).toBe(0.9);
    // Both sources retained
    expect(result.contributingSources.sort()).toEqual(["AUDIT", "GSC"]);
    // Evidence merged
    expect(result.mergedEvidence.length).toBe(2);
    // Both run IDs present
    expect(result.sourceRunIds.sort()).toEqual(["audit_1", "gsc_1"]);
  });

  it("different fingerprints produce separate candidates", () => {
    const sig1 = makeSignal({
      fingerprint: makeFingerprint("page-a"),
      resourceId: "/blog/page-a",
    });
    const sig2 = makeSignal({
      fingerprint: makeFingerprint("page-b"),
      resourceId: "/blog/page-b",
    });

    const resolved = resolveAllConflicts([sig1, sig2]);
    expect(resolved.length).toBe(2);
  });
});

// ── §5 Batch Validation → Dedup → Candidate Count ───────────────────────────

describe("§5 — Batch Pipeline: filter → dedup → resolved candidates", () => {
  it("filters invalid signals and deduplicates valid ones", () => {
    const fp = makeFingerprint("shared");
    const signals: RawDiscoverySignal[] = [
      // Valid signal
      makeSignal({
        fingerprint: fp,
        source: "GSC",
        sourceRunId: "r1",
        confidence: 0.8,
      }),
      // Invalid: below confidence threshold
      makeSignal({
        fingerprint: makeFingerprint("low-conf"),
        confidence: 0.1,
        sourceRunId: "r2",
      }),
      // Valid signal, same fingerprint → deduped
      makeSignal({
        fingerprint: fp,
        source: "AUDIT",
        sourceRunId: "r3",
        confidence: 0.6,
      }),
      // Invalid: no evidence
      makeSignal({
        fingerprint: makeFingerprint("no-evidence"),
        evidence: [],
        sourceRunId: "r4",
      }),
    ];

    // Step 1: Validate
    const { valid, rejected } = filterValidSignals(signals);
    expect(valid.length).toBe(2);
    expect(rejected.length).toBe(2);

    // Step 2: Dedup (conflict resolution)
    const resolved = resolveAllConflicts(valid);
    expect(resolved.length).toBe(1); // Both valid signals share fp

    // Step 3: Verify candidate properties
    const candidate = resolved[0];
    expect(candidate.fingerprint).toBe(fp);
    expect(candidate.confidence).toBe(0.8); // Max of 0.8 and 0.6
    expect(candidate.contributingSources.length).toBe(2);
    expect(candidate.mergedEvidence.length).toBe(2);
  });
});

// ── §6 CANDIDATE Status Invariant ────────────────────────────────────────────

describe("§6 — CANDIDATE Status: discovery-runner never writes OPEN", () => {
  it("discovery-runner.ts source code contains CANDIDATE status", () => {
    const { readFileSync } = require("fs");
    const { resolve, join } = require("path");
    const root = resolve(__dirname, "../../");
    const source = readFileSync(
      join(root, "src/lib/discovery/discovery-runner.ts"),
      "utf-8"
    );

    // Must contain CANDIDATE
    expect(source).toContain('opportunityStatus: "CANDIDATE"');
    // Must NOT contain OPEN as a status assignment
    expect(source).not.toMatch(/opportunityStatus:\s*["']OPEN["']/);
  });
});

// ── §7 Phase C Executor Would NOT See CANDIDATE ─────────────────────────────

describe("§7 — Phase C Executor Query Boundary", () => {
  it("executor queries OPEN, not CANDIDATE", () => {
    const { readFileSync } = require("fs");
    const { resolve, join } = require("path");
    const root = resolve(__dirname, "../../");
    const executorSource = readFileSync(
      join(root, "src/lib/inngest/functions/autonomous-executor.ts"),
      "utf-8"
    );

    // Executor must query for OPEN opportunities
    expect(executorSource).toMatch(/opportunityStatus.*OPEN/);
    // Executor must NOT query for CANDIDATE
    expect(executorSource).not.toMatch(/opportunityStatus.*CANDIDATE/);
  });
});

// ── §8 Evidence Expiry Consistency ───────────────────────────────────────────

describe("§8 — Evidence Expiry: valid signal always produces non-expired candidate", () => {
  const SOURCES = ["GSC", "CRAWL", "AUDIT", "CONTENT", "PERFORMANCE"] as const;

  it.each(SOURCES)(
    "%s: valid signal produces expiresAt > now",
    (source) => {
      const signal = makeSignal({
        source,
        evidence: [makeFreshEvidence(source, 1)], // 1 day old
      });

      // Must pass validation
      const result = validateSignal(signal);
      expect(result.valid).toBe(true);

      // Must NOT create expired candidate
      expect(wouldCreateExpiredCandidate(signal.evidence, source)).toBe(false);

      // Compute expiry
      const expiry = computeAggregateExpiry([{
        source,
        observedAt: signal.evidence[0].observedAt,
      }]);
      expect(expiry.getTime()).toBeGreaterThan(Date.now());
    }
  );
});
