/**
 * Phase B — State Machine & Type System Tests
 *
 * Tests the core type system, state machine transitions, safety policy,
 * and verification checks that form the foundation of Phase B.
 */

import { describe, it, expect } from "vitest";
import {
  OPPORTUNITY_TRANSITIONS,
  PROPOSAL_TRANSITIONS,
  TERMINAL_OPPORTUNITY_STATUSES,
  TERMINAL_PROPOSAL_STATUSES,
  SAFETY_TIER_MAP,
  VERIFICATION_CRITERIA_MAP,
  VERIFICATION_DELAYS,
  RETRY_POLICIES,
  FINDING_TO_ACTION_MAP,
  getSafetyTier,
  requiresHumanApproval,
  canRetry,
  computeNextRetryDelay,
  OpportunityTransitionError,
  ProposalTransitionError,
  type OpportunityStatus,
  type ProposalStatus,
  type ActionType,
} from "@/lib/proposals/types";
import {
  assertValidOpportunityTransition,
  isTerminalOpportunityStatus,
} from "@/lib/proposals/opportunity-lifecycle";
import {
  evaluatePolicy,
  hashProposedChanges,
  generateProposalIdempotencyKey,
  validateProposalApproval,
} from "@/lib/proposals/safety-policy";
import {
  parsePage,
  runCheck,
  runAllChecks,
} from "@/lib/proposals/verification-checks";

// ══════════════════════════════════════════════════════════════════════════════
// §1 — Opportunity Lifecycle State Machine
// ══════════════════════════════════════════════════════════════════════════════

