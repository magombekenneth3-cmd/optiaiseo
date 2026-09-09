/**
 * D.8.1.8 — Trace Reconstruction Proof
 *
 * Proves that after an autonomous run, the complete durable decision/execution
 * history can be reconstructed from ExecutionTrace and related records:
 *
 *   discovery → scoring → allocation → planning → authorization
 *   → execution → mutation → verification → learning/provenance
 *
 * This test does NOT re-run the pipeline. It:
 *   1. Seeds and runs a minimal autonomous lifecycle (same pattern as D.8.1.7)
 *   2. Then queries all trace/audit records and proves the full history is
 *      reconstructable, with no gaps or dangling references.
 *
 * Environment:
 *   D8_LIVE_DB=true
 *   DATABASE_URL=<staging>
 *   AUTONOMOUS_GLOBAL_KILL_SWITCH=false
 *   AUTONOMOUS_MAX_PROPOSALS_PER_HOUR=100
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  makeTestContext,
  seedUser,
  seedSite,
  seedOpportunity,
  seedFinding,
  cleanupContext,
  type TestContext,
} from "../harness/fixtures";
import { assertStagingDatabase, isLiveDbAvailable } from "../harness/db-guard";

// ── Env overrides ───────────────────────────────────────────────────────────
process.env.AUTONOMOUS_GLOBAL_KILL_SWITCH = "false";
process.env.AUTONOMOUS_MAX_PROPOSALS_PER_HOUR = "100";

const LIVE = isLiveDbAvailable();
const describeIf = LIVE ? describe : describe.skip;

describeIf("D.8.1.8 — Trace Reconstruction Proof", () => {
  let prisma: any;
  let ctx: TestContext;
  let opportunityId: string;
  let blogId: string;
  const blogSlug = `trace-test-blog`;

  // Collected IDs from the run
  let proposalId: string;
  let operationId: string;

  // Error tracking
  let setupError: string | null = null;

  beforeAll(async () => {
    assertStagingDatabase();
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    ctx = makeTestContext("trace");

    try {
      // ── SEED ──────────────────────────────────────────────────────────
      await seedUser(prisma, ctx.userId);
      await seedSite(prisma, ctx.siteId, ctx.userId, {
        operatingMode: "AUTOPILOT",
        automationsPaused: false,
        dailyMutationLimit: 10,
        maxConcurrentExecutions: 3,
      });

      blogId = ctx.id("blog");
      await prisma.blog.create({
        data: {
          id: blogId,
          siteId: ctx.siteId,
          pipelineType: "STANDARD",
          title: "D8 Trace Reconstruction Test Blog",
          slug: blogSlug,
          content: "Test content for trace reconstruction",
          status: "PUBLISHED",
          version: 1,
        },
      });

      opportunityId = await seedOpportunity(prisma, ctx, {
        opportunityId: ctx.id("opp-trace"),
        action: "OPTIMIZE_TITLE",
        primaryCategory: "missing_meta_description",
        primaryKeyword: "trace reconstruction",
        opportunityStatus: "CANDIDATE",
        url: `/blog/${blogSlug}`,
        discoveryConfidence: 0.9,
        score: {
          finalScore: 0,
          components: { impressions: 1500, position: 5 },
        },
      });

      // Evidence chain for scoring
      const findingId = await seedFinding(prisma, ctx, opportunityId, {
        findingType: "MISSING_META_DESCRIPTION",
        severity: "HIGH",
        confidence: 0.95,
      });

      const now = new Date();
      const evidenceRecords = [
        { findingId, sourceType: "GSC", metric: "impressions", value: "1500", observedAt: now },
        { findingId, sourceType: "GSC", metric: "position", value: "5", observedAt: now },
        { findingId, sourceType: "GSC", metric: "ctr", value: "0.035", observedAt: now },
        { findingId, sourceType: "CRAWL", metric: "metaDescription", value: "missing", observedAt: now },
        { findingId, sourceType: "COMPUTED", metric: "previousPosition", value: "8", observedAt: new Date(Date.now() - 86400_000) },
      ];
      for (const ev of evidenceRecords) {
        await prisma.findingEvidence.create({ data: ev });
      }

      // ── STAGE 1: Score ────────────────────────────────────────────────
      const { scoreCandidate } = await import("@/lib/scoring/scorer");
      const scoreResult = await scoreCandidate(opportunityId);

      if (scoreResult.decision !== "PROMOTE") {
        setupError = `Scoring returned ${scoreResult.decision}, expected PROMOTE`;
        return;
      }

      // ── STAGE 2: Process ──────────────────────────────────────────────
      const { processOpportunity } = await import(
        "@/lib/inngest/functions/autonomous-executor"
      );

      const freshOpp = await prisma.growthDecision.findUnique({
        where: { id: opportunityId },
        select: {
          id: true,
          score: true,
          primaryCategory: true,
          proposals: {
            where: { status: { in: ["PENDING_APPROVAL", "APPROVED", "EXECUTING"] } },
            select: { id: true, status: true, actionType: true },
            take: 1,
          },
        },
      });

      const processResult = await processOpportunity({
        siteId: ctx.siteId,
        site: { operatingMode: "AUTOPILOT" },
        opportunity: {
          id: freshOpp.id,
          score: freshOpp.score?.finalScore ?? 80,
          category: freshOpp.primaryCategory,
          actionProposals: freshOpp.proposals ?? [],
        },
        triggerType: "CRON",
      });

      if (processResult?.result !== "SUCCESS" || !processResult?.proposalId) {
        setupError = `processOpportunity: decision=${processResult?.decision}, result=${processResult?.result}`;
        return;
      }

      proposalId = processResult.proposalId;

      // processOpportunity may not return operationId directly — fetch from proposal
      const executedProposal = await prisma.actionProposal.findUnique({
        where: { id: proposalId },
        select: { operationId: true },
      });
      operationId = executedProposal?.operationId;

      // ── STAGE 3: Verify ───────────────────────────────────────────────
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: proposalId },
      });

      const proposedChanges = (proposal?.proposedChanges as any[]) ?? [];
      const expectedMeta =
        proposedChanges.find((c: any) => c.field === "metaDescription")
          ?.proposedValue ?? "test meta description";

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        text: async () => `
          <!DOCTYPE html>
          <html>
          <head>
            <title>D8 Trace Reconstruction Test Blog</title>
            <meta name="description" content="${expectedMeta}">
          </head>
          <body><h1>Test</h1></body>
          </html>
        `,
        ok: true,
        headers: new Headers(),
      }) as any;

      try {
        const { verifyProposal } = await import("@/lib/proposals/verification");
        await verifyProposal({ proposalId });
      } finally {
        global.fetch = originalFetch;
      }
    } catch (err: any) {
      setupError = `beforeAll threw: ${err.message}\n${err.stack}`;
    }
  }, 180_000);

  afterAll(async () => {
    if (prisma && ctx) await cleanupContext(prisma, ctx);
    await prisma?.$disconnect();
  }, 30_000);

  function requireSetup() {
    if (setupError) {
      throw new Error(`[D.8.1.8] Setup failed: ${setupError}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. ExecutionTrace — the spine of reconstruction
  // ═══════════════════════════════════════════════════════════════════════════

  describe("1. ExecutionTrace completeness", () => {
    let trace: any;

    beforeAll(async () => {
      requireSetup();
      const traces = await prisma.executionTrace.findMany({
        where: { siteId: ctx.siteId, opportunityId },
      });
      trace = traces[0];
    });

    it("1.1 exactly one ExecutionTrace exists", async () => {
      requireSetup();
      const traces = await prisma.executionTrace.findMany({
        where: { siteId: ctx.siteId, opportunityId },
      });
      expect(traces.length).toBe(1);
    });

    it("1.2 trace has triggerType", () => {
      requireSetup();
      expect(trace.triggerType).toBe("CRON");
    });

    it("1.3 trace has opportunityId and score", () => {
      requireSetup();
      expect(trace.opportunityId).toBe(opportunityId);
      expect(trace.opportunityScore).toBeGreaterThan(0);
    });

    it("1.4 trace has proposalId", () => {
      requireSetup();
      expect(trace.proposalId).toBe(proposalId);
    });

    it("1.5 trace has actionType", () => {
      requireSetup();
      expect(trace.actionType).toBe("UPDATE_META_DESCRIPTION");
    });

    it("1.6 trace has safetyTier", () => {
      requireSetup();
      expect(trace.safetyTier).toBe(1);
      // riskLevel is populated post-execution; may be null on the trace
      // but riskScore on the operation is always set (verified in section 5)
    });

    it("1.7 trace has authorization fields", () => {
      requireSetup();
      expect(trace.operatingMode).toBe("AUTOPILOT");
      expect(trace.policyDecision).toBe("AUTO_EXECUTE");
      expect(trace.policyReason).toBeTruthy();
      expect(trace.budgetReservationId).toBeTruthy();
    });

    it("1.8 trace has circuitBreakerState", () => {
      requireSetup();
      expect(trace.circuitBreakerState).toBe("CLOSED");
    });

    it("1.9 trace has operationId linking to mutation", () => {
      requireSetup();
      expect(trace.operationId).toBe(operationId);
    });

    it("1.10 trace has executionResult SUCCESS", () => {
      requireSetup();
      expect(trace.executionResult).toBe("SUCCESS");
    });

    it("1.11 trace has actorType and actorId", () => {
      requireSetup();
      expect(trace.actorType).toBe("SYSTEM");
      expect(trace.actorId).toBeTruthy();
    });

    it("1.12 trace has discoveredAt timestamp", () => {
      requireSetup();
      expect(trace.discoveredAt).toBeTruthy();
    });

    it("1.13 trace has authorizedAt timestamp", () => {
      requireSetup();
      expect(trace.authorizedAt).toBeTruthy();
    });

    it("1.14 trace has executedAt timestamp", () => {
      requireSetup();
      expect(trace.executedAt).toBeTruthy();
    });

    it("1.15 timestamps are in chronological order", () => {
      requireSetup();
      const discovered = new Date(trace.discoveredAt).getTime();
      const authorized = new Date(trace.authorizedAt).getTime();
      const executed = new Date(trace.executedAt).getTime();
      expect(authorized).toBeGreaterThanOrEqual(discovered);
      expect(executed).toBeGreaterThanOrEqual(authorized);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Scoring provenance — reconstructable from OpportunityScoreRecord
  // ═══════════════════════════════════════════════════════════════════════════

  describe("2. Scoring provenance", () => {
    it("2.1 OpportunityScoreRecord exists with all 6 components", async () => {
      requireSetup();
      const records = await prisma.opportunityScoreRecord.findMany({
        where: { opportunityId },
        orderBy: { scoredAt: "desc" },
      });
      expect(records.length).toBeGreaterThanOrEqual(1);
      const r = records[0];
      expect(r.impactScore).toBeGreaterThanOrEqual(0);
      expect(r.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(r.evidenceScore).toBeGreaterThanOrEqual(0);
      expect(r.urgencyScore).toBeGreaterThanOrEqual(0);
      expect(r.effortScore).toBeGreaterThanOrEqual(0);
      expect(r.riskScore).toBeGreaterThanOrEqual(0);
      expect(r.finalScore).toBeGreaterThan(0);
    });

    it("2.2 score record has PROMOTE decision", async () => {
      requireSetup();
      const records = await prisma.opportunityScoreRecord.findMany({
        where: { opportunityId },
      });
      expect(records[0].decision).toBe("PROMOTE");
    });

    it("2.3 score record has evidenceHash for fencing", async () => {
      requireSetup();
      const records = await prisma.opportunityScoreRecord.findMany({
        where: { opportunityId },
      });
      expect(records[0].evidenceHash).toBeTruthy();
      expect(records[0].evidenceHash.length).toBeGreaterThanOrEqual(16);
    });

    it("2.4 score record has weightsUsed for reproducibility", async () => {
      requireSetup();
      const records = await prisma.opportunityScoreRecord.findMany({
        where: { opportunityId },
      });
      const weights = records[0].weightsUsed;
      expect(weights).toBeTruthy();
      expect(typeof weights).toBe("object");
    });

    it("2.5 score record has scoringVersion", async () => {
      requireSetup();
      const records = await prisma.opportunityScoreRecord.findMany({
        where: { opportunityId },
      });
      expect(records[0].scoringVersion).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Authorization provenance — policy gate + budget + claim
  // ═══════════════════════════════════════════════════════════════════════════

  describe("3. Authorization provenance", () => {
    it("3.1 BudgetReservation exists with CONSUMED status", async () => {
      requireSetup();
      const reservations = await prisma.budgetReservation.findMany({
        where: { siteId: ctx.siteId },
      });
      const consumed = reservations.filter((r: any) => r.status === "CONSUMED");
      expect(consumed.length).toBeGreaterThanOrEqual(1);
    });

    it("3.2 BudgetReservation links to operationId", async () => {
      requireSetup();
      const reservations = await prisma.budgetReservation.findMany({
        where: { siteId: ctx.siteId, status: "CONSUMED" },
      });
      expect(reservations[0].operationId).toBe(operationId);
    });

    it("3.3 AutonomousExecutionClaim exists with COMPLETED status", async () => {
      requireSetup();
      const claims = await prisma.autonomousExecutionClaim.findMany({
        where: { siteId: ctx.siteId, opportunityId },
      });
      const completed = claims.filter((r: any) => r.status === "COMPLETED");
      expect(completed.length).toBeGreaterThanOrEqual(1);
    });

    it("3.4 claim has workerId for actor tracing", async () => {
      requireSetup();
      const claims = await prisma.autonomousExecutionClaim.findMany({
        where: { siteId: ctx.siteId, opportunityId, status: "COMPLETED" },
      });
      // Field is 'claimedBy' in the schema, not 'workerId'
      expect(claims[0].claimedBy).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Proposal provenance — ActionProposal lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  describe("4. Proposal provenance", () => {
    it("4.1 ActionProposal exists with VERIFIED status", async () => {
      requireSetup();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: proposalId },
      });
      expect(proposal).toBeTruthy();
      expect(proposal.status).toBe("VERIFIED");
    });

    it("4.2 proposal has proposedChanges JSON", async () => {
      requireSetup();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: proposalId },
      });
      const changes = proposal.proposedChanges as any[];
      expect(changes.length).toBeGreaterThanOrEqual(1);
      expect(changes[0].field).toBeTruthy();
      expect(changes[0].proposedValue).toBeTruthy();
    });

    it("4.3 proposal has approvedBy and approvedAt", async () => {
      requireSetup();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: proposalId },
      });
      expect(proposal.approvedBy).toBeTruthy();
      expect(proposal.approvedAt).toBeTruthy();
    });

    it("4.4 proposal has verifiedAt and verificationResult", async () => {
      requireSetup();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: proposalId },
      });
      expect(proposal.verifiedAt).toBeTruthy();
      expect(proposal.verificationResult).toBe("VERIFIED");
    });

    it("4.5 proposal links to operationId", async () => {
      requireSetup();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: proposalId },
      });
      expect(proposal.operationId).toBe(operationId);
    });

    it("4.6 proposal has approvalHash for integrity check", async () => {
      requireSetup();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: proposalId },
      });
      expect(proposal.approvalHash).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Mutation audit trail — MutationOperation + MutationAuditEvent
  // ═══════════════════════════════════════════════════════════════════════════

  describe("5. Mutation audit trail", () => {
    it("5.1 MutationOperation exists and is terminal", async () => {
      requireSetup();
      const op = await prisma.mutationOperation.findUnique({
        where: { id: operationId },
      });
      expect(op).toBeTruthy();
      expect(["COMMITTED", "EFFECTS_PENDING", "COMPLETED"]).toContain(op.status);
    });

    it("5.2 operation has risk assessment (riskLevel + riskScore)", async () => {
      requireSetup();
      const op = await prisma.mutationOperation.findUnique({
        where: { id: operationId },
      });
      expect(op.riskLevel).toBeTruthy();
      expect(op.riskScore).toBeGreaterThanOrEqual(0);
    });

    it("5.3 operation has mutationHash for content-addressability", async () => {
      requireSetup();
      const op = await prisma.mutationOperation.findUnique({
        where: { id: operationId },
      });
      expect(op.mutationHash).toBeTruthy();
      expect(op.mutationHash.length).toBeGreaterThanOrEqual(16);
    });

    it("5.4 MutationAuditEvent chain covers full lifecycle", async () => {
      requireSetup();
      const events = await prisma.mutationAuditEvent.findMany({
        where: { operationId },
        orderBy: { createdAt: "asc" },
      });

      // Must have at minimum: CREATED, RISK_ASSESSED, APPROVED, EXECUTING, COMMITTED
      const eventTypes = events.map((e: any) => e.eventType);
      expect(eventTypes).toContain("CREATED");
      expect(eventTypes).toContain("RISK_ASSESSED");
      expect(eventTypes).toContain("APPROVED");
      expect(eventTypes).toContain("EXECUTING");
      expect(eventTypes).toContain("COMMITTED");
    });

    it("5.5 audit events are in chronological order", async () => {
      requireSetup();
      const events = await prisma.mutationAuditEvent.findMany({
        where: { operationId },
        orderBy: { createdAt: "asc" },
      });

      for (let i = 1; i < events.length; i++) {
        const prev = new Date(events[i - 1].createdAt).getTime();
        const curr = new Date(events[i].createdAt).getTime();
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    });

    it("5.6 audit events have actorId for attribution", async () => {
      requireSetup();
      const events = await prisma.mutationAuditEvent.findMany({
        where: { operationId },
      });
      for (const e of events) {
        expect(e.actorId).toBeTruthy();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Mutation snapshot — before/after state
  // ═══════════════════════════════════════════════════════════════════════════

  describe("6. Mutation snapshot (before/after)", () => {
    it("6.1 MutationSnapshot exists for this operation", async () => {
      requireSetup();
      const snapshot = await prisma.mutationSnapshot.findUnique({
        where: { operationId },
      });
      expect(snapshot).toBeTruthy();
    });

    it("6.2 snapshot has beforeState", async () => {
      requireSetup();
      const snapshot = await prisma.mutationSnapshot.findUnique({
        where: { operationId },
      });
      expect(snapshot.beforeState).toBeTruthy();
      // Before state should have null metaDescription
      const before = snapshot.beforeState as Record<string, any>;
      expect(before.metaDescription).toBeNull();
    });

    it("6.3 snapshot has afterState", async () => {
      requireSetup();
      const snapshot = await prisma.mutationSnapshot.findUnique({
        where: { operationId },
      });
      expect(snapshot.afterState).toBeTruthy();
      // After state should have a metaDescription
      const after = snapshot.afterState as Record<string, any>;
      expect(after.metaDescription).toBeTruthy();
    });

    it("6.4 before → after diff is reconstructable", async () => {
      requireSetup();
      const snapshot = await prisma.mutationSnapshot.findUnique({
        where: { operationId },
      });
      const before = snapshot.beforeState as Record<string, any>;
      const after = snapshot.afterState as Record<string, any>;

      // The diff: metaDescription went from null to a value
      expect(before.metaDescription).toBeNull();
      expect(after.metaDescription).toBeTruthy();
      // Version incremented
      expect(after.version).toBe(before.version + 1);
    });

    it("6.5 snapshot targetModel and targetId match operation", async () => {
      requireSetup();
      const snapshot = await prisma.mutationSnapshot.findUnique({
        where: { operationId },
      });
      expect(snapshot.targetModel).toBe("Blog");
      expect(snapshot.targetId).toBe(blogId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Verification provenance
  // ═══════════════════════════════════════════════════════════════════════════

  describe("7. Verification provenance", () => {
    it("7.1 proposal has verificationDetails with check results", async () => {
      requireSetup();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: proposalId },
      });
      const details = proposal.verificationDetails;
      expect(details).toBeTruthy();
      expect(Array.isArray(details)).toBe(true);
      expect(details.length).toBeGreaterThan(0);
    });

    it("7.2 opportunity final status is VERIFIED", async () => {
      requireSetup();
      const opp = await prisma.growthDecision.findUnique({
        where: { id: opportunityId },
      });
      expect(opp.opportunityStatus).toBe("VERIFIED");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Cross-reference integrity — all IDs link correctly
  // ═══════════════════════════════════════════════════════════════════════════

  describe("8. Cross-reference integrity", () => {
    it("8.1 ExecutionTrace.proposalId → ActionProposal exists", async () => {
      requireSetup();
      const trace = await prisma.executionTrace.findFirst({
        where: { siteId: ctx.siteId, opportunityId },
      });
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: trace.proposalId },
      });
      expect(proposal).toBeTruthy();
    });

    it("8.2 ExecutionTrace.operationId → MutationOperation exists", async () => {
      requireSetup();
      const trace = await prisma.executionTrace.findFirst({
        where: { siteId: ctx.siteId, opportunityId },
      });
      const op = await prisma.mutationOperation.findUnique({
        where: { id: trace.operationId },
      });
      expect(op).toBeTruthy();
    });

    it("8.3 ActionProposal.operationId → MutationOperation exists", async () => {
      requireSetup();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: proposalId },
      });
      const op = await prisma.mutationOperation.findUnique({
        where: { id: proposal.operationId },
      });
      expect(op).toBeTruthy();
    });

    it("8.4 MutationOperation → MutationSnapshot exists", async () => {
      requireSetup();
      const snapshot = await prisma.mutationSnapshot.findUnique({
        where: { operationId },
      });
      expect(snapshot).toBeTruthy();
    });

    it("8.5 ExecutionTrace.budgetReservationId → BudgetReservation exists", async () => {
      requireSetup();
      const trace = await prisma.executionTrace.findFirst({
        where: { siteId: ctx.siteId, opportunityId },
      });
      if (trace.budgetReservationId) {
        const reservation = await prisma.budgetReservation.findUnique({
          where: { id: trace.budgetReservationId },
        });
        expect(reservation).toBeTruthy();
        expect(reservation.status).toBe("CONSUMED");
      }
    });

    it("8.6 all records share the same siteId", async () => {
      requireSetup();
      const trace = await prisma.executionTrace.findFirst({
        where: { siteId: ctx.siteId, opportunityId },
      });
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: proposalId },
      });
      const op = await prisma.mutationOperation.findUnique({
        where: { id: operationId },
      });

      expect(trace.siteId).toBe(ctx.siteId);
      expect(proposal.siteId).toBe(ctx.siteId);
      expect(op.siteId).toBe(ctx.siteId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. Full reconstruction — prove the complete timeline is recoverable
  // ═══════════════════════════════════════════════════════════════════════════

  describe("9. Full timeline reconstruction", () => {
    it("9.1 can reconstruct complete decision history from trace + linked records", async () => {
      requireSetup();

      // 1. Start from ExecutionTrace
      const trace = await prisma.executionTrace.findFirst({
        where: { siteId: ctx.siteId, opportunityId },
      });
      expect(trace).toBeTruthy();

      // 2. Scoring phase — reconstruct from OpportunityScoreRecord
      const scoreRecords = await prisma.opportunityScoreRecord.findMany({
        where: { opportunityId: trace.opportunityId },
        orderBy: { scoredAt: "desc" },
      });
      expect(scoreRecords.length).toBeGreaterThanOrEqual(1);
      const score = scoreRecords[0];

      // 3. Proposal phase — reconstruct from ActionProposal
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: trace.proposalId },
      });
      expect(proposal).toBeTruthy();

      // 4. Authorization phase — reconstruct from BudgetReservation + Claim
      const reservation = trace.budgetReservationId
        ? await prisma.budgetReservation.findUnique({
            where: { id: trace.budgetReservationId },
          })
        : null;
      const claims = await prisma.autonomousExecutionClaim.findMany({
        where: { siteId: ctx.siteId, opportunityId },
      });

      // 5. Mutation phase — reconstruct from MutationOperation + Snapshot
      const operation = await prisma.mutationOperation.findUnique({
        where: { id: trace.operationId },
      });
      expect(operation).toBeTruthy();

      const snapshot = await prisma.mutationSnapshot.findUnique({
        where: { operationId: trace.operationId },
      });
      expect(snapshot).toBeTruthy();

      // 6. Audit trail — reconstruct from MutationAuditEvent
      const auditEvents = await prisma.mutationAuditEvent.findMany({
        where: { operationId: trace.operationId },
        orderBy: { createdAt: "asc" },
      });
      expect(auditEvents.length).toBeGreaterThanOrEqual(5);

      // ── Verify the reconstructed timeline is complete and coherent ──

      // Timeline: discovery → scoring → authorization → execution → verification
      const timeline = {
        discovery: {
          opportunityId: trace.opportunityId,
          discoveredAt: trace.discoveredAt,
        },
        scoring: {
          finalScore: score.finalScore,
          decision: score.decision,
          evidenceHash: score.evidenceHash,
          scoredAt: score.scoredAt,
        },
        authorization: {
          operatingMode: trace.operatingMode,
          policyDecision: trace.policyDecision,
          budgetReservationId: trace.budgetReservationId,
          circuitBreakerState: trace.circuitBreakerState,
          authorizedAt: trace.authorizedAt,
          claimId: claims[0]?.id,
        },
        proposal: {
          proposalId: proposal.id,
          actionType: proposal.actionType,
          safetyTier: proposal.safetyTier,
          approvedBy: proposal.approvedBy,
          approvedAt: proposal.approvedAt,
        },
        execution: {
          operationId: operation.id,
          mutationType: operation.mutationType,
          riskLevel: operation.riskLevel,
          riskScore: operation.riskScore,
          executedAt: trace.executedAt,
          result: trace.executionResult,
        },
        mutation: {
          targetModel: snapshot.targetModel,
          targetId: snapshot.targetId,
          beforeVersion: snapshot.targetVersion,
          afterVersion: (snapshot.afterState as any)?.version,
          fieldsChanged: operation.affectedFields,
        },
        verification: {
          verificationResult: proposal.verificationResult,
          verifiedAt: proposal.verifiedAt,
          checksCount: (proposal.verificationDetails as any[])?.length,
        },
        auditTrail: {
          eventCount: auditEvents.length,
          eventTypes: auditEvents.map((e: any) => e.eventType),
        },
      };

      // Every phase must have data — no nulls in required fields
      expect(timeline.discovery.opportunityId).toBeTruthy();
      expect(timeline.discovery.discoveredAt).toBeTruthy();
      expect(timeline.scoring.finalScore).toBeGreaterThan(0);
      expect(timeline.scoring.decision).toBe("PROMOTE");
      expect(timeline.scoring.evidenceHash).toBeTruthy();
      expect(timeline.authorization.policyDecision).toBe("AUTO_EXECUTE");
      expect(timeline.authorization.authorizedAt).toBeTruthy();
      expect(timeline.proposal.proposalId).toBeTruthy();
      expect(timeline.proposal.actionType).toBe("UPDATE_META_DESCRIPTION");
      expect(timeline.proposal.approvedBy).toBeTruthy();
      expect(timeline.execution.operationId).toBeTruthy();
      expect(timeline.execution.result).toBe("SUCCESS");
      expect(timeline.mutation.targetModel).toBe("Blog");
      expect(timeline.mutation.afterVersion).toBe(timeline.mutation.beforeVersion + 1);
      expect(timeline.verification.verificationResult).toBe("VERIFIED");
      expect(timeline.verification.checksCount).toBeGreaterThan(0);
      expect(timeline.auditTrail.eventCount).toBeGreaterThanOrEqual(5);
    });
  });
});
