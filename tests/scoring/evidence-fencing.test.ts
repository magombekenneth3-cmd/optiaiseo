/**
 * Phase D.2 — Evidence Fencing Tests
 *
 * Test 8 from certification gates:
 *   8. Evidence mutation between scoring and promotion invalidates the score
 */

import { describe, it, expect } from "vitest";
import { hashScoringEvidence } from "@/lib/scoring/evidence-fencing";
import type { ScoringInput } from "@/lib/scoring/types";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(overrides?: Partial<ScoringInput>): ScoringInput {
  return {
    opportunityId: "opp_1",
    siteId: "site_1",
    url: "/blog/test",
    primaryKeyword: "test keyword",
    category: "QUICK_WIN",
    action: "OPTIMIZE_TITLE",
    discoveryConfidence: 0.8,
    expiresAt: new Date("2025-01-15T00:00:00Z"),
    lastRefreshedAt: new Date("2025-01-01T00:00:00Z"),
    primaryDiscoverySource: "GSC",
    evidenceItems: [
      {
        sourceType: "GSC",
        metric: "position",
        value: "8.5",
        observedAt: new Date("2025-01-01T12:00:00Z"),
      },
    ],
    existingScore: null,
    metadata: {},
    ...overrides,
  };
}

// ── §1 Hash Determinism ─────────────────────────────────────────────────────

describe("§1 — Evidence hash is deterministic", () => {
  it("same input produces same hash", () => {
    const input = makeInput();
    const h1 = hashScoringEvidence(input);
    const h2 = hashScoringEvidence(input);

    expect(h1).toBe(h2);
  });

  it("hash is a 64-char hex string (sha256)", () => {
    const hash = hashScoringEvidence(makeInput());
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ── §2 Hash Sensitivity ─────────────────────────────────────────────────────

describe("§2 — Evidence hash changes when evidence changes", () => {
  it("different evidence items → different hash", () => {
    const h1 = hashScoringEvidence(makeInput());
    const h2 = hashScoringEvidence(makeInput({
      evidenceItems: [
        {
          sourceType: "AUDIT",
          metric: "finding",
          value: "different",
          observedAt: new Date("2025-01-02T12:00:00Z"),
        },
      ],
    }));

    expect(h1).not.toBe(h2);
  });

  it("different discoveryConfidence → different hash", () => {
    const h1 = hashScoringEvidence(makeInput({ discoveryConfidence: 0.8 }));
    const h2 = hashScoringEvidence(makeInput({ discoveryConfidence: 0.9 }));

    expect(h1).not.toBe(h2);
  });

  it("different expiresAt → different hash", () => {
    const h1 = hashScoringEvidence(makeInput({ expiresAt: new Date("2025-01-15") }));
    const h2 = hashScoringEvidence(makeInput({ expiresAt: new Date("2025-01-20") }));

    expect(h1).not.toBe(h2);
  });

  it("different lastRefreshedAt → different hash", () => {
    const h1 = hashScoringEvidence(makeInput({ lastRefreshedAt: new Date("2025-01-01") }));
    const h2 = hashScoringEvidence(makeInput({ lastRefreshedAt: new Date("2025-01-05") }));

    expect(h1).not.toBe(h2);
  });

  it("additional evidence item → different hash", () => {
    const base = makeInput();
    const withExtra = makeInput({
      evidenceItems: [
        ...base.evidenceItems,
        {
          sourceType: "AUDIT",
          metric: "findingType",
          value: "LOW_CTR",
          observedAt: new Date("2025-01-03T00:00:00Z"),
        },
      ],
    });

    const h1 = hashScoringEvidence(base);
    const h2 = hashScoringEvidence(withExtra);

    expect(h1).not.toBe(h2);
  });
});

// ── §3 Hash Insensitivity ───────────────────────────────────────────────────

describe("§3 — Evidence hash is insensitive to non-evidence fields", () => {
  it("different url does NOT change hash (url is not in evidence)", () => {
    const h1 = hashScoringEvidence(makeInput({ url: "/page-a" }));
    const h2 = hashScoringEvidence(makeInput({ url: "/page-b" }));

    // URL is not part of evidence hash — only evidence items + confidence + dates
    expect(h1).toBe(h2);
  });

  it("different category does NOT change hash", () => {
    const h1 = hashScoringEvidence(makeInput({ category: "QUICK_WIN" }));
    const h2 = hashScoringEvidence(makeInput({ category: "DECLINING" }));

    expect(h1).toBe(h2);
  });
});

// ── §4 Null Handling ────────────────────────────────────────────────────────

describe("§4 — Null evidence fields handled", () => {
  it("null discoveryConfidence produces valid hash", () => {
    const hash = hashScoringEvidence(makeInput({ discoveryConfidence: null }));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("null expiresAt produces valid hash", () => {
    const hash = hashScoringEvidence(makeInput({ expiresAt: null }));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("null lastRefreshedAt produces valid hash", () => {
    const hash = hashScoringEvidence(makeInput({ lastRefreshedAt: null }));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("empty evidence items produces valid hash", () => {
    const hash = hashScoringEvidence(makeInput({ evidenceItems: [] }));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