describe("Opportunity Lifecycle", () => {
  it("OPEN can transition to PROPOSED", () => {
    expect(() =>
      assertValidOpportunityTransition("OPEN", "PROPOSED")
    ).not.toThrow();
  });

  it("PROPOSED can transition to APPROVED", () => {
    expect(() =>
      assertValidOpportunityTransition("PROPOSED", "APPROVED")
    ).not.toThrow();
  });

  it("PROPOSED can transition to REJECTED", () => {
    expect(() =>
      assertValidOpportunityTransition("PROPOSED", "REJECTED")
    ).not.toThrow();
  });

  it("APPROVED can transition to EXECUTING", () => {
    expect(() =>
      assertValidOpportunityTransition("APPROVED", "EXECUTING")
    ).not.toThrow();
  });

  it("EXECUTING can transition to VERIFYING", () => {
    expect(() =>
      assertValidOpportunityTransition("EXECUTING", "VERIFYING")
    ).not.toThrow();
  });

  it("VERIFYING can transition to VERIFIED", () => {
    expect(() =>
      assertValidOpportunityTransition("VERIFYING", "VERIFIED")
    ).not.toThrow();
  });

  it("VERIFYING can transition to FAILED", () => {
    expect(() =>
      assertValidOpportunityTransition("VERIFYING", "FAILED")
    ).not.toThrow();
  });

  it("FAILED can re-open", () => {
    expect(() =>
      assertValidOpportunityTransition("FAILED", "OPEN")
    ).not.toThrow();
  });

  it("FAILED can be rolled back", () => {
    expect(() =>
      assertValidOpportunityTransition("FAILED", "ROLLED_BACK")
    ).not.toThrow();
  });

  it("REJECTED can re-open", () => {
    expect(() =>
      assertValidOpportunityTransition("REJECTED", "OPEN")
    ).not.toThrow();
  });

  it("VERIFIED is terminal — no further transitions", () => {
    expect(() =>
      assertValidOpportunityTransition("VERIFIED", "OPEN")
    ).toThrow(OpportunityTransitionError);
  });

  it("ROLLED_BACK is terminal — no further transitions", () => {
    expect(() =>
      assertValidOpportunityTransition("ROLLED_BACK", "OPEN")
    ).toThrow(OpportunityTransitionError);
  });

  it("invalid transition OPEN → EXECUTING throws", () => {
    expect(() =>
      assertValidOpportunityTransition("OPEN", "EXECUTING")
    ).toThrow(OpportunityTransitionError);
  });

  it("invalid transition PROPOSED → EXECUTING throws (must go through APPROVED)", () => {
    expect(() =>
      assertValidOpportunityTransition("PROPOSED", "EXECUTING")
    ).toThrow(OpportunityTransitionError);
  });

  it("all terminal statuses are correctly marked", () => {
    for (const status of TERMINAL_OPPORTUNITY_STATUSES) {
      expect(isTerminalOpportunityStatus(status)).toBe(true);
      const transitions = OPPORTUNITY_TRANSITIONS[status];
      expect(transitions).toEqual([]);
    }
  });

  it("every non-terminal status has at least one valid transition", () => {
    for (const [status, transitions] of Object.entries(OPPORTUNITY_TRANSITIONS)) {
      if (!TERMINAL_OPPORTUNITY_STATUSES.includes(status as OpportunityStatus)) {
        expect(transitions.length).toBeGreaterThan(0);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2 — Proposal Lifecycle State Machine
// ══════════════════════════════════════════════════════════════════════════════

describe("Proposal Lifecycle", () => {
  it("DRAFT → READY is valid", () => {
    expect(PROPOSAL_TRANSITIONS.DRAFT).toContain("READY");
  });

  it("READY → APPROVED is valid", () => {
    expect(PROPOSAL_TRANSITIONS.READY).toContain("APPROVED");
  });

  it("APPROVED → EXECUTING is valid", () => {
    expect(PROPOSAL_TRANSITIONS.APPROVED).toContain("EXECUTING");
  });

  it("EXECUTING → EXECUTED is valid", () => {
    expect(PROPOSAL_TRANSITIONS.EXECUTING).toContain("EXECUTED");
  });

  it("EXECUTED → VERIFYING is valid", () => {
    expect(PROPOSAL_TRANSITIONS.EXECUTED).toContain("VERIFYING");
  });

  it("VERIFYING → VERIFIED is valid", () => {
    expect(PROPOSAL_TRANSITIONS.VERIFYING).toContain("VERIFIED");
  });

  it("terminal statuses have no transitions", () => {
    for (const status of TERMINAL_PROPOSAL_STATUSES) {
      expect(PROPOSAL_TRANSITIONS[status]).toEqual([]);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §3 — Safety Tier Classification
// ══════════════════════════════════════════════════════════════════════════════

describe("Safety Tier Classification", () => {
  it("Tier 1 actions do NOT require human approval", () => {
    const tier1Actions: ActionType[] = [
      "UPDATE_META_DESCRIPTION",
      "UPDATE_TITLE_TAG",
      "FIX_HEADING_HIERARCHY",
      "ADD_SCHEMA_MARKUP",
      "ADD_CANONICAL_TAG",
      "FIX_BROKEN_LINK",
      "ADD_INTERNAL_LINKS",
    ];
    for (const action of tier1Actions) {
      expect(getSafetyTier(action)).toBe(1);
      expect(requiresHumanApproval(1)).toBe(false);
    }
  });

  it("Tier 2 actions require human approval", () => {
    const tier2Actions: ActionType[] = [
      "CHANGE_CANONICAL",
      "MODIFY_ROBOTS_META",
      "REDIRECT_URL",
      "CHANGE_PAGE_TITLE",
      "PUBLISH_CONTENT",
      "REFRESH_CONTENT",
      "GENERATE_CONTENT_BRIEF",
    ];
    for (const action of tier2Actions) {
      expect(getSafetyTier(action)).toBe(2);
      expect(requiresHumanApproval(2)).toBe(true);
    }
  });

  it("Tier 3 actions require human approval", () => {
    const tier3Actions: ActionType[] = [
      "DELETE_PAGE",
      "CONSOLIDATE_CONTENT",
      "MASS_REDIRECT",
      "SITE_WIDE_CHANGE",
    ];
    for (const action of tier3Actions) {
      expect(getSafetyTier(action)).toBe(3);
      expect(requiresHumanApproval(3)).toBe(true);
    }
  });

  it("every ActionType has a safety tier", () => {
    for (const key of Object.keys(SAFETY_TIER_MAP)) {
      expect([0, 1, 2, 3]).toContain(SAFETY_TIER_MAP[key as ActionType]);
    }
  });

  it("evaluatePolicy returns correct auto-approve for Tier 1", () => {
    const policy = evaluatePolicy("UPDATE_META_DESCRIPTION");
    expect(policy.autoApprove).toBe(true);
    expect(policy.autoExecute).toBe(true);
    expect(policy.tier).toBe(1);
  });

  it("evaluatePolicy returns correct policy for Tier 2", () => {
    const policy = evaluatePolicy("CHANGE_CANONICAL");
    expect(policy.autoApprove).toBe(false);
    expect(policy.autoExecute).toBe(false);
    expect(policy.tier).toBe(2);
  });

  it("evaluatePolicy returns correct policy for Tier 3", () => {
    const policy = evaluatePolicy("DELETE_PAGE");
    expect(policy.autoApprove).toBe(false);
    expect(policy.tier).toBe(3);
    expect(policy.maxAttempts).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §4 — Retry Policy
// ══════════════════════════════════════════════════════════════════════════════

describe("Retry Policy", () => {
  it("Tier 1 allows 3 attempts", () => {
    expect(canRetry(0, 1)).toBe(true);
    expect(canRetry(1, 1)).toBe(true);
    expect(canRetry(2, 1)).toBe(true);
    expect(canRetry(3, 1)).toBe(false);
  });

  it("Tier 2 allows 2 attempts", () => {
    expect(canRetry(0, 2)).toBe(true);
    expect(canRetry(1, 2)).toBe(true);
    expect(canRetry(2, 2)).toBe(false);
  });

  it("Tier 3 allows 1 attempt", () => {
    expect(canRetry(0, 3)).toBe(true);
    expect(canRetry(1, 3)).toBe(false);
  });

  it("Tier 0 allows 0 attempts (read-only)", () => {
    expect(canRetry(0, 0)).toBe(false);
  });

  it("computeNextRetryDelay uses exponential backoff", () => {
    const policy = RETRY_POLICIES[1];
    const delay1 = computeNextRetryDelay(policy, 1);
    const delay2 = computeNextRetryDelay(policy, 2);
    const delay3 = computeNextRetryDelay(policy, 3);
    expect(delay1).toBe(30_000);
    expect(delay2).toBe(60_000);
    expect(delay3).toBe(120_000);
  });

  it("computeNextRetryDelay respects maxDelay", () => {
    const policy = RETRY_POLICIES[1];
    const delayLarge = computeNextRetryDelay(policy, 100);
    expect(delayLarge).toBe(policy.maxDelayMs);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §5 — Proposal Hashing & Idempotency
// ══════════════════════════════════════════════════════════════════════════════

describe("Proposal Hashing", () => {
  it("same input produces same hash", () => {
    const h1 = hashProposedChanges("UPDATE_META_DESCRIPTION", "/pricing", [
      {
        field: "metaDescription",
        currentValue: null,
        proposedValue: "New meta",
        reasoning: "test",
      },
    ]);
    const h2 = hashProposedChanges("UPDATE_META_DESCRIPTION", "/pricing", [
      {
        field: "metaDescription",
        currentValue: null,
        proposedValue: "New meta",
        reasoning: "test",
      },
    ]);
    expect(h1).toBe(h2);
  });

  it("different input produces different hash", () => {
    const h1 = hashProposedChanges("UPDATE_META_DESCRIPTION", "/pricing", [
      {
        field: "metaDescription",
        currentValue: null,
        proposedValue: "Version 1",
        reasoning: "test",
      },
    ]);
    const h2 = hashProposedChanges("UPDATE_META_DESCRIPTION", "/pricing", [
      {
        field: "metaDescription",
        currentValue: null,
        proposedValue: "Version 2",
        reasoning: "test",
      },
    ]);
    expect(h1).not.toBe(h2);
  });

  it("reasoning does not affect hash (only field/currentValue/proposedValue matter)", () => {
    const h1 = hashProposedChanges("UPDATE_META_DESCRIPTION", "/pricing", [
      {
        field: "metaDescription",
        currentValue: null,
        proposedValue: "Same value",
        reasoning: "Reason A",
      },
    ]);
    const h2 = hashProposedChanges("UPDATE_META_DESCRIPTION", "/pricing", [
      {
        field: "metaDescription",
        currentValue: null,
        proposedValue: "Same value",
        reasoning: "Reason B",
      },
    ]);
    expect(h1).toBe(h2);
  });
});

describe("Idempotency Key", () => {
  it("same parameters produce same key", () => {
    const k1 = generateProposalIdempotencyKey(
      "site1",
      "dec1",
      "UPDATE_META_DESCRIPTION",
      "/pricing"
    );
    const k2 = generateProposalIdempotencyKey(
      "site1",
      "dec1",
      "UPDATE_META_DESCRIPTION",
      "/pricing"
    );
    expect(k1).toBe(k2);
  });

  it("different parameters produce different keys", () => {
    const k1 = generateProposalIdempotencyKey(
      "site1",
      "dec1",
      "UPDATE_META_DESCRIPTION",
      "/pricing"
    );
    const k2 = generateProposalIdempotencyKey(
      "site1",
      "dec2",
      "UPDATE_META_DESCRIPTION",
      "/pricing"
    );
    expect(k1).not.toBe(k2);
  });

  it("key starts with 'prop:' prefix", () => {
    const key = generateProposalIdempotencyKey(
      "site1",
      "dec1",
      "UPDATE_META_DESCRIPTION",
      "/pricing"
    );
    expect(key).toMatch(/^prop:[a-f0-9]{16}$/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §6 — Approval Validation
// ══════════════════════════════════════════════════════════════════════════════

describe("Approval Validation", () => {
  it("valid approval passes", () => {
    const result = validateProposalApproval({
      approvedBy: "user:123",
      approvalExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      approvalHash: hashProposedChanges("UPDATE_META_DESCRIPTION", "/test", [
        {
          field: "metaDescription",
          currentValue: null,
          proposedValue: "test",
          reasoning: "r",
        },
      ]),
      actionType: "UPDATE_META_DESCRIPTION",
      targetUrl: "/test",
      proposedChanges: [
        {
          field: "metaDescription",
          currentValue: null,
          proposedValue: "test",
          reasoning: "r",
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("expired approval fails", () => {
    const result = validateProposalApproval({
      approvedBy: "user:123",
      approvalExpiresAt: new Date(Date.now() - 1000),
      approvalHash: null,
      actionType: "UPDATE_META_DESCRIPTION",
      targetUrl: "/test",
      proposedChanges: [],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("no approver fails", () => {
    const result = validateProposalApproval({
      approvedBy: null,
      approvalExpiresAt: null,
      approvalHash: null,
      actionType: "UPDATE_META_DESCRIPTION",
      targetUrl: "/test",
      proposedChanges: [],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("No approver");
  });

  it("hash mismatch fails", () => {
    const result = validateProposalApproval({
      approvedBy: "user:123",
      approvalExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      approvalHash: "old_hash_before_modification",
      actionType: "UPDATE_META_DESCRIPTION",
      targetUrl: "/test",
      proposedChanges: [
        {
          field: "metaDescription",
          currentValue: null,
          proposedValue: "modified after approval",
          reasoning: "r",
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("hash mismatch");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §7 — Verification Checks (HTML parsing)
// ══════════════════════════════════════════════════════════════════════════════

describe("Verification Checks", () => {
  describe("Meta Description", () => {
    it("HAS_META_DESCRIPTION passes when present", () => {
      const page = parsePage(
        '<html><head><meta name="description" content="Test description"></head></html>',
        200,
        "https://example.com"
      );
      const result = runCheck({ check: "HAS_META_DESCRIPTION" }, page);
      expect(result.passed).toBe(true);
    });

    it("HAS_META_DESCRIPTION fails when missing", () => {
      const page = parsePage(
        "<html><head></head></html>",
        200,
        "https://example.com"
      );
      const result = runCheck({ check: "HAS_META_DESCRIPTION" }, page);
      expect(result.passed).toBe(false);
    });

    it("META_DESCRIPTION_MATCHES passes when value matches", () => {
      const page = parsePage(
        '<html><head><meta name="description" content="Exact match"></head></html>',
        200,
        "https://example.com"
      );
      const result = runCheck(
        { check: "META_DESCRIPTION_MATCHES", expectedValue: "Exact match" },
        page
      );
      expect(result.passed).toBe(true);
    });

    it("META_DESCRIPTION_MATCHES fails when value differs", () => {
      const page = parsePage(
        '<html><head><meta name="description" content="Different value"></head></html>',
        200,
        "https://example.com"
      );
      const result = runCheck(
        { check: "META_DESCRIPTION_MATCHES", expectedValue: "Expected value" },
        page
      );
      expect(result.passed).toBe(false);
    });

    it("META_DESCRIPTION_LENGTH_VALID passes for 50-160 chars", () => {
      const desc = "x".repeat(100);
      const page = parsePage(
        `<html><head><meta name="description" content="${desc}"></head></html>`,
        200,
        "https://example.com"
      );
      const result = runCheck(
        { check: "META_DESCRIPTION_LENGTH_VALID" },
        page
      );
      expect(result.passed).toBe(true);
    });
  });

  describe("Title", () => {
    it("HAS_TITLE passes when present", () => {
      const page = parsePage(
        "<html><head><title>My Page</title></head></html>",
        200,
        "https://example.com"
      );
      const result = runCheck({ check: "HAS_TITLE" }, page);
      expect(result.passed).toBe(true);
    });

    it("TITLE_MATCHES passes when value matches", () => {
      const page = parsePage(
        "<html><head><title>Exact Title</title></head></html>",
        200,
        "https://example.com"
      );
      const result = runCheck(
        { check: "TITLE_MATCHES", expectedValue: "Exact Title" },
        page
      );
      expect(result.passed).toBe(true);
    });
  });

  describe("Headings", () => {
    it("SINGLE_H1 passes with exactly one H1", () => {
      const page = parsePage(
        "<html><body><h1>Title</h1><h2>Sub</h2></body></html>",
        200,
        "https://example.com"
      );
      const result = runCheck({ check: "SINGLE_H1" }, page);
      expect(result.passed).toBe(true);
    });

    it("SINGLE_H1 fails with multiple H1s", () => {
      const page = parsePage(
        "<html><body><h1>Title</h1><h1>Second</h1></body></html>",
        200,
        "https://example.com"
      );
      const result = runCheck({ check: "SINGLE_H1" }, page);
      expect(result.passed).toBe(false);
    });

    it("HEADING_HIERARCHY_VALID passes with no gaps", () => {
      const page = parsePage(
        "<html><body><h1>Title</h1><h2>Sub</h2><h3>SubSub</h3></body></html>",
        200,
        "https://example.com"
      );
      const result = runCheck({ check: "HEADING_HIERARCHY_VALID" }, page);
      expect(result.passed).toBe(true);
    });

    it("HEADING_HIERARCHY_VALID fails with skipped levels", () => {
      const page = parsePage(
        "<html><body><h1>Title</h1><h4>Skipped</h4></body></html>",
        200,
        "https://example.com"
      );
      const result = runCheck({ check: "HEADING_HIERARCHY_VALID" }, page);
      expect(result.passed).toBe(false);
    });
  });

  describe("Schema Markup", () => {
    it("SCHEMA_MARKUP_PRESENT passes when JSON-LD exists", () => {
      const page = parsePage(
        `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Article"}</script></head></html>`,
        200,
        "https://example.com"
      );
      const result = runCheck({ check: "SCHEMA_MARKUP_PRESENT" }, page);
      expect(result.passed).toBe(true);
    });

    it("SCHEMA_MARKUP_PRESENT fails when no JSON-LD", () => {
      const page = parsePage(
        "<html><head></head></html>",
        200,
        "https://example.com"
      );
      const result = runCheck({ check: "SCHEMA_MARKUP_PRESENT" }, page);
      expect(result.passed).toBe(false);
    });
  });

  describe("HTTP Status", () => {
    it("HTTP_STATUS_200 passes for 200", () => {
      const page = parsePage("<html></html>", 200, "https://example.com");
      const result = runCheck({ check: "HTTP_STATUS_200" }, page);
      expect(result.passed).toBe(true);
    });

    it("HTTP_STATUS_200 fails for 404", () => {
      const page = parsePage("<html></html>", 404, "https://example.com");
      const result = runCheck({ check: "HTTP_STATUS_200" }, page);
      expect(result.passed).toBe(false);
    });
  });

  describe("runAllChecks", () => {
    it("returns allCriticalPassed=true when all critical checks pass", () => {
      const page = parsePage(
        '<html><head><meta name="description" content="Test desc"></head><body><h1>Title</h1></body></html>',
        200,
        "https://example.com"
      );
      const { allCriticalPassed, details } = runAllChecks(
        [
          { check: "HAS_META_DESCRIPTION", critical: true },
          { check: "HTTP_STATUS_200", critical: true },
          { check: "META_DESCRIPTION_LENGTH_VALID", critical: false }, // advisory — 9 chars
        ],
        page
      );
      expect(allCriticalPassed).toBe(true);
      expect(details).toHaveLength(3);
    });

    it("returns allCriticalPassed=false when a critical check fails", () => {
      const page = parsePage(
        "<html><head></head></html>",
        200,
        "https://example.com"
      );
      const { allCriticalPassed } = runAllChecks(
        [
          { check: "HAS_META_DESCRIPTION", critical: true },
          { check: "HTTP_STATUS_200", critical: true },
        ],
        page
      );
      expect(allCriticalPassed).toBe(false);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §8 — Finding → Action Mapping
// ══════════════════════════════════════════════════════════════════════════════

describe("Finding → Action Mapping", () => {
  it("MISSING_META_DESCRIPTION maps to UPDATE_META_DESCRIPTION", () => {
    expect(FINDING_TO_ACTION_MAP.MISSING_META_DESCRIPTION.actionType).toBe(
      "UPDATE_META_DESCRIPTION"
    );
    expect(FINDING_TO_ACTION_MAP.MISSING_META_DESCRIPTION.safetyTier).toBe(1);
  });

  it("CANNIBALIZATION_RISK maps to Tier 3", () => {
    expect(FINDING_TO_ACTION_MAP.CANNIBALIZATION_RISK.safetyTier).toBe(3);
  });

  it("every mapped finding has a valid ActionType in SAFETY_TIER_MAP", () => {
    for (const [, mapping] of Object.entries(FINDING_TO_ACTION_MAP)) {
      expect(SAFETY_TIER_MAP[mapping.actionType]).toBe(mapping.safetyTier);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §9 — Verification Criteria Coverage
// ══════════════════════════════════════════════════════════════════════════════

describe("Verification Criteria Map", () => {
  it("every ActionType has a verification entry", () => {
    for (const key of Object.keys(SAFETY_TIER_MAP)) {
      expect(VERIFICATION_CRITERIA_MAP).toHaveProperty(key);
    }
  });

  it("Tier 1 actions with page changes always check HTTP_STATUS_200", () => {
    const tier1WithChecks: ActionType[] = [
      "UPDATE_META_DESCRIPTION",
      "UPDATE_TITLE_TAG",
      "FIX_HEADING_HIERARCHY",
      "ADD_SCHEMA_MARKUP",
      "ADD_CANONICAL_TAG",
      "FIX_BROKEN_LINK",
      "ADD_INTERNAL_LINKS",
    ];
    for (const action of tier1WithChecks) {
      const criteria = VERIFICATION_CRITERIA_MAP[action];
      const hasHttpCheck = criteria.some((c) => c.check === "HTTP_STATUS_200");
      expect(hasHttpCheck).toBe(true);
    }
  });

  it("UPDATE_META_DESCRIPTION checks CANONICAL_UNCHANGED and ROBOTS_META_UNCHANGED", () => {
    const criteria = VERIFICATION_CRITERIA_MAP.UPDATE_META_DESCRIPTION;
    const checks = criteria.map((c) => c.check);
    expect(checks).toContain("CANONICAL_UNCHANGED");
    expect(checks).toContain("ROBOTS_META_UNCHANGED");
  });

  it("every ActionType has a verification delay entry", () => {
    for (const key of Object.keys(SAFETY_TIER_MAP)) {
      expect(VERIFICATION_DELAYS).toHaveProperty(key);
    }
  });
});
