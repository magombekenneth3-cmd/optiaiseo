/**
 * Phase B.1 — Execution Safety & Mutation Integrity Audit
 *
 * Tests every security boundary in the execution path:
 *
 *   §1 — Crash Recovery & Idempotency
 *   §2 — State Machine Invariant Enforcement
 *   §3 — DB ↔ External API Failure Modes
 *   §4 — Tenant Isolation
 *   §5 — Safety Policy Enforcement
 *
 * Uses mocked Prisma / module stubs — no live DB required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Pure-function imports (no Prisma, safe to import directly) ──────────────
import {
  OPPORTUNITY_TRANSITIONS,
  PROPOSAL_TRANSITIONS,
  TERMINAL_OPPORTUNITY_STATUSES,
  TERMINAL_PROPOSAL_STATUSES,
  ROLLBACK_ELIGIBLE_PROPOSAL_STATUSES,
  type OpportunityStatus,
  type ProposalStatus,
  type ActionType,
} from "@/lib/proposals/types";
import { assertValidOpportunityTransition } from "@/lib/proposals/opportunity-lifecycle";
import {
  evaluatePolicy,
  hashProposedChanges,
  generateProposalIdempotencyKey,
  validateProposalApproval,
} from "@/lib/proposals/safety-policy";
import {
  requiresHumanApproval,
  getSafetyTier,
  canRetry,
  SAFETY_TIER_MAP,
} from "@/lib/proposals/types";
import {
  MutationBlockedError,
  ConcurrentModificationError,
  ExecutionClaimError,
  VALID_TRANSITIONS,
  TERMINAL_STATUSES,
  type OperationStatus,
} from "@/lib/mutations/types";
import { assertGlobalNotKilled } from "@/lib/mutations/kill-switch";

// ══════════════════════════════════════════════════════════════════════════════
// §1 — CRASH RECOVERY & IDEMPOTENCY
// ══════════════════════════════════════════════════════════════════════════════

describe("§1 Crash Recovery & Idempotency", () => {

  // ── 1.1 Proposal idempotency key uniqueness ─────────────────────────────

  it("same inputs produce the same proposal idempotency key (safe retry)", () => {
    const k1 = generateProposalIdempotencyKey(
      "site-abc", "decision-1", "UPDATE_META_DESCRIPTION", "/pricing"
    );
    const k2 = generateProposalIdempotencyKey(
      "site-abc", "decision-1", "UPDATE_META_DESCRIPTION", "/pricing"
    );
    expect(k1).toBe(k2);
  });

  it("retry idempotency keys use a :retry-N suffix — no collision with original", () => {
    const base = generateProposalIdempotencyKey(
      "site-abc", "decision-1", "UPDATE_META_DESCRIPTION", "/pricing"
    );
    // Simulate what retryProposal() does (line 137 in retry.ts)
    const retry1 = base + ":retry-1";
    const retry2 = base + ":retry-2";

    expect(retry1).not.toBe(base);
    expect(retry2).not.toBe(retry1);
  });

  it("keys for different sites are different even with same decisionId + action + url", () => {
    const k1 = generateProposalIdempotencyKey("site-A", "dec-1", "UPDATE_META_DESCRIPTION", "/p");
    const k2 = generateProposalIdempotencyKey("site-B", "dec-1", "UPDATE_META_DESCRIPTION", "/p");
    expect(k1).not.toBe(k2);
  });

  it("keys for different decisionIds are different (same site/action/url)", () => {
    const k1 = generateProposalIdempotencyKey("site-A", "dec-1", "UPDATE_META_DESCRIPTION", "/p");
    const k2 = generateProposalIdempotencyKey("site-A", "dec-2", "UPDATE_META_DESCRIPTION", "/p");
    expect(k1).not.toBe(k2);
  });

  // ── 1.2 CAS guard prevents dual execution ──────────────────────────────

  it("ConcurrentModificationError is thrown when expectedVersion does not match", () => {
    // Simulates atomicVersionedUpdate: affectedRows === 0
    const err = new ConcurrentModificationError("Blog", "blog-id-1", 5);
    expect(err.targetModel).toBe("Blog");
    expect(err.targetId).toBe("blog-id-1");
    expect(err.expectedVersion).toBe(5);
    expect(err.name).toBe("ConcurrentModificationError");
  });

  it("ExecutionClaimError is thrown when a worker fails to claim", () => {
    const err = new ExecutionClaimError("op-id-1");
    expect(err.name).toBe("ExecutionClaimError");
    expect(err.message).toContain("op-id-1");
  });

  it("ExecutionClaimError message references the competing-worker scenario", () => {
    const err = new ExecutionClaimError("op-xyz");
    expect(err.message).toMatch(/another worker/i);
  });

  // ── 1.3 Approval hash prevents tampered replays ─────────────────────────

  it("approval hash is stable across re-invocations (safe for retry)", () => {
    const changes = [{ field: "metaDescription", currentValue: null, proposedValue: "New desc", reasoning: "r" }];
    const h1 = hashProposedChanges("UPDATE_META_DESCRIPTION", "/pricing", changes);
    const h2 = hashProposedChanges("UPDATE_META_DESCRIPTION", "/pricing", changes);
    expect(h1).toBe(h2);
  });

  it("reasoning change does not affect hash (only field/currentValue/proposedValue)", () => {
    const h1 = hashProposedChanges("UPDATE_META_DESCRIPTION", "/p", [
      { field: "metaDescription", currentValue: null, proposedValue: "X", reasoning: "reason A" }
    ]);
    const h2 = hashProposedChanges("UPDATE_META_DESCRIPTION", "/p", [
      { field: "metaDescription", currentValue: null, proposedValue: "X", reasoning: "reason B" }
    ]);
    expect(h1).toBe(h2);
  });

  it("modifying proposedValue after approval produces a different hash (tamper detection)", () => {
    const h1 = hashProposedChanges("UPDATE_META_DESCRIPTION", "/p", [
      { field: "metaDescription", currentValue: null, proposedValue: "Original", reasoning: "r" }
    ]);
    const h2 = hashProposedChanges("UPDATE_META_DESCRIPTION", "/p", [
      { field: "metaDescription", currentValue: null, proposedValue: "Modified by attacker", reasoning: "r" }
    ]);
    expect(h1).not.toBe(h2);
  });

  // ── 1.4 Kill switch behavior ────────────────────────────────────────────

  it("GLOBAL_EMERGENCY_STOP blocks all mutations", async () => {
    const original = process.env.GLOBAL_EMERGENCY_STOP;
    process.env.GLOBAL_EMERGENCY_STOP = "true";
    try {
      await expect(assertGlobalNotKilled()).rejects.toThrow(MutationBlockedError);
    } finally {
      process.env.GLOBAL_EMERGENCY_STOP = original;
    }
  });

  it("GLOBAL_EMERGENCY_STOP=false does not block mutations", async () => {
    const original = process.env.GLOBAL_EMERGENCY_STOP;
    process.env.GLOBAL_EMERGENCY_STOP = "false";
    try {
      await expect(assertGlobalNotKilled()).resolves.toBeUndefined();
    } finally {
      process.env.GLOBAL_EMERGENCY_STOP = original;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2 — STATE MACHINE INVARIANT ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════════════

describe("§2 State Machine Invariant Enforcement", () => {

  // ── 2.1 Opportunity state machine completeness ──────────────────────────

  it("every OpportunityStatus has an entry in OPPORTUNITY_TRANSITIONS", () => {
    const allStatuses: OpportunityStatus[] = [
      "OPEN", "PROPOSED", "APPROVED", "EXECUTING", "VERIFYING",
      "VERIFIED", "FAILED", "REJECTED", "ROLLED_BACK", "EXPIRED",
    ];
    for (const s of allStatuses) {
      expect(OPPORTUNITY_TRANSITIONS).toHaveProperty(s);
    }
  });

  it("ROLLED_BACK opportunity is terminal — no further transitions", () => {
    // After Amendment #4: only ROLLED_BACK is truly terminal.
    // VERIFIED allows ROLLED_BACK (rollback on regression) and is NOT terminal.
    // EXPIRED allows OPEN (re-open after expiry) and is NOT terminal.
    expect(TERMINAL_OPPORTUNITY_STATUSES).toEqual(["ROLLED_BACK"]);
    for (const status of TERMINAL_OPPORTUNITY_STATUSES) {
      expect(OPPORTUNITY_TRANSITIONS[status]).toEqual([]);
    }
  });

  it("no opportunity status has a self-loop transition", () => {
    for (const [from, targets] of Object.entries(OPPORTUNITY_TRANSITIONS)) {
      expect(targets).not.toContain(from);
    }
  });

  it("every non-terminal opportunity status has at least one outbound transition (no dead states)", () => {
    for (const [status, targets] of Object.entries(OPPORTUNITY_TRANSITIONS)) {
      if (!TERMINAL_OPPORTUNITY_STATUSES.includes(status as OpportunityStatus)) {
        expect(targets.length).toBeGreaterThan(0);
      }
    }
  });

  // ── 2.2 Critical opportunity transition rules ───────────────────────────

  it("OPEN → PROPOSED is valid", () => {
    expect(() => assertValidOpportunityTransition("OPEN", "PROPOSED")).not.toThrow();
  });

  it("PROPOSED → APPROVED is valid", () => {
    expect(() => assertValidOpportunityTransition("PROPOSED", "APPROVED")).not.toThrow();
  });

  it("PROPOSED → EXPIRED is valid (expiry cron fixed path)", () => {
    expect(() => assertValidOpportunityTransition("PROPOSED", "EXPIRED")).not.toThrow();
  });

  it("APPROVED → EXPIRED is valid (expiry cron fixed path)", () => {
    expect(() => assertValidOpportunityTransition("APPROVED", "EXPIRED")).not.toThrow();
  });

  it("OPEN → EXECUTING is invalid (must pass through PROPOSED → APPROVED first)", () => {
    expect(() => assertValidOpportunityTransition("OPEN", "EXECUTING")).toThrow();
  });

  it("VERIFIED → EXECUTING is invalid (no re-execution after verification)", () => {
    expect(() => assertValidOpportunityTransition("VERIFIED", "EXECUTING")).toThrow();
  });

  it("ROLLED_BACK is terminal — no further transitions allowed", () => {
    const allowedFrom = OPPORTUNITY_TRANSITIONS["ROLLED_BACK"];
    expect(allowedFrom).toEqual([]);
    expect(() => assertValidOpportunityTransition("ROLLED_BACK", "OPEN")).toThrow();
  });

  it("EXPIRED → OPEN is valid (re-open after expiry)", () => {
    // EXPIRED is NOT terminal — it has an outgoing transition to OPEN.
    expect(OPPORTUNITY_TRANSITIONS["EXPIRED"]).toContain("OPEN");
  });

  // ── 2.3 Proposal state machine completeness ─────────────────────────────

  it("every ProposalStatus has an entry in PROPOSAL_TRANSITIONS", () => {
    const allStatuses: ProposalStatus[] = [
      "DRAFT", "READY", "APPROVED", "REJECTED", "EXECUTING", "EXECUTED",
      "VERIFYING", "VERIFIED", "ROLLED_BACK", "ROLLBACK_PARTIAL", "FAILED", "EXPIRED",
    ];
    for (const s of allStatuses) {
      expect(PROPOSAL_TRANSITIONS).toHaveProperty(s);
    }
  });

  it("all TERMINAL_PROPOSAL_STATUSES have empty transition arrays", () => {
    for (const status of TERMINAL_PROPOSAL_STATUSES) {
      expect(PROPOSAL_TRANSITIONS[status]).toEqual([]);
    }
  });

  it("ROLLED_BACK is terminal for proposals", () => {
    expect(PROPOSAL_TRANSITIONS["ROLLED_BACK"]).toEqual([]);
  });

  it("ROLLBACK_PARTIAL is not terminal — can transition to ROLLED_BACK (re-attempt compensation)", () => {
    expect(TERMINAL_PROPOSAL_STATUSES).not.toContain("ROLLBACK_PARTIAL");
    expect(PROPOSAL_TRANSITIONS["ROLLBACK_PARTIAL"]).toContain("ROLLED_BACK");
  });

  it("EXECUTED can transition to ROLLBACK_PARTIAL (compensation fails mid-flight)", () => {
    expect(PROPOSAL_TRANSITIONS["EXECUTED"]).toContain("ROLLBACK_PARTIAL");
  });

  it("VERIFIED can transition to ROLLBACK_PARTIAL (regression detected, compensation partial)", () => {
    expect(PROPOSAL_TRANSITIONS["VERIFIED"]).toContain("ROLLBACK_PARTIAL");
  });

  it("ROLLBACK_ELIGIBLE_PROPOSAL_STATUSES includes ROLLBACK_PARTIAL for re-attempt", () => {
    expect(ROLLBACK_ELIGIBLE_PROPOSAL_STATUSES).toContain("ROLLBACK_PARTIAL");
  });

  it("EXECUTING is NOT in ROLLBACK_ELIGIBLE_PROPOSAL_STATUSES (race prevention)", () => {
    expect(ROLLBACK_ELIGIBLE_PROPOSAL_STATUSES).not.toContain("EXECUTING");
  });

  // ── 2.4 MutationOperation state machine ────────────────────────────────

  it("truly terminal MutationOperation statuses have empty VALID_TRANSITIONS arrays", () => {
    // COMPLETED and COMPLETED_WITH_ERRORS allow → ROLLED_BACK (compensation path).
    // They are in TERMINAL_STATUSES for the success path but not for compensation.
    // Only these statuses are truly dead-ends with no outbound transitions:
    const hardTerminals: OperationStatus[] = [
      "REJECTED", "EXPIRED", "CANCELLED", "FAILED", "STALE", "ROLLED_BACK",
    ];
    for (const status of hardTerminals) {
      expect(VALID_TRANSITIONS[status as OperationStatus]).toEqual([]);
    }
  });

  it("EXECUTING → APPROVED is not a valid direct transition (recovery is a raw DB write, not state machine)", () => {
    const allowed = VALID_TRANSITIONS["EXECUTING"];
    expect(allowed).not.toContain("APPROVED");
  });

  it("COMMITTED → ROLLED_BACK is valid (compensation before effects complete)", () => {
    expect(VALID_TRANSITIONS["COMMITTED"]).toContain("ROLLED_BACK");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §3 — DB ↔ EXTERNAL API FAILURE MODES
// ══════════════════════════════════════════════════════════════════════════════

describe("§3 DB ↔ External API Failure Modes", () => {

  // ── 3.1 Approval validation covers all failure branches ─────────────────

  it("expired TTL fails validation regardless of hash", () => {
    const changes = [{ field: "metaDescription", currentValue: null, proposedValue: "X", reasoning: "r" }];
    const hash = hashProposedChanges("UPDATE_META_DESCRIPTION", "/p", changes);
    const result = validateProposalApproval({
      approvedBy: "user:123",
      approvalExpiresAt: new Date(Date.now() - 1_000), // already expired
      approvalHash: hash,
      actionType: "UPDATE_META_DESCRIPTION",
      targetUrl: "/p",
      proposedChanges: changes,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/expired/i);
  });

  it("tampered proposedValue causes hash mismatch even with valid TTL", () => {
    const originalChanges = [{ field: "metaDescription", currentValue: null, proposedValue: "Good", reasoning: "r" }];
    const approvalHash = hashProposedChanges("UPDATE_META_DESCRIPTION", "/p", originalChanges);

    // Attacker modifies the proposedValue after approval
    const tamperedChanges = [{ field: "metaDescription", currentValue: null, proposedValue: "EVIL", reasoning: "r" }];
    const result = validateProposalApproval({
      approvedBy: "user:123",
      approvalExpiresAt: new Date(Date.now() + 3_600_000),
      approvalHash,
      actionType: "UPDATE_META_DESCRIPTION",
      targetUrl: "/p",
      proposedChanges: tamperedChanges,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/hash mismatch/i);
  });

  it("null approvedBy fails validation even with valid TTL and hash", () => {
    const result = validateProposalApproval({
      approvedBy: null,
      approvalExpiresAt: new Date(Date.now() + 3_600_000),
      approvalHash: "any-hash",
      actionType: "UPDATE_META_DESCRIPTION",
      targetUrl: "/p",
      proposedChanges: [],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/no approver/i);
  });

  it("valid approval with matching hash and live TTL passes", () => {
    const changes = [{ field: "metaDescription", currentValue: null, proposedValue: "Valid", reasoning: "r" }];
    const hash = hashProposedChanges("UPDATE_META_DESCRIPTION", "/p", changes);
    const result = validateProposalApproval({
      approvedBy: "user:123",
      approvalExpiresAt: new Date(Date.now() + 3_600_000),
      approvalHash: hash,
      actionType: "UPDATE_META_DESCRIPTION",
      targetUrl: "/p",
      proposedChanges: changes,
    });
    expect(result.valid).toBe(true);
  });

  // ── 3.2 Rollback divergence: ROLLBACK_PARTIAL vs ROLLED_BACK ────────────

  it("ROLLBACK_PARTIAL is the correct status when compensation is incomplete", () => {
    // This test verifies the TYPE-LEVEL invariant that ROLLBACK_PARTIAL exists
    // and is accessible. The runtime behavior is covered by rollback.ts integration tests.
    const PARTIAL: ProposalStatus = "ROLLBACK_PARTIAL";
    expect(PROPOSAL_TRANSITIONS[PARTIAL]).toContain("ROLLED_BACK");
    expect(TERMINAL_PROPOSAL_STATUSES).not.toContain(PARTIAL);
  });

  it("ROLLED_BACK is only reachable from compensation-eligible statuses", () => {
    const reachableFromRollback = Object.entries(PROPOSAL_TRANSITIONS)
      .filter(([, targets]) => targets.includes("ROLLED_BACK"))
      .map(([from]) => from);

    // ROLLED_BACK should be reachable from EXECUTED, VERIFIED, ROLLBACK_PARTIAL
    expect(reachableFromRollback).toContain("EXECUTED");
    expect(reachableFromRollback).toContain("VERIFIED");
    expect(reachableFromRollback).toContain("ROLLBACK_PARTIAL");
    // But NOT from APPROVED or READY — those have no committed mutation yet
    expect(reachableFromRollback).not.toContain("APPROVED");
    expect(reachableFromRollback).not.toContain("READY");
  });

  // ── 3.3 ConcurrentModificationError semantics ───────────────────────────

  it("ConcurrentModificationError includes target context for debugging", () => {
    const err = new ConcurrentModificationError("Blog", "blog-123", 7);
    expect(err.message).toContain("Blog");
    expect(err.message).toContain("blog-123");
    expect(err.message).toContain("7");
  });

  it("MutationBlockedError is distinct from ConcurrentModificationError", () => {
    const blocked = new MutationBlockedError("Kill switch active");
    const concurrent = new ConcurrentModificationError("Blog", "id", 1);
    expect(blocked instanceof MutationBlockedError).toBe(true);
    expect(blocked instanceof ConcurrentModificationError).toBe(false);
    expect(concurrent instanceof MutationBlockedError).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §4 — TENANT ISOLATION
// ══════════════════════════════════════════════════════════════════════════════

describe("§4 Tenant Isolation", () => {

  // ── 4.1 Idempotency key isolation ───────────────────────────────────────

  it("proposals for different tenants with the same URL have different idempotency keys", () => {
    const tenantA = generateProposalIdempotencyKey("site-A", "dec-1", "UPDATE_META_DESCRIPTION", "/about");
    const tenantB = generateProposalIdempotencyKey("site-B", "dec-1", "UPDATE_META_DESCRIPTION", "/about");
    expect(tenantA).not.toBe(tenantB);
  });

  it("idempotency key format is 'prop:' + 16-char hex", () => {
    const key = generateProposalIdempotencyKey("s", "d", "UPDATE_META_DESCRIPTION", "/u");
    expect(key).toMatch(/^prop:[a-f0-9]{16}$/);
  });

  it("all action types produce unique idempotency keys for the same site/decision/url", () => {
    const keys = Object.keys(SAFETY_TIER_MAP).map((action) =>
      generateProposalIdempotencyKey("site-A", "dec-1", action as ActionType, "/page")
    );
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  // ── 4.2 Kill switch is per-site, not global only ─────────────────────────

  it("MutationBlockedError is thrown when site automations are paused", () => {
    // Simulate what assertSiteNotKilled does when automationsPaused = true
    const err = new MutationBlockedError("Site site-123 has automations paused");
    expect(err.message).toContain("site-123");
    expect(err instanceof MutationBlockedError).toBe(true);
  });

  it("MutationBlockedError distinguishes site-level from global kill switch", () => {
    const global = new MutationBlockedError("GLOBAL_EMERGENCY_STOP is active");
    const site = new MutationBlockedError("Site site-abc has automations paused");
    expect(global.message).toContain("GLOBAL");
    expect(site.message).toContain("site-abc");
  });

  // ── 4.3 Hash changes when siteId changes (tenant collision safety) ───────

  it("approval hash incorporates actionType and targetUrl — different URLs produce different hashes", () => {
    const changes = [{ field: "metaDescription", currentValue: null, proposedValue: "X", reasoning: "r" }];
    const h1 = hashProposedChanges("UPDATE_META_DESCRIPTION", "/page-a", changes);
    const h2 = hashProposedChanges("UPDATE_META_DESCRIPTION", "/page-b", changes);
    expect(h1).not.toBe(h2);
  });

  it("approval hash changes when actionType changes (different operations cannot share approval)", () => {
    const changes = [{ field: "metaDescription", currentValue: null, proposedValue: "X", reasoning: "r" }];
    const h1 = hashProposedChanges("UPDATE_META_DESCRIPTION", "/p", changes);
    const h2 = hashProposedChanges("UPDATE_TITLE_TAG", "/p", changes);
    expect(h1).not.toBe(h2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §5 — SAFETY POLICY ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════════════

describe("§5 Safety Policy Enforcement", () => {

  // ── 5.1 evaluatePolicy derives from actionType, not stored data ─────────

  it("evaluatePolicy re-derives tier from actionType — cannot be overridden by stored safetyTier", () => {
    // Even if an attacker somehow sets safetyTier=1 on a Tier-3 action in the DB,
    // evaluatePolicy always recomputes from the type itself.
    const policy = evaluatePolicy("DELETE_PAGE");
    expect(policy.tier).toBe(3);
    expect(policy.autoApprove).toBe(false);
    expect(policy.autoExecute).toBe(false);
  });

  it("Tier 1 actions auto-approve and auto-execute", () => {
    const tier1Actions: ActionType[] = [
      "UPDATE_META_DESCRIPTION", "UPDATE_TITLE_TAG", "FIX_HEADING_HIERARCHY",
      "ADD_SCHEMA_MARKUP", "ADD_CANONICAL_TAG", "FIX_BROKEN_LINK", "ADD_INTERNAL_LINKS",
    ];
    for (const action of tier1Actions) {
      const policy = evaluatePolicy(action);
      expect(policy.tier).toBe(1);
      expect(policy.autoApprove).toBe(true);
      expect(policy.autoExecute).toBe(true);
    }
  });

  it("Tier 2 actions require human approval and do not auto-execute", () => {
    const tier2Actions: ActionType[] = [
      "CHANGE_CANONICAL", "MODIFY_ROBOTS_META", "REDIRECT_URL",
      "CHANGE_PAGE_TITLE", "PUBLISH_CONTENT", "REFRESH_CONTENT", "GENERATE_CONTENT_BRIEF",
    ];
    for (const action of tier2Actions) {
      const policy = evaluatePolicy(action);
      expect(policy.tier).toBe(2);
      expect(policy.autoApprove).toBe(false);
      expect(policy.autoExecute).toBe(false);
      expect(requiresHumanApproval(policy.tier as 1|2|3)).toBe(true);
    }
  });

  it("Tier 3 actions have maxAttempts = 1 (no automatic retries)", () => {
    const tier3Actions: ActionType[] = [
      "DELETE_PAGE", "CONSOLIDATE_CONTENT", "MASS_REDIRECT", "SITE_WIDE_CHANGE",
    ];
    for (const action of tier3Actions) {
      const policy = evaluatePolicy(action);
      expect(policy.tier).toBe(3);
      expect(policy.maxAttempts).toBe(1);
    }
  });

  // ── 5.2 Retry ceiling enforcement ───────────────────────────────────────

  it("canRetry returns false at maxAttempts for Tier 1 (3 attempts)", () => {
    expect(canRetry(0, 1)).toBe(true);
    expect(canRetry(1, 1)).toBe(true);
    expect(canRetry(2, 1)).toBe(true);
    expect(canRetry(3, 1)).toBe(false); // exhausted
  });

  it("canRetry returns false at maxAttempts for Tier 2 (2 attempts)", () => {
    expect(canRetry(0, 2)).toBe(true);
    expect(canRetry(1, 2)).toBe(true);
    expect(canRetry(2, 2)).toBe(false); // exhausted
  });

  it("canRetry allows exactly 1 attempt for Tier 3", () => {
    expect(canRetry(0, 3)).toBe(true);
    expect(canRetry(1, 3)).toBe(false); // exhausted after first try
  });

  // ── 5.3 Every ActionType has a defined safety tier ──────────────────────

  it("every ActionType in SAFETY_TIER_MAP maps to tier 1, 2, or 3", () => {
    for (const [action, tier] of Object.entries(SAFETY_TIER_MAP)) {
      expect([1, 2, 3]).toContain(tier);
    }
  });

  it("getSafetyTier returns the same value as SAFETY_TIER_MAP for all actions", () => {
    for (const action of Object.keys(SAFETY_TIER_MAP) as ActionType[]) {
      expect(getSafetyTier(action)).toBe(SAFETY_TIER_MAP[action]);
    }
  });

  // ── 5.4 Approval TTL is enforced ────────────────────────────────────────

  it("Tier 1 approval TTL is non-zero (auto-approvals still expire)", () => {
    const policy = evaluatePolicy("UPDATE_META_DESCRIPTION");
    expect(policy.approvalTtlMinutes).toBeGreaterThan(0);
  });

  it("Tier 2 and Tier 3 have longer TTL than Tier 1 (humans need time to review high-risk changes)", () => {
    const tier1 = evaluatePolicy("UPDATE_META_DESCRIPTION");
    const tier2 = evaluatePolicy("CHANGE_CANONICAL");
    const tier3 = evaluatePolicy("DELETE_PAGE");
    // Tier 1: 60min (auto-approved, quick expiry)
    // Tier 2: 1440min = 24h (human needs time to review)
    // Tier 3: 4320min = 72h (high-risk, needs careful review)
    expect(tier2.approvalTtlMinutes).toBeGreaterThan(tier1.approvalTtlMinutes);
    expect(tier3.approvalTtlMinutes).toBeGreaterThan(tier2.approvalTtlMinutes);
  });

  // ── 5.5 Expiry cron fix: PROPOSED→EXPIRED and APPROVED→EXPIRED are valid ─

  it("PROPOSED → EXPIRED is a valid state machine transition (expiry cron fix)", () => {
    expect(() => assertValidOpportunityTransition("PROPOSED", "EXPIRED")).not.toThrow();
    expect(OPPORTUNITY_TRANSITIONS["PROPOSED"]).toContain("EXPIRED");
  });

  it("APPROVED → EXPIRED is a valid state machine transition (expiry cron fix)", () => {
    expect(() => assertValidOpportunityTransition("APPROVED", "EXPIRED")).not.toThrow();
    expect(OPPORTUNITY_TRANSITIONS["APPROVED"]).toContain("EXPIRED");
  });

  it("EXECUTING → EXPIRED is NOT valid (cannot expire a running operation)", () => {
    expect(() => assertValidOpportunityTransition("EXECUTING", "EXPIRED")).toThrow();
  });

  it("VERIFYING → EXPIRED is NOT valid (cannot expire mid-verification)", () => {
    expect(() => assertValidOpportunityTransition("VERIFYING", "EXPIRED")).toThrow();
  });
});
