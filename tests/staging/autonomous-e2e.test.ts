/**
 * D.8.1.7 — Complete Autonomous E2E Proof
 *
 * Proves one production-like autonomous transaction end-to-end:
 *
 *   CANDIDATE
 *     → scoreCandidate()         — D.2 scoring → PROMOTE → OPEN
 *     → processOpportunity()     — Phase C autonomous executor:
 *         authorize()            — 6-gate policy boundary
 *         generateProposal()     — auto-approve (Tier 1)
 *         verifyClaimBeforeExecution()
 *         runAction()            — Phase B mutation → COMMITTED
 *         consumeReservation()   — cleanup
 *         completeClaim()        — cleanup
 *     → verifyProposal()         — VERIFYING → VERIFIED
 *
 * Mocking:
 *   - Verification HTTP fetch (no deployed frontend)
 *   - All else is live against staging DB
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

// ── Env overrides — set before any autonomous module loads ──────────────────
process.env.AUTONOMOUS_GLOBAL_KILL_SWITCH = "false";
process.env.AUTONOMOUS_MAX_PROPOSALS_PER_HOUR = "100";

const LIVE = isLiveDbAvailable();
const describeIf = LIVE ? describe : describe.skip;

describeIf("D.8.1.7 — Complete Autonomous E2E Proof", () => {
  let prisma: any;
  let ctx: TestContext;

  // Stage results — populated by beforeAll, asserted by individual tests
  let opportunityId: string;
  let blogId: string;
  const blogSlug = `e2e-test-blog`;

  // Stage 1: Scoring
  let scoreResult: any;

  // Stage 2: processOpportunity
  let processResult: any;

  // Stage 3: Verification
  let verifyResult: any;

  // Error tracking for beforeAll
  let setupError: string | null = null;

  beforeAll(async () => {
    assertStagingDatabase();
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    ctx = makeTestContext("e2e");

    try {
      // ── SEED ────────────────────────────────────────────────────────────
      await seedUser(prisma, ctx.userId);
      await seedSite(prisma, ctx.siteId, ctx.userId, {
        operatingMode: "AUTOPILOT",
        automationsPaused: false,
        dailyMutationLimit: 10,
        maxConcurrentExecutions: 3,
      });

      // Blog entity — metaDescription is null so generateChangesForAction()
      // produces a non-empty change set
      blogId = ctx.id("blog");
      await prisma.blog.create({
        data: {
          id: blogId,
          siteId: ctx.siteId,
          pipelineType: "STANDARD",
          title: "D8 E2E Autonomous Test Blog",
          slug: blogSlug,
          content: "Test content for autonomous E2E proof",
          status: "PUBLISHED",
          version: 1,
          // metaDescription is intentionally omitted (null)
        },
      });

      // CANDIDATE opportunity:
      //   - primaryCategory: "missing_meta_description" → executor maps to UPDATE_META_DESCRIPTION
      //   - action: "OPTIMIZE_TITLE" → scorer uses for effort(20)/risk(15) = low deductions
      //   - URL must match `/blog/<slug>` for resolveTarget
      //   - score.components has impressions/position for impact boost
      opportunityId = await seedOpportunity(prisma, ctx, {
        opportunityId: ctx.id("opp-e2e"),
        action: "OPTIMIZE_TITLE",
        primaryCategory: "missing_meta_description",
        primaryKeyword: "autonomous seo optimization",
        opportunityStatus: "CANDIDATE",
        url: `/blog/${blogSlug}`,
        discoveryConfidence: 0.9,
        score: {
          finalScore: 0,
          components: {
            impressions: 1500,
            position: 5,
          },
        },
      });

      // ── SEED RICH EVIDENCE CHAIN ──────────────────────────────────────
      // The scorer computes evidence/confidence from FindingEvidence records.
      // We need: 5+ items, 3+ source types, quantitative metrics, fresh timestamps.

      const findingId = await seedFinding(prisma, ctx, opportunityId, {
        findingType: "MISSING_META_DESCRIPTION",
        severity: "HIGH",
        confidence: 0.95,
      });

      // Create 5 FindingEvidence records from 3 different sources
      const now = new Date();
      const evidenceRecords = [
        {
          findingId,
          sourceType: "GSC",
          metric: "impressions",
          value: "1500",
          observedAt: now,
        },
        {
          findingId,
          sourceType: "GSC",
          metric: "position",
          value: "5",
          observedAt: now,
        },
        {
          findingId,
          sourceType: "GSC",
          metric: "ctr",
          value: "0.035",
          observedAt: now,
        },
        {
          findingId,
          sourceType: "CRAWL",
          metric: "metaDescription",
          value: "missing",
          observedAt: now,
        },
        {
          findingId,
          sourceType: "COMPUTED",
          metric: "previousPosition",
          value: "8",
          observedAt: new Date(Date.now() - 86400_000), // 1 day ago
        },
      ];

      for (const ev of evidenceRecords) {
        await prisma.findingEvidence.create({ data: ev });
      }

      // ── STAGE 1: Score the CANDIDATE → PROMOTE → OPEN ───────────────
      const { scoreCandidate } = await import("@/lib/scoring/scorer");
      scoreResult = await scoreCandidate(opportunityId);

      // ── STAGE 2: Process via Phase C autonomous executor ────────────
      if (scoreResult.decision !== "PROMOTE") {
        setupError = `Scoring returned ${scoreResult.decision} (score=${scoreResult.finalScore}), expected PROMOTE. Components: impact=${scoreResult.impactScore}, confidence=${scoreResult.confidenceScore}, evidence=${scoreResult.evidenceScore}, urgency=${scoreResult.urgencyScore}, effort=${scoreResult.effortScore}, risk=${scoreResult.riskScore}`;
        return;
      }

      const { processOpportunity } = await import(
        "@/lib/inngest/functions/autonomous-executor"
      );

      // Refresh opportunity from DB after scoring (to get score value)
      const freshOpp = await prisma.growthDecision.findUnique({
        where: { id: opportunityId },
        select: {
          id: true,
          score: true,
          primaryCategory: true,
          proposals: {
            where: {
              status: { in: ["PENDING_APPROVAL", "APPROVED", "EXECUTING"] },
            },
            select: { id: true, status: true, actionType: true },
            take: 1,
          },
        },
      });

      processResult = await processOpportunity({
        siteId: ctx.siteId,
        site: { operatingMode: "AUTOPILOT" },
        opportunity: {
          id: freshOpp.id,
          score: freshOpp.score?.finalScore ?? 80,
          category: freshOpp.primaryCategory, // "missing_meta_description"
          actionProposals: freshOpp.proposals ?? [],
        },
        triggerType: "CRON",
      });

      // ── STAGE 3: Verification (mock HTTP fetch) ─────────────────────
      if (processResult?.result === "SUCCESS" && processResult?.proposalId) {
        // Load proposal to get the generated meta description
        const proposal = await prisma.actionProposal.findUnique({
          where: { id: processResult.proposalId },
        });

        const proposedChanges = (proposal?.proposedChanges as any[]) ?? [];
        const expectedMeta =
          proposedChanges.find((c: any) => c.field === "metaDescription")
            ?.proposedValue ?? "test meta description";

        // Mock global fetch for verification — return HTML with expected meta
        const originalFetch = global.fetch;
        global.fetch = vi.fn().mockResolvedValue({
          status: 200,
          text: async () => `
            <!DOCTYPE html>
            <html>
            <head>
              <title>D8 E2E Autonomous Test Blog</title>
              <meta name="description" content="${expectedMeta}">
            </head>
            <body><h1>Test</h1></body>
            </html>
          `,
          ok: true,
          headers: new Headers(),
        }) as any;

        try {
          const { verifyProposal } = await import(
            "@/lib/proposals/verification"
          );
          verifyResult = await verifyProposal({
            proposalId: processResult.proposalId,
          });
        } finally {
          global.fetch = originalFetch;
        }
      } else {
        setupError = `processOpportunity returned decision=${processResult?.decision}, result=${processResult?.result}. Expected AUTO_EXECUTE/SUCCESS.`;
      }
    } catch (err: any) {
      setupError = `beforeAll threw: ${err.message}\n${err.stack}`;
    }
  }, 120_000);

  afterAll(async () => {
    if (prisma && ctx) await cleanupContext(prisma, ctx);
    await prisma?.$disconnect();
  }, 30_000);

  // Helper to skip test if setup failed at an earlier stage
  function requireSetup() {
    if (setupError) {
      throw new Error(`[D.8.1.7] Setup failed: ${setupError}`);
    }
  }

  function requireProposalId(): string {
    requireSetup();
    if (!processResult?.proposalId) {
      throw new Error("[D.8.1.7] No proposalId from processOpportunity");
    }
    return processResult.proposalId;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 1 — Scoring
  // ═══════════════════════════════════════════════════════════════════════

  describe("Stage 1: scoreCandidate() — CANDIDATE → OPEN", () => {
    it("1.1 scoring decision is PROMOTE", () => {
      requireSetup();
      expect(scoreResult).toBeTruthy();
      expect(scoreResult.decision).toBe("PROMOTE");
    });

    it("1.2 opportunity was promoted", () => {
      requireSetup();
      expect(scoreResult.promoted).toBe(true);
    });

    it("1.3 opportunity was promoted past OPEN (full pipeline ran)", async () => {
      requireSetup();
      const opp = await prisma.growthDecision.findUnique({
        where: { id: opportunityId },
      });
      // By assertion time, the full pipeline has run (beforeAll executes
      // score → process → verify), so status has advanced past OPEN.
      expect(["PROPOSED", "APPROVED", "EXECUTING", "VERIFYING", "VERIFIED"]).toContain(
        opp.opportunityStatus
      );
    });

    it("1.4 OpportunityScoreRecord exists with PROMOTE decision", async () => {
      requireSetup();
      const records = await prisma.opportunityScoreRecord.findMany({
        where: { opportunityId },
      });
      expect(records.length).toBeGreaterThanOrEqual(1);
      expect(records[0].decision).toBe("PROMOTE");
      expect(records[0].evidenceHash).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 2 — Phase C Autonomous Executor
  // ═══════════════════════════════════════════════════════════════════════

  describe("Stage 2: processOpportunity() — Phase C autonomous execution", () => {
    it("2.1 processOpportunity decision is AUTO_EXECUTE", () => {
      requireSetup();
      expect(processResult).toBeTruthy();
      expect(processResult.decision).toBe("AUTO_EXECUTE");
    });

    it("2.2 processOpportunity result is SUCCESS", () => {
      requireSetup();
      expect(processResult.result).toBe("SUCCESS");
    });

    it("2.3 proposalId is set", () => {
      requireSetup();
      expect(processResult.proposalId).toBeTruthy();
    });

    it("2.4 exactly one ActionProposal exists for this opportunity", async () => {
      requireSetup();
      const proposals = await prisma.actionProposal.findMany({
        where: { decisionId: opportunityId },
      });
      expect(proposals.length).toBe(1);
    });

    it("2.5 proposal is NOT DRAFT — it went through auto-approve", async () => {
      const pid = requireProposalId();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: pid },
      });
      expect(proposal.status).not.toBe("DRAFT");
    });

    it("2.6 proposal status is EXECUTED (post-mutation)", async () => {
      const pid = requireProposalId();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: pid },
      });
      // After runAction() succeeds, proposal transitions to EXECUTED
      // (or VERIFYING if verification already ran)
      expect(["EXECUTED", "VERIFYING", "VERIFIED"]).toContain(proposal.status);
    });

    it("2.7 proposal actionType is UPDATE_META_DESCRIPTION", async () => {
      const pid = requireProposalId();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: pid },
      });
      expect(proposal.actionType).toBe("UPDATE_META_DESCRIPTION");
    });

    it("2.8 proposal has safetyTier 1 (Tier 1 auto-approve)", async () => {
      const pid = requireProposalId();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: pid },
      });
      expect(proposal.safetyTier).toBe(1);
    });

    it("2.9 proposal has operationId linked", async () => {
      const pid = requireProposalId();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: pid },
      });
      expect(proposal.operationId).toBeTruthy();
    });

    it("2.10 MutationOperation exists with status COMMITTED", async () => {
      const pid = requireProposalId();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: pid },
        select: { operationId: true },
      });
      if (proposal.operationId) {
        const op = await prisma.mutationOperation.findUnique({
          where: { id: proposal.operationId },
        });
        expect(op).toBeTruthy();
        // After commit, operation may advance to EFFECTS_PENDING
        // when post-commit effects (INDEXNOW, etc.) are registered.
        expect(["COMMITTED", "EFFECTS_PENDING"]).toContain(op.status);
      }
    });

    it("2.11 Blog metaDescription was updated (mutation took effect)", async () => {
      requireSetup();
      const blog = await prisma.blog.findUnique({
        where: { id: blogId },
      });
      expect(blog.metaDescription).toBeTruthy();
      expect(blog.metaDescription).not.toBeNull();
    });

    it("2.12 MutationSnapshot exists with before/after state", async () => {
      const pid = requireProposalId();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: pid },
        select: { operationId: true },
      });
      if (proposal.operationId) {
        const snapshots = await prisma.mutationSnapshot.findMany({
          where: { operationId: proposal.operationId },
        });
        expect(snapshots.length).toBeGreaterThanOrEqual(1);
        expect(snapshots[0].beforeState).toBeTruthy();
        expect(snapshots[0].afterState).toBeTruthy();
      }
    });

    it("2.13 BudgetReservation was consumed (not just reserved)", async () => {
      requireSetup();
      const reservations = await prisma.budgetReservation.findMany({
        where: { siteId: ctx.siteId },
      });
      // At least one reservation should exist and be CONSUMED
      const consumed = reservations.filter(
        (r: any) => r.status === "CONSUMED"
      );
      expect(consumed.length).toBeGreaterThanOrEqual(1);
    });

    it("2.14 AutonomousExecutionClaim was completed", async () => {
      requireSetup();
      const claims = await prisma.autonomousExecutionClaim.findMany({
        where: { siteId: ctx.siteId, opportunityId },
      });
      const completed = claims.filter((r: any) => r.status === "COMPLETED");
      expect(completed.length).toBeGreaterThanOrEqual(1);
    });

    it("2.15 opportunity status is VERIFYING after execution", async () => {
      requireSetup();
      const opp = await prisma.growthDecision.findUnique({
        where: { id: opportunityId },
      });
      // After execution, opportunity transitions to VERIFYING
      // (or VERIFIED if verification already ran)
      expect(["VERIFYING", "VERIFIED"]).toContain(opp.opportunityStatus);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 3 — Verification
  // ═══════════════════════════════════════════════════════════════════════

  describe("Stage 3: verifyProposal() — VERIFYING → VERIFIED", () => {
    it("3.1 verification outcome is VERIFIED", () => {
      requireSetup();
      expect(verifyResult).toBeTruthy();
      expect(verifyResult.outcome).toBe("VERIFIED");
    });

    it("3.2 proposal status is VERIFIED in DB", async () => {
      const pid = requireProposalId();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: pid },
      });
      expect(proposal.status).toBe("VERIFIED");
    });

    it("3.3 opportunity status is VERIFIED in DB", async () => {
      requireSetup();
      const opp = await prisma.growthDecision.findUnique({
        where: { id: opportunityId },
      });
      expect(opp.opportunityStatus).toBe("VERIFIED");
    });

    it("3.4 source finding status is RESOLVED", async () => {
      requireSetup();
      const findings = await prisma.agentFinding.findMany({
        where: {
          agentRunId: ctx.id("agent-run"),
        },
      });
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings[0].status).toBe("RESOLVED");
    });

    it("3.5 proposal has verificationResult and verifiedAt", async () => {
      const pid = requireProposalId();
      const proposal = await prisma.actionProposal.findUnique({
        where: { id: pid },
      });
      expect(proposal.verificationResult).toBe("VERIFIED");
      expect(proposal.verifiedAt).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // FINAL INVARIANTS — Cross-cutting safety assertions
  // ═══════════════════════════════════════════════════════════════════════

  describe("Final invariants — autonomous lifecycle integrity", () => {
    it("F.1 exactly one proposal — no duplicates", async () => {
      requireSetup();
      const proposals = await prisma.actionProposal.findMany({
        where: { decisionId: opportunityId },
      });
      expect(proposals.length).toBe(1);
    });

    it("F.2 no DRAFT proposal exists — Path B auto-approves, not Path A", async () => {
      requireSetup();
      const drafts = await prisma.actionProposal.findMany({
        where: { decisionId: opportunityId, status: "DRAFT" },
      });
      expect(drafts.length).toBe(0);
    });

    it("F.3 exactly one MutationOperation — no duplicate executions", async () => {
      requireSetup();
      const ops = await prisma.mutationOperation.findMany({
        where: { siteId: ctx.siteId },
      });
      expect(ops.length).toBe(1);
      // After commit, operation may advance to EFFECTS_PENDING
      // when post-commit effects (INDEXNOW, etc.) are registered.
      expect(["COMMITTED", "EFFECTS_PENDING"]).toContain(ops[0].status);
    });

    it("F.4 Blog version incremented from 1", async () => {
      requireSetup();
      const blog = await prisma.blog.findUnique({
        where: { id: blogId },
      });
      expect(blog.version).toBeGreaterThan(1);
    });

    it("F.5 execution trace was recorded", async () => {
      requireSetup();
      const traces = await prisma.executionTrace.findMany({
        where: { siteId: ctx.siteId, opportunityId },
      });
      expect(traces.length).toBeGreaterThanOrEqual(1);
    });
  });
});
