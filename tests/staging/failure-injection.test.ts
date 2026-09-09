/**
 * D.8.1.5 — Failure Injection
 *
 * Proves system resilience and deterministic state transitions
 * when failures are injected into D.3 planning, D.4 LLM enhancement,
 * action execution, and retry handling.
 *
 * Test scenarios:
 *   §1.1 — Non-existent opportunity → REJECT, no proposal persisted
 *   §1.2 — Missing evidence → DEFER, opportunity OPEN, no proposal
 *   §2.1 — LLM adapter failure → FALLBACK, D.3 template preserved, DRAFT proposal
 *   §2.2 — Evidence shift during LLM → DEFER, stale LLM result discarded
 *   §3.1 — Target resource missing → FAILED, error recorded, no mutation
 *   §3.2 — Kill switch active → BLOCKED result, FAILED persisted state, no mutation
 *   §4   — Retry ceiling exhausted → RetryChainExhaustedError, retryCount unchanged
 *
 * Assertion philosophy:
 *   Every scenario asserts BOTH return/result values AND database-side state.
 *   This proves the state-machine contract is preserved under failure, not just
 *   that the right value was returned.
 *
 * Classification: INTEGRATION / LIVE_DB + MOCKED (§2, §3.2)
 *
 * Guard: D8_LIVE_DB=true + assertStagingDatabase()
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { planOpportunity, loadPlanningInput } from "@/lib/planning/planner";
import { hashScoringEvidence } from "@/lib/scoring/evidence-fencing";
import type { ScoringInput } from "@/lib/scoring/types";
import { runAction } from "@/lib/proposals/action-runner";
import { retryProposal } from "@/lib/proposals/retry";
import { RetryChainExhaustedError } from "@/lib/proposals/types";
import { hashProposedChanges } from "@/lib/proposals/safety-policy";
import {
  assertStagingDatabase,
  isLiveDbAvailable,
  makeTestContext,
  seedUser,
  seedSite,
  seedOpportunity,
  seedFinding,
  seedScoreRecord,
  seedAllocation,
  seedProposal,
  cleanupContext,
  assertNoProposal,
  assertOpportunityStatus,
  type TestContext,
} from "../harness";

// ── Guard ────────────────────────────────────────────────────────────────────

const SKIP = !isLiveDbAvailable();

// ── Helper: Seed a fully planning-eligible opportunity ────────────────────────
// Follows the exact evidence-hash pattern proven in D.8.1.4 §1.
// Creates: user → site → OPEN opportunity → finding → PROMOTE score → SELECTED allocation

async function seedPlanningEligible(
  ctx: TestContext,
  suffix: string
): Promise<string> {
  await seedUser(prisma as any, ctx.userId);
  await seedSite(prisma as any, ctx.siteId, ctx.userId);

  const opportunityId = await seedOpportunity(prisma as any, ctx, {
    opportunityId: ctx.id(`opp-${suffix}`),
  });

  await seedFinding(prisma as any, ctx, opportunityId, {
    agentRunId: ctx.id(`run-${suffix}`),
    findingId: ctx.id(`finding-${suffix}`),
  });

  // Compute the evidence hash matching what the planning fence will recompute
  const planningInput = await loadPlanningInput(opportunityId);
  const evidenceHash = hashScoringEvidence({
    opportunityId,
    siteId: ctx.siteId,
    url: planningInput!.opportunity.url,
    primaryKeyword: planningInput!.opportunity.primaryKeyword,
    category: planningInput!.opportunity.category,
    action: planningInput!.opportunity.action,
    discoveryConfidence: planningInput!.opportunity.discoveryConfidence,
    expiresAt: planningInput!.opportunity.expiresAt,
    lastRefreshedAt: null,
    primaryDiscoverySource: "GSC",
    evidenceItems: planningInput!.evidence.map((e) => ({
      sourceType: e.sourceType,
      metric: e.metric,
      value: e.value,
      observedAt: e.observedAt,
    })),
    existingScore: null,
    metadata: {},
  } as ScoringInput);

  const scoreId = await seedScoreRecord(prisma as any, opportunityId, {
    scoreRecordId: ctx.id(`score-${suffix}`),
    evidenceHash,
  });

  await seedAllocation(prisma as any, ctx, opportunityId, scoreId, {
    evidenceHash,
  });

  return opportunityId;
}

// ══════════════════════════════════════════════════════════════════════════════
// §1.1 — Non-existent Opportunity → REJECT
//
// planOpportunity("__nonexistent__") must:
//   - Return decision === "REJECT"
//   - Return null plan and proposal
//   - NOT persist any ActionProposal
//
// This proves NOT_FOUND is a terminal rejection with zero side effects.
// ══════════════════════════════════════════════════════════════════════════════

describe.skipIf(SKIP)("§1.1 Non-existent opportunity → REJECT", () => {
  let result: any;
  const fabricatedId = `__d8-nonexistent-opp-${Date.now()}`;

  beforeAll(async () => {
    assertStagingDatabase();
    result = await planOpportunity(fabricatedId);
  }, 30_000);

  it("1.1.1 returns REJECT decision with null plan and proposal", () => {
    expect(result.decision).toBe("REJECT");
    expect(result.plan).toBeNull();
    expect(result.proposalId).toBeNull();
    expect(result.proposalStatus).toBeNull();
  });

  it("1.1.2 no ActionProposal persisted in DB", async () => {
    const count = await (prisma as any).actionProposal.count({
      where: { decisionId: fabricatedId },
    });
    expect(count).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §1.2 — Missing Evidence → DEFER
//
// Seed an OPEN opportunity with a PROMOTE score but NO evidence chain.
// The validator fires NO_EVIDENCE → DEFER before any planning occurs.
//
// Proves:
//   - DEFER is returned (not REJECT)
//   - Opportunity remains OPEN (not mutated)
//   - No ActionProposal created
// ══════════════════════════════════════════════════════════════════════════════

describe.skipIf(SKIP)("§1.2 Missing evidence → DEFER", () => {
  const ctx: TestContext = makeTestContext("fi-noevidence");
  let opportunityId: string;
  let result: any;

  beforeAll(async () => {
    assertStagingDatabase();

    // Seed user → site → OPEN opportunity → PROMOTE score (NO findings/evidence)
    await seedUser(prisma as any, ctx.userId);
    await seedSite(prisma as any, ctx.siteId, ctx.userId);

    opportunityId = await seedOpportunity(prisma as any, ctx, {
      opportunityId: ctx.id("opp-noev"),
    });

    // Seed score record (PROMOTE) so only NO_EVIDENCE fires, not NO_SCORE_RECORD
    await seedScoreRecord(prisma as any, opportunityId, {
      scoreRecordId: ctx.id("score-noev"),
    });

    result = await planOpportunity(opportunityId);
  }, 30_000);

  afterAll(async () => {
    await cleanupContext(prisma as any, ctx);
  }, 30_000);

  it("1.2.1 returns DEFER decision with NO_EVIDENCE reason", () => {
    expect(result.decision).toBe("DEFER");
    expect(result.plan).toBeNull();
    expect(result.proposalId).toBeNull();
    const rules = result.reasons.map((r: any) => r.rule);
    expect(rules).toContain("NO_EVIDENCE");
  });

  it("1.2.2 opportunity status remains OPEN — no mutation", async () => {
    await assertOpportunityStatus(prisma as any, opportunityId, "OPEN");
  });

  it("1.2.3 no ActionProposal persisted", async () => {
    await assertNoProposal(prisma as any, opportunityId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2.1 — LLM Adapter Failure → FALLBACK → DRAFT Proposal
//
// Fully planning-eligible opportunity with mocked LLM boundary that returns
// outcome "FALLBACK". The planner must:
//   - Use D.3 template changes (not LLM output)
//   - Still create a DRAFT proposal
//   - Persist the template changes, not the LLM result
//
// Mock: enhancePlanWithLLM → { outcome: "FALLBACK", ... }
// ══════════════════════════════════════════════════════════════════════════════

describe.skipIf(SKIP)("§2.1 LLM adapter failure → FALLBACK → DRAFT proposal", () => {
  const ctx: TestContext = makeTestContext("fi-fallback");
  let opportunityId: string;
  let result: any;

  beforeAll(async () => {
    assertStagingDatabase();

    // 1. Seed fully planning-eligible opportunity
    opportunityId = await seedPlanningEligible(ctx, "fallback");

    // 2. Mock LLM boundary: simulate adapter failure → FALLBACK
    //    The mock captures templateChanges (3rd arg) and returns them unchanged,
    //    which is what the real FALLBACK path does.
    vi.doMock("@/lib/llm-boundary", () => ({
      enhancePlanWithLLM: async (
        _plan: any,
        _input: any,
        templateChanges: any[]
      ) => ({
        outcome: "FALLBACK" as const,
        changes: [...templateChanges],
        audit: { fallback: true, reason: "injected-failure", modelId: "mock" },
        reason: "Injected LLM adapter failure",
      }),
    }));

    vi.doMock("@/lib/logger", () => ({
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
    }));

    // 3. Reset module registry so dynamic import of planner picks up mocked LLM
    vi.resetModules();
    const { planOpportunity: planWithMockedLLM } = await import(
      "@/lib/planning/planner"
    );

    // 4. Execute planning with mocked LLM
    result = await planWithMockedLLM(opportunityId);
  }, 60_000);

  afterAll(async () => {
    await cleanupContext(prisma as any, ctx);
    vi.doUnmock("@/lib/llm-boundary");
    vi.doUnmock("@/lib/logger");
  }, 30_000);

  it("2.1.1 returns PLAN decision — D.3 fallback succeeded", () => {
    expect(result.decision).toBe("PLAN");
    expect(result.proposalId).not.toBeNull();
    // DraftProposalResult.status is "CREATED" (DB status is DRAFT)
    expect(result.proposalStatus).toBe("CREATED");
  });

  it("2.1.2 persisted proposal has status DRAFT", async () => {
    const proposal = await (prisma as any).actionProposal.findUnique({
      where: { id: result.proposalId },
      select: { status: true, generatedBy: true },
    });
    expect(proposal).not.toBeNull();
    expect(proposal.status).toBe("DRAFT");
    // Verify it was generated by D.3 planner, not LLM
    expect(proposal.generatedBy).toMatch(/^system:d3-planner/);
  });

  it("2.1.3 persisted proposal contains exact D.3 template changes", async () => {
    // Reconstruct D.3 template changes from the returned plan's rationale
    // This is the same computation planner.ts does at line 301-306
    const expectedTemplateChanges = result.plan!.rationale.map((r: any) => ({
      field: r.rule,
      currentValue: null,
      proposedValue: r.details,
      reasoning: r.details,
    }));

    const proposal = await (prisma as any).actionProposal.findUnique({
      where: { id: result.proposalId },
      select: { proposedChanges: true },
    });

    // Deep equality proves the persisted changes are D.3 template, not LLM output
    expect(proposal.proposedChanges).toEqual(expectedTemplateChanges);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2.2 — Evidence Shift During LLM → DEFER → No Proposal
//
// Fully planning-eligible opportunity with mocked LLM boundary that returns
// outcome "DEFER" (simulating evidence change during the LLM latency window).
//
// The planner must:
//   - Return DEFER (not PLAN or REJECT)
//   - NOT persist any ActionProposal (stale LLM result discarded)
//   - NOT mutate opportunity status
//
// Mock: enhancePlanWithLLM → { outcome: "DEFER", ... }
// ══════════════════════════════════════════════════════════════════════════════

describe.skipIf(SKIP)("§2.2 Evidence shift during LLM → DEFER", () => {
  const ctx: TestContext = makeTestContext("fi-llm-defer");
  let opportunityId: string;
  let result: any;

  beforeAll(async () => {
    assertStagingDatabase();

    // 1. Seed fully planning-eligible opportunity
    opportunityId = await seedPlanningEligible(ctx, "llm-defer");

    // 2. Mock LLM boundary: simulate evidence shift → DEFER
    //    The real path: evidence hash changes between LLM call start and end
    vi.doMock("@/lib/llm-boundary", () => ({
      enhancePlanWithLLM: async () => ({
        outcome: "DEFER" as const,
        changes: [],
        audit: null,
        reason: "Evidence changed during LLM call window",
      }),
    }));

    vi.doMock("@/lib/logger", () => ({
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
    }));

    // 3. Reset module registry so planner re-evaluates with mock
    vi.resetModules();
    const { planOpportunity: planWithDeferLLM } = await import(
      "@/lib/planning/planner"
    );

    // 4. Execute planning
    result = await planWithDeferLLM(opportunityId);
  }, 60_000);

  afterAll(async () => {
    await cleanupContext(prisma as any, ctx);
    vi.doUnmock("@/lib/llm-boundary");
    vi.doUnmock("@/lib/logger");
  }, 30_000);

  it("2.2.1 returns DEFER decision with EVIDENCE_CHANGED_DURING_LLM reason", () => {
    expect(result.decision).toBe("DEFER");
    expect(result.proposalId).toBeNull();
    expect(result.plan).toBeNull();
    const rules = result.reasons.map((r: any) => r.rule);
    expect(rules).toContain("EVIDENCE_CHANGED_DURING_LLM");
  });

  it("2.2.2 no ActionProposal persisted — stale LLM result discarded", async () => {
    await assertNoProposal(prisma as any, opportunityId);
  });

  it("2.2.3 opportunity status remains OPEN — no mutation", async () => {
    await assertOpportunityStatus(prisma as any, opportunityId, "OPEN");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §3.1 — Target Resource Not Found → FAILED
//
// Seed an APPROVED proposal whose targetId points to a non-existent Blog.
// resolveTargetEntity() returns null → throws → handleExecutionFailure().
//
// Proves:
//   - Execution result status === "FAILED"
//   - Error message contains "not found"
//   - Proposal transitions APPROVED → EXECUTING → FAILED (in DB)
//   - Opportunity transitions APPROVED → EXECUTING → FAILED (in DB)
//   - No MutationOperation created (null operationId)
// ══════════════════════════════════════════════════════════════════════════════

describe.skipIf(SKIP)("§3.1 Target resource missing → execution FAILED", () => {
  const ctx: TestContext = makeTestContext("fi-target-missing");
  let opportunityId: string;
  let proposalId: string;
  let execResult: any;

  beforeAll(async () => {
    assertStagingDatabase();

    await seedUser(prisma as any, ctx.userId);
    await seedSite(prisma as any, ctx.siteId, ctx.userId);

    // Opportunity must be APPROVED for the transition to EXECUTING
    opportunityId = await seedOpportunity(prisma as any, ctx, {
      opportunityId: ctx.id("opp-tgt"),
      opportunityStatus: "APPROVED",
    });

    // Create an APPROVED proposal targeting a Blog that does NOT exist.
    // Compute the approval hash so validateProposalApproval() passes.
    proposalId = ctx.id("proposal-tgt");
    const targetUrl = `https://${ctx.siteId}.d8-test.local/page`;
    const proposedChanges = [
      {
        field: "metaDescription",
        currentValue: "old",
        proposedValue: "new meta for D8 target-missing test",
        reasoning: "D8 failure injection test",
      },
    ];
    const approvalHash = hashProposedChanges(
      "UPDATE_META_DESCRIPTION",
      targetUrl,
      proposedChanges
    );
    const now = new Date();

    await (prisma as any).actionProposal.create({
      data: {
        id: proposalId,
        siteId: ctx.siteId,
        decisionId: opportunityId,
        idempotencyKey: `op:${ctx.siteId}:${opportunityId}:UPDATE_META_DESCRIPTION:fi-tgt`,
        actionType: "UPDATE_META_DESCRIPTION",
        targetUrl,
        targetModel: "Blog",
        targetId: ctx.id("nonexistent-blog"), // No Blog exists with this ID
        proposedChanges,
        expectedOutcome: "Test",
        riskLevel: "LOW",
        safetyTier: 1,
        confidence: 0.85,
        status: "APPROVED",
        requiresApproval: false,
        attemptCount: 0,
        maxAttempts: 3,
        approvedBy: "system:auto-policy",
        approvedAt: now,
        approvalExpiresAt: new Date(now.getTime() + 3600_000),
        approvalHash,
        generatedBy: "system:d8-test",
        verificationCriteria: [],
      },
    });

    // Execute
    execResult = await runAction({ proposalId });
  }, 60_000);

  afterAll(async () => {
    await cleanupContext(prisma as any, ctx);
  }, 30_000);

  it("3.1.1 execution returns FAILED with target-not-found error", () => {
    expect(execResult.status).toBe("FAILED");
    expect(execResult.error).toContain("not found");
    expect(execResult.operationId).toBeNull();
  });

  it("3.1.2 proposal transitions to FAILED with error recorded in DB", async () => {
    const proposal = await (prisma as any).actionProposal.findUnique({
      where: { id: proposalId },
      select: { status: true, lastAttemptError: true, completedAt: true },
    });
    expect(proposal.status).toBe("FAILED");
    expect(proposal.lastAttemptError).toContain("not found");
    expect(proposal.completedAt).not.toBeNull();
  });

  it("3.1.3 opportunity transitions to FAILED", async () => {
    await assertOpportunityStatus(prisma as any, opportunityId, "FAILED");
  });

  it("3.1.4 no MutationOperation created — failure before createOperation()", async () => {
    const proposal = await (prisma as any).actionProposal.findUnique({
      where: { id: proposalId },
      select: { operationId: true },
    });
    expect(proposal.operationId).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §3.2 — Kill Switch Active → BLOCKED Result, FAILED State
//
// Seed an APPROVED proposal targeting a REAL Blog entity, then mock
// createOperation() to throw MutationBlockedError.
//
// Proves the distinction between:
//   - Execution result status === "BLOCKED" (returned to caller)
//   - Proposal persisted status === "FAILED" (in DB)
//   - Opportunity persisted status === "FAILED" (in DB)
//   - No MutationOperation created (kill switch prevented mutation)
//
// Mock: createOperation → throws MutationBlockedError
// ══════════════════════════════════════════════════════════════════════════════

describe.skipIf(SKIP)("§3.2 Kill switch → execution BLOCKED", () => {
  const ctx: TestContext = makeTestContext("fi-killswitch");
  let opportunityId: string;
  let proposalId: string;
  let blogId: string;
  let execResult: any;

  beforeAll(async () => {
    assertStagingDatabase();

    await seedUser(prisma as any, ctx.userId);
    await seedSite(prisma as any, ctx.siteId, ctx.userId);

    // Opportunity must be APPROVED
    opportunityId = await seedOpportunity(prisma as any, ctx, {
      opportunityId: ctx.id("opp-ks"),
      opportunityStatus: "APPROVED",
    });

    // Seed a real Blog for resolveTargetEntity() to find
    blogId = ctx.id("blog-ks");
    await (prisma as any).blog.create({
      data: {
        id: blogId,
        siteId: ctx.siteId,
        pipelineType: "STANDARD",
        title: "D8 Kill Switch Test Blog",
        slug: `d8-ks-${ctx.prefix}`,
        content: "Test content for kill switch failure injection",
        status: "PUBLISHED",
        version: 1,
      },
    });

    // Create APPROVED proposal targeting the real Blog
    proposalId = ctx.id("proposal-ks");
    const targetUrl = `https://${ctx.siteId}.d8-test.local/page`;
    const proposedChanges = [
      {
        field: "metaDescription",
        currentValue: "old",
        proposedValue: "new meta for D8 kill switch test",
        reasoning: "D8 failure injection test",
      },
    ];
    const approvalHash = hashProposedChanges(
      "UPDATE_META_DESCRIPTION",
      targetUrl,
      proposedChanges
    );
    const now = new Date();

    await (prisma as any).actionProposal.create({
      data: {
        id: proposalId,
        siteId: ctx.siteId,
        decisionId: opportunityId,
        idempotencyKey: `op:${ctx.siteId}:${opportunityId}:UPDATE_META_DESCRIPTION:fi-ks`,
        actionType: "UPDATE_META_DESCRIPTION",
        targetUrl,
        targetModel: "Blog",
        targetId: blogId, // Points to real Blog
        proposedChanges,
        expectedOutcome: "Test",
        riskLevel: "LOW",
        safetyTier: 1,
        confidence: 0.85,
        status: "APPROVED",
        requiresApproval: false,
        attemptCount: 0,
        maxAttempts: 3,
        approvedBy: "system:auto-policy",
        approvedAt: now,
        approvalExpiresAt: new Date(now.getTime() + 3600_000),
        approvalHash,
        generatedBy: "system:d8-test",
        verificationCriteria: [],
      },
    });

    // Mock createOperation to throw MutationBlockedError.
    // Uses importOriginal to preserve all other exports (especially
    // MutationBlockedError class for instanceof checks in action-runner).
    vi.doMock("@/lib/mutations", async (importOriginal) => {
      const actual = (await importOriginal()) as any;
      return {
        ...actual,
        createOperation: async () => {
          throw new actual.MutationBlockedError("Kill switch active");
        },
      };
    });

    vi.doMock("@/lib/logger", () => ({
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
    }));

    // Get fresh action-runner with mocked createOperation
    vi.resetModules();
    const { runAction: runWithKillSwitch } = await import(
      "@/lib/proposals/action-runner"
    );

    execResult = await runWithKillSwitch({ proposalId });
  }, 60_000);

  afterAll(async () => {
    // Clean up Blog (not covered by cleanupContext)
    try {
      await (prisma as any).blog.deleteMany({ where: { siteId: ctx.siteId } });
    } catch { /* safe */ }
    await cleanupContext(prisma as any, ctx);
    vi.doUnmock("@/lib/mutations");
    vi.doUnmock("@/lib/logger");
  }, 30_000);

  it("3.2.1 execution returns BLOCKED status (not FAILED)", () => {
    expect(execResult.status).toBe("BLOCKED");
    expect(execResult.error).toContain("Kill switch");
    expect(execResult.operationId).toBeNull();
  });

  it("3.2.2 proposal persisted as FAILED with kill-switch error recorded", async () => {
    const proposal = await (prisma as any).actionProposal.findUnique({
      where: { id: proposalId },
      select: { status: true, lastAttemptError: true, completedAt: true },
    });
    // Distinction: result.status is BLOCKED, but DB proposal.status is FAILED
    expect(proposal.status).toBe("FAILED");
    expect(proposal.lastAttemptError).toContain("Kill switch");
    expect(proposal.completedAt).not.toBeNull();
  });

  it("3.2.3 opportunity transitions to FAILED", async () => {
    await assertOpportunityStatus(prisma as any, opportunityId, "FAILED");
  });

  it("3.2.4 no MutationOperation created — kill switch prevented mutation", async () => {
    const proposal = await (prisma as any).actionProposal.findUnique({
      where: { id: proposalId },
      select: { operationId: true },
    });
    expect(proposal.operationId).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §4 — Retry Ceiling Exhausted → RetryChainExhaustedError
//
// Seed an opportunity with proposalRetryCount === maxProposalRetries (3/3)
// and a FAILED proposal. retryProposal() must:
//   - Throw RetryChainExhaustedError (not return a result)
//   - NOT create any new ActionProposal
//   - NOT increment proposalRetryCount
//
// This proves the ceiling is a hard wall, not a soft limit.
// ══════════════════════════════════════════════════════════════════════════════

describe.skipIf(SKIP)("§4 Retry ceiling exhausted → RetryChainExhaustedError", () => {
  const ctx: TestContext = makeTestContext("fi-retry");
  let opportunityId: string;
  let failedProposalId: string;
  let caughtError: Error | null = null;

  beforeAll(async () => {
    assertStagingDatabase();

    await seedUser(prisma as any, ctx.userId);
    await seedSite(prisma as any, ctx.siteId, ctx.userId);

    // Seed opportunity in FAILED status
    opportunityId = await seedOpportunity(prisma as any, ctx, {
      opportunityId: ctx.id("opp-retry"),
      opportunityStatus: "FAILED",
    });

    // Set retry ceiling as exhausted: 3/3
    await (prisma as any).growthDecision.update({
      where: { id: opportunityId },
      data: {
        proposalRetryCount: 3,
        maxProposalRetries: 3,
      },
    });

    // Seed a FAILED proposal linked to the opportunity
    failedProposalId = await seedProposal(prisma as any, ctx, opportunityId, {
      proposalId: ctx.id("proposal-retry"),
      status: "FAILED",
    });

    // Attempt retry — should throw
    try {
      await retryProposal({
        failedProposalId,
        actorId: "system:d8-test",
      });
    } catch (err) {
      caughtError = err as Error;
    }
  }, 60_000);

  afterAll(async () => {
    await cleanupContext(prisma as any, ctx);
  }, 30_000);

  it("4.1 throws RetryChainExhaustedError with correct ceiling", () => {
    expect(caughtError).not.toBeNull();
    expect(caughtError).toBeInstanceOf(RetryChainExhaustedError);
    expect((caughtError as RetryChainExhaustedError).maxRetries).toBe(3);
    expect((caughtError as RetryChainExhaustedError).decisionId).toBe(
      opportunityId
    );
  });

  it("4.2 no new ActionProposal created — only the original FAILED proposal remains", async () => {
    const proposals = await (prisma as any).actionProposal.findMany({
      where: { decisionId: opportunityId },
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].id).toBe(failedProposalId);
    expect(proposals[0].status).toBe("FAILED");
  });

  it("4.3 proposalRetryCount remains unchanged at ceiling", async () => {
    const opp = await (prisma as any).growthDecision.findUnique({
      where: { id: opportunityId },
      select: { proposalRetryCount: true, maxProposalRetries: true },
    });
    expect(opp.proposalRetryCount).toBe(3);
    expect(opp.maxProposalRetries).toBe(3);
  });
});
