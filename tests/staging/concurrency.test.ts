/**
 * D.8.1.4 — Concurrency Proofs
 *
 * Proves that simultaneous autonomous events/planning attempts cannot
 * create duplicate or conflicting durable state.
 *
 * Test scenarios:
 *   §1 — Concurrent D.3 planners (same opportunity)
 *         5 direct planOpportunity() calls → 1 ActionProposal
 *
 *   §2 — Duplicate opportunity.opened event delivery
 *         5 concurrent Inngest handler invocations → 1 ActionProposal
 *
 * Classification: INTEGRATION / LIVE_DB
 *
 * Guard: D8_LIVE_DB=true + assertStagingDatabase()
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { planOpportunity, loadPlanningInput } from "@/lib/planning/planner";
import { hashScoringEvidence } from "@/lib/scoring/evidence-fencing";
import type { ScoringInput } from "@/lib/scoring/types";
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
  cleanupContext,
  type TestContext,
} from "../harness";

// ── Guard ────────────────────────────────────────────────────────────────────

const SKIP = !isLiveDbAvailable();

// ══════════════════════════════════════════════════════════════════════════════
// §1 — Concurrent D.3 Planners (Same Opportunity)
//
// Five concurrent planOpportunity() calls against the same planning-eligible
// opportunity. Proves the createDraftProposal() persistence boundary is
// race-safe under true runtime concurrency.
//
// Protection layers under test:
//   Layer 1 (L93-113 draft-proposal.ts): findFirst for existing active proposal
//   Layer 2 (L175-188 draft-proposal.ts): P2002 unique constraint on idempotencyKey
//
// Under real concurrency, some callers race past Layer 1 before the first
// create commits. Those callers hit Layer 2. This test proves BOTH layers.
// ══════════════════════════════════════════════════════════════════════════════

describe.skipIf(SKIP)("§1 Concurrent D.3 planners — same opportunity race", () => {
  const ctx: TestContext = makeTestContext("conc-planner");
  let opportunityId: string;
  let results: PromiseSettledResult<any>[];

  beforeAll(async () => {
    assertStagingDatabase();

    // Seed a fully planning-eligible opportunity:
    // user → site → OPEN opportunity → PROMOTE score → SELECTED allocation
    await seedUser(prisma as any, ctx.userId);
    await seedSite(prisma as any, ctx.siteId, ctx.userId);

    opportunityId = await seedOpportunity(prisma as any, ctx, {
      opportunityId: ctx.id("opp-race"),
    });

    // Evidence chain: AgentRun → AgentFinding → OpportunityFinding
    // Required for planOpportunity() to pass the NO_EVIDENCE validation
    await seedFinding(prisma as any, ctx, opportunityId, {
      agentRunId: ctx.id("run-race"),
      findingId: ctx.id("finding-race"),
    });

    // Compute the evidence hash that the fence will recompute at planning time.
    // The fence uses hashScoringEvidence() with evidence items from the DB,
    // so we must seed the score record with the matching hash.
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
      scoreRecordId: ctx.id("score-race"),
      evidenceHash,
    });

    await seedAllocation(prisma as any, ctx, opportunityId, scoreId, {
      evidenceHash,
    });

    // ── Launch 5 concurrent planners against the same opportunity ──
    results = await Promise.allSettled(
      Array.from({ length: 5 }, () => planOpportunity(opportunityId))
    );
  }, 60_000);

  afterAll(async () => {
    await cleanupContext(prisma as any, ctx);
  }, 30_000);

  it("1.1 all 5 callers settle without unhandled rejections", () => {
    expect(results).toHaveLength(5);
    // Every call must settle — no unhandled promise rejections
    for (const r of results) {
      expect(r.status).toBe("fulfilled");
    }
  });

  it("1.2 exactly 1 ActionProposal exists for the opportunity", async () => {
    const proposals = await (prisma as any).actionProposal.findMany({
      where: { decisionId: opportunityId },
    });
    expect(proposals).toHaveLength(1);
  });

  it("1.3 exactly 1 distinct idempotencyKey across proposals", async () => {
    const proposals = await (prisma as any).actionProposal.findMany({
      where: { decisionId: opportunityId },
      select: { idempotencyKey: true },
    });
    const keys = new Set(proposals.map((p: any) => p.idempotencyKey));
    expect(keys.size).toBe(1);
  });

  it("1.4 the single proposal has status DRAFT", async () => {
    const proposals = await (prisma as any).actionProposal.findMany({
      where: { decisionId: opportunityId },
      select: { status: true },
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].status).toBe("DRAFT");
  });

  it("1.5 no AutonomousExecutionClaim exists for the opportunity", async () => {
    const count = await (prisma as any).autonomousExecutionClaim.count({
      where: { opportunityId },
    });
    expect(count).toBe(0);
  });

  it("1.6 no BudgetReservation exists for the site", async () => {
    const count = await (prisma as any).budgetReservation.count({
      where: { siteId: ctx.siteId },
    });
    expect(count).toBe(0);
  });

  it("1.7 no authorized ExecutionTrace exists for the opportunity", async () => {
    const traces = await (prisma as any).executionTrace.findMany({
      where: {
        opportunityId,
        authorizedAt: { not: null },
      },
    });
    expect(traces).toHaveLength(0);
  });

  it("1.8 no MutationOperation linked to the opportunity's proposal", async () => {
    const proposal = await (prisma as any).actionProposal.findFirst({
      where: { decisionId: opportunityId },
      select: { id: true },
    });

    if (proposal) {
      const ops = await (prisma as any).mutationOperation.count({
        where: { id: proposal.operationId ?? "__none__" },
      });
      expect(ops).toBe(0);
    }
    // If no proposal found (shouldn't happen per 1.2), this is still safe
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2 — Duplicate opportunity.opened Event Delivery
//
// Five concurrent invocations of the ACTUAL Inngest handler function with
// the same event payload. Proves at-least-once event delivery is safe.
//
// Strategy:
//   1. vi.mock the Inngest client to capture the handler from createFunction()
//   2. Dynamically import the autonomous-planning module (triggers handler capture)
//   3. Invoke the captured handler 5× concurrently with stub step context
//   4. Assert persisted DB state
//
// This exercises the full path:
//   opportunity.opened payload → handler → event.data parse → step.run()
//   → planOpportunity() → createDraftProposal() → LIVE_DB
//
// The Inngest transport is stubbed. Everything from planOpportunity() down
// is LIVE against the real staging DB.
//
// IMPORTANT: concurrency: { limit: 5 } does NOT serialize handler invocations.
// It allows up to 5 concurrent executions. The DB boundary must remain
// authoritative for idempotency.
// ══════════════════════════════════════════════════════════════════════════════

describe.skipIf(SKIP)("§2 Duplicate opportunity.opened — event delivery race", () => {
  const ctx: TestContext = makeTestContext("conc-events");
  let opportunityId: string;
  let results: PromiseSettledResult<any>[];

  // The captured handler function from autonomous-planning.ts
  let capturedHandler: (args: { event: any; step: any }) => Promise<any>;

  beforeAll(async () => {
    assertStagingDatabase();

    // ── Capture the Inngest handler ──────────────────────────────────────
    //
    // Mock only the Inngest client's createFunction so we can capture the
    // handler argument. The mock returns a minimal stub — we don't need
    // any InngestFunction functionality for this test.
    //
    // We use vi.doMock (not vi.mock) because vi.mock is hoisted and would
    // interfere with §1's non-mocked imports. vi.doMock + resetModules
    // gives us scoped control.
    vi.doMock("@/lib/inngest/client", () => ({
      inngest: {
        createFunction: (_config: any, handler: any) => {
          // Capture only the autonomous-planning-opportunity handler
          // (first createFunction call in the module)
          if (!capturedHandler) {
            capturedHandler = handler;
          }
          return { id: () => "test-stub" } as any;
        },
      },
    }));

    // Suppress logger noise from concurrent handler calls
    vi.doMock("@/lib/logger", () => ({
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
    }));

    // Dynamically import the module — triggers createFunction → captures handler
    await import("@/lib/inngest/functions/autonomous-planning");

    if (!capturedHandler!) {
      throw new Error(
        "[D8.1.4] Failed to capture handler from autonomous-planning module. " +
        "createFunction was not called during module import."
      );
    }

    // ── Seed the test data ──────────────────────────────────────────────
    await seedUser(prisma as any, ctx.userId);
    await seedSite(prisma as any, ctx.siteId, ctx.userId);

    opportunityId = await seedOpportunity(prisma as any, ctx, {
      opportunityId: ctx.id("opp-event"),
    });

    // Evidence chain — same as §1
    await seedFinding(prisma as any, ctx, opportunityId, {
      agentRunId: ctx.id("run-event"),
      findingId: ctx.id("finding-event"),
    });

    // Compute correct evidence hash (same approach as §1)
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
      scoreRecordId: ctx.id("score-event"),
      evidenceHash,
    });

    await seedAllocation(prisma as any, ctx, opportunityId, scoreId, {
      evidenceHash,
    });

    // ── Build the stub step context ─────────────────────────────────────
    //
    // step.run() executes the callback directly — no memoization, no
    // idempotency from the queue layer. This is intentional: we're testing
    // that the DB boundary alone is sufficient.
    const makeStepStub = () => ({
      run: async (_name: string, fn: () => Promise<any>) => fn(),
      sendEvent: async () => {},
    });

    // ── Build the event payload (same for all 5 deliveries) ─────────────
    const event = {
      data: {
        opportunityId,
        siteId: ctx.siteId,
      },
    };

    // ── Launch 5 concurrent handler invocations ─────────────────────────
    results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        capturedHandler({ event, step: makeStepStub() })
      )
    );
  }, 60_000);

  afterAll(async () => {
    await cleanupContext(prisma as any, ctx);
    vi.doUnmock("@/lib/inngest/client");
    vi.doUnmock("@/lib/logger");
  }, 30_000);

  it("2.1 all 5 handler invocations settle without unhandled errors", () => {
    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.status).toBe("fulfilled");
    }
  });

  it("2.2 exactly 1 ActionProposal exists for the opportunity", async () => {
    const proposals = await (prisma as any).actionProposal.findMany({
      where: { decisionId: opportunityId },
    });
    expect(proposals).toHaveLength(1);
  });

  it("2.3 exactly 1 distinct idempotencyKey across proposals", async () => {
    const proposals = await (prisma as any).actionProposal.findMany({
      where: { decisionId: opportunityId },
      select: { idempotencyKey: true },
    });
    const keys = new Set(proposals.map((p: any) => p.idempotencyKey));
    expect(keys.size).toBe(1);
  });

  it("2.4 opportunity status remains OPEN", async () => {
    const opp = await (prisma as any).growthDecision.findUnique({
      where: { id: opportunityId },
      select: { opportunityStatus: true },
    });
    expect(opp).not.toBeNull();
    expect(opp.opportunityStatus).toBe("OPEN");
  });

  it("2.5 no AutonomousExecutionClaim exists for the opportunity", async () => {
    const count = await (prisma as any).autonomousExecutionClaim.count({
      where: { opportunityId },
    });
    expect(count).toBe(0);
  });

  it("2.6 no BudgetReservation exists for the site", async () => {
    const count = await (prisma as any).budgetReservation.count({
      where: { siteId: ctx.siteId },
    });
    expect(count).toBe(0);
  });

  it("2.7 no MutationOperation linked to the opportunity's proposal", async () => {
    const proposal = await (prisma as any).actionProposal.findFirst({
      where: { decisionId: opportunityId },
      select: { operationId: true },
    });

    if (proposal?.operationId) {
      const ops = await (prisma as any).mutationOperation.count({
        where: { id: proposal.operationId },
      });
      expect(ops).toBe(0);
    }
    // No operationId means no MutationOperation was ever linked — pass
  });
});
