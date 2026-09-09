/**
 * D.8.1.6 — Safety Proofs
 *
 * Proves that safety classification, approval validation, kill switch,
 * risk engine, and state machine enforcement hold through the live
 * staging database layer.
 *
 * 6 scenarios across 3 safety domains:
 *
 *   §1 — Safety tier re-derivation at proposal creation
 *   §2 — Approval validation (expired TTL + tampered hash)
 *   §3 — Tier gate: DRAFT cannot auto-execute
 *   §4 — Live kill switch: automationsPaused site
 *   §5 — Risk engine: protected field escalation
 *   §6 — State machine: illegal transition rejection
 *
 * Live DB: D8_LIVE_DB=true required
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

// ── Pure function imports ────────────────────────────────────────────────────
import {
  SAFETY_TIER_MAP,
  RETRY_POLICIES,
  type ActionType,
  type SafetyTier,
  OpportunityTransitionError,
} from "@/lib/proposals/types";
import { hashProposedChanges } from "@/lib/proposals/safety-policy";
import { calculateOperationRisk } from "@/lib/mutations/risk-engine";
import { loadPlanningInput } from "@/lib/planning/planner";
import { hashScoringEvidence } from "@/lib/scoring/evidence-fencing";
import type { ScoringInput } from "@/lib/scoring/types";

// ── Harness ──────────────────────────────────────────────────────────────────
import {
  assertStagingDatabase,
  isLiveDbAvailable,
  makeTestContext,
  seedUser,
  seedSite,
  seedOpportunity,
  seedScoreRecord,
  seedFinding,
  seedAllocation,
  cleanupContext,
  assertOpportunityStatus,
  assertNoMutation,
  type TestContext,
} from "../harness";

// ── Conditional skip ─────────────────────────────────────────────────────────
const LIVE = isLiveDbAvailable();
const describeIf = LIVE ? describe : describe.skip;

// ═══════════════════════════════════════════════════════════════════════════════
// §1 — SAFETY TIER RE-DERIVATION AT PROPOSAL CREATION
// ═══════════════════════════════════════════════════════════════════════════════

describeIf("§1 Safety tier re-derived from ActionType at proposal creation", () => {
  let ctx: TestContext;
  let proposalId: string | null = null;
  let proposal: any;
  let prisma: any;
  let planResult: any;

  beforeAll(async () => {
    assertStagingDatabase();
    ({ prisma } = await import("@/lib/prisma"));
    ctx = makeTestContext("sp-tier", Date.now());

    await seedUser(prisma, ctx.userId);
    await seedSite(prisma, ctx.siteId, ctx.userId);
    const oppId = await seedOpportunity(prisma, ctx, {
      opportunityId: ctx.id("opp-tier"),
    });

    await seedFinding(prisma, ctx, oppId, {
      agentRunId: ctx.id("run-tier"),
      findingId: ctx.id("finding-tier"),
    });

    // Compute evidence hash matching what the planning fence will recompute
    const planningInput = await loadPlanningInput(oppId);
    const evidenceHash = hashScoringEvidence({
      opportunityId: oppId,
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

    const scoreId = await seedScoreRecord(prisma, oppId, {
      scoreRecordId: ctx.id("score-tier"),
      evidenceHash,
    });
    await seedAllocation(prisma, ctx, oppId, scoreId, {
      evidenceHash,
    });

    const { planOpportunity } = await import("@/lib/planning/planner");
    planResult = await planOpportunity(oppId);
    proposalId = planResult.proposalId;

    if (proposalId) {
      proposal = await prisma.actionProposal.findUnique({
        where: { id: proposalId },
      });
    }
  }, 60_000);

  afterAll(async () => {
    if (prisma && ctx) await cleanupContext(prisma, ctx);
  }, 30_000);

  it("1.1 proposal.safetyTier matches SAFETY_TIER_MAP[actionType]", () => {
    expect(proposalId).toBeTruthy();
    const expectedTier = SAFETY_TIER_MAP[proposal.actionType as ActionType];
    expect(proposal.safetyTier).toBe(expectedTier);
  });

  it("1.2 proposal.maxAttempts matches RETRY_POLICIES[tier].maxAttempts", () => {
    const tier = proposal.safetyTier as SafetyTier;
    expect(proposal.maxAttempts).toBe(RETRY_POLICIES[tier].maxAttempts);
  });

  it("1.3 proposal.requiresApproval === true (D.3 invariant)", () => {
    // D.3 always sets requiresApproval = true; Phase C decides auto-approve
    expect(proposal.requiresApproval).toBe(true);
  });

  it("1.4 proposal.riskLevel matches tier-derived level", () => {
    const tier = proposal.safetyTier as number;
    const expectedRisk = tier <= 1 ? "LOW" : tier === 2 ? "MEDIUM" : "HIGH";
    expect(proposal.riskLevel).toBe(expectedRisk);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §2 — APPROVAL VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

describeIf("§2.1 Expired approval TTL → FAILED, proposal EXPIRED", () => {
  let ctx: TestContext;
  let prisma: any;
  let proposalId: string;
  let opportunityId: string;
  let execResult: any;

  beforeAll(async () => {
    assertStagingDatabase();
    ({ prisma } = await import("@/lib/prisma"));
    ctx = makeTestContext("sp-expired", Date.now());

    await seedUser(prisma, ctx.userId);
    await seedSite(prisma, ctx.siteId, ctx.userId);
    opportunityId = await seedOpportunity(prisma, ctx, {
      opportunityId: ctx.id("opp-exp"),
      opportunityStatus: "APPROVED",
    });

    proposalId = ctx.id("proposal-exp");
    const now = new Date();
    const changes = [
      { field: "metaDescription", currentValue: "old", proposedValue: "new", reasoning: "test" },
    ];
    const approvalHash = hashProposedChanges(
      "UPDATE_META_DESCRIPTION",
      `https://${ctx.siteId}.d8-test.local/page`,
      changes,
    );

    await (prisma as any).actionProposal.create({
      data: {
        id: proposalId,
        siteId: ctx.siteId,
        decisionId: opportunityId,
        idempotencyKey: `op:${ctx.siteId}:${opportunityId}:UPDATE_META_DESCRIPTION:sp-exp`,
        actionType: "UPDATE_META_DESCRIPTION",
        targetUrl: `https://${ctx.siteId}.d8-test.local/page`,
        targetModel: "Blog",
        targetId: ctx.id("blog-exp"),
        proposedChanges: changes,
        expectedOutcome: "Test",
        riskLevel: "LOW",
        safetyTier: 1,
        confidence: 0.85,
        status: "APPROVED",
        requiresApproval: false,
        attemptCount: 0,
        maxAttempts: 3,
        approvedBy: "system:auto-policy",
        approvedAt: new Date(now.getTime() - 7200_000), // 2h ago
        approvalExpiresAt: new Date(now.getTime() - 3600_000), // EXPIRED: 1h ago
        approvalHash,
        generatedBy: "system:d8-test",
        verificationCriteria: [],
      },
    });

    const { runAction } = await import("@/lib/proposals/action-runner");
    execResult = await runAction({ proposalId });
  }, 60_000);

  afterAll(async () => {
    if (prisma && ctx) await cleanupContext(prisma, ctx);
  }, 30_000);

  it("2.1.1 result.status === FAILED with expired reason", () => {
    expect(execResult.status).toBe("FAILED");
    expect(execResult.error).toMatch(/expired/i);
  });

  it("2.1.2 proposal.status === EXPIRED in DB", async () => {
    const p = await (prisma as any).actionProposal.findUnique({
      where: { id: proposalId },
      select: { status: true },
    });
    expect(p.status).toBe("EXPIRED");
  });

  it("2.1.3 no MutationOperation created", () => {
    expect(execResult.operationId).toBeNull();
  });
});

describeIf("§2.2 Tampered approval hash → FAILED, no mutation", () => {
  let ctx: TestContext;
  let prisma: any;
  let proposalId: string;
  let execResult: any;

  beforeAll(async () => {
    assertStagingDatabase();
    ({ prisma } = await import("@/lib/prisma"));
    ctx = makeTestContext("sp-tamper", Date.now());

    await seedUser(prisma, ctx.userId);
    await seedSite(prisma, ctx.siteId, ctx.userId);
    const opportunityId = await seedOpportunity(prisma, ctx, {
      opportunityId: ctx.id("opp-tamp"),
      opportunityStatus: "APPROVED",
    });

    proposalId = ctx.id("proposal-tamp");
    const now = new Date();

    // Original changes → approval hash
    const originalChanges = [
      { field: "metaDescription", currentValue: "old", proposedValue: "Good description", reasoning: "test" },
    ];
    const approvalHash = hashProposedChanges(
      "UPDATE_META_DESCRIPTION",
      `https://${ctx.siteId}.d8-test.local/page`,
      originalChanges,
    );

    // Tampered changes — different proposedValue stored in DB
    const tamperedChanges = [
      { field: "metaDescription", currentValue: "old", proposedValue: "TAMPERED by attacker", reasoning: "test" },
    ];

    await (prisma as any).actionProposal.create({
      data: {
        id: proposalId,
        siteId: ctx.siteId,
        decisionId: opportunityId,
        idempotencyKey: `op:${ctx.siteId}:${opportunityId}:UPDATE_META_DESCRIPTION:sp-tamp`,
        actionType: "UPDATE_META_DESCRIPTION",
        targetUrl: `https://${ctx.siteId}.d8-test.local/page`,
        targetModel: "Blog",
        targetId: ctx.id("blog-tamp"),
        proposedChanges: tamperedChanges, // ← TAMPERED
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
        approvalExpiresAt: new Date(now.getTime() + 3600_000), // Valid TTL
        approvalHash, // ← Hash of ORIGINAL (non-tampered) changes
        generatedBy: "system:d8-test",
        verificationCriteria: [],
      },
    });

    const { runAction } = await import("@/lib/proposals/action-runner");
    execResult = await runAction({ proposalId });
  }, 60_000);

  afterAll(async () => {
    if (prisma && ctx) await cleanupContext(prisma, ctx);
  }, 30_000);

  it("2.2.1 result.status === FAILED with hash mismatch", () => {
    expect(execResult.status).toBe("FAILED");
    expect(execResult.error).toMatch(/hash mismatch/i);
  });

  it("2.2.2 proposal.status remains APPROVED in DB (no status transition for hash failure)", async () => {
    const p = await (prisma as any).actionProposal.findUnique({
      where: { id: proposalId },
      select: { status: true },
    });
    // Hash mismatch doesn't trigger an EXPIRED transition — proposal stays APPROVED
    expect(p.status).toBe("APPROVED");
  });

  it("2.2.3 no MutationOperation created", () => {
    expect(execResult.operationId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §3 — TIER GATE: DRAFT CANNOT AUTO-EXECUTE
// ═══════════════════════════════════════════════════════════════════════════════

describeIf("§3 Tier 2 DRAFT proposal → runAction REJECTED, no mutation", () => {
  let ctx: TestContext;
  let prisma: any;
  let proposalId: string;
  let execResult: any;

  beforeAll(async () => {
    assertStagingDatabase();
    ({ prisma } = await import("@/lib/prisma"));
    ctx = makeTestContext("sp-tiergate", Date.now());

    await seedUser(prisma, ctx.userId);
    await seedSite(prisma, ctx.siteId, ctx.userId);
    const opportunityId = await seedOpportunity(prisma, ctx, {
      opportunityId: ctx.id("opp-tg"),
      action: "CHANGE_CANONICAL",
      opportunityStatus: "PROPOSED",
    });

    proposalId = ctx.id("proposal-tg");

    await (prisma as any).actionProposal.create({
      data: {
        id: proposalId,
        siteId: ctx.siteId,
        decisionId: opportunityId,
        idempotencyKey: `op:${ctx.siteId}:${opportunityId}:CHANGE_CANONICAL:sp-tg`,
        actionType: "CHANGE_CANONICAL",
        targetUrl: `https://${ctx.siteId}.d8-test.local/page`,
        targetModel: "Blog",
        targetId: ctx.id("blog-tg"),
        proposedChanges: [
          { field: "canonicalUrl", currentValue: "/old", proposedValue: "/new", reasoning: "test" },
        ],
        expectedOutcome: "Test",
        riskLevel: "MEDIUM",
        safetyTier: 2,
        confidence: 0.85,
        status: "DRAFT", // ← NOT APPROVED
        requiresApproval: true,
        attemptCount: 0,
        maxAttempts: 2,
        generatedBy: "system:d8-test",
        verificationCriteria: [],
      },
    });

    const { runAction } = await import("@/lib/proposals/action-runner");
    execResult = await runAction({ proposalId });
  }, 60_000);

  afterAll(async () => {
    if (prisma && ctx) await cleanupContext(prisma, ctx);
  }, 30_000);

  it("3.1 result.status === FAILED — action-runner rejects non-APPROVED proposals", () => {
    expect(execResult.status).toBe("FAILED");
    expect(execResult.error).toContain("DRAFT");
    expect(execResult.error).toContain("expected APPROVED");
  });

  it("3.2 proposal.status remains DRAFT in DB", async () => {
    const p = await (prisma as any).actionProposal.findUnique({
      where: { id: proposalId },
      select: { status: true, safetyTier: true, requiresApproval: true },
    });
    expect(p.status).toBe("DRAFT");
    expect(p.safetyTier).toBe(2);
    expect(p.requiresApproval).toBe(true);
  });

  it("3.3 no MutationOperation created", () => {
    expect(execResult.operationId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §4 — LIVE KILL SWITCH: automationsPaused SITE
// ═══════════════════════════════════════════════════════════════════════════════

describeIf("§4 Site automationsPaused → real kill switch → BLOCKED, FAILED cascade", () => {
  let ctx: TestContext;
  let prisma: any;
  let proposalId: string;
  let opportunityId: string;
  let blogId: string;
  let execResult: any;

  beforeAll(async () => {
    assertStagingDatabase();
    ({ prisma } = await import("@/lib/prisma"));
    ctx = makeTestContext("sp-killswitch", Date.now());

    await seedUser(prisma, ctx.userId);
    // Seed site with automationsPaused: true
    await seedSite(prisma, ctx.siteId, ctx.userId, {
      automationsPaused: true,
    });

    opportunityId = await seedOpportunity(prisma, ctx, {
      opportunityId: ctx.id("opp-ks"),
      opportunityStatus: "APPROVED",
    });

    // Seed a real Blog so resolveTargetEntity succeeds
    blogId = ctx.id("blog-ks");
    await (prisma as any).blog.create({
      data: {
        id: blogId,
        siteId: ctx.siteId,
        pipelineType: "STANDARD",
        title: "D8 Kill Switch Live Test Blog",
        slug: `d8-ks-live-${ctx.prefix}`,
        content: "Test content for live kill switch safety proof",
        status: "PUBLISHED",
        version: 1,
      },
    });

    proposalId = ctx.id("proposal-ks");
    const now = new Date();
    const changes = [
      { field: "metaDescription", currentValue: "old", proposedValue: "new meta for kill switch test", reasoning: "test" },
    ];
    const approvalHash = hashProposedChanges(
      "UPDATE_META_DESCRIPTION",
      `https://${ctx.siteId}.d8-test.local/page`,
      changes,
    );

    await (prisma as any).actionProposal.create({
      data: {
        id: proposalId,
        siteId: ctx.siteId,
        decisionId: opportunityId,
        idempotencyKey: `op:${ctx.siteId}:${opportunityId}:UPDATE_META_DESCRIPTION:sp-ks`,
        actionType: "UPDATE_META_DESCRIPTION",
        targetUrl: `https://${ctx.siteId}.d8-test.local/page`,
        targetModel: "Blog",
        targetId: blogId,
        proposedChanges: changes,
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

    const { runAction } = await import("@/lib/proposals/action-runner");
    execResult = await runAction({ proposalId });
  }, 60_000);

  afterAll(async () => {
    if (prisma && ctx) {
      try { await (prisma as any).blog.deleteMany({ where: { siteId: ctx.siteId } }); } catch {}
      await cleanupContext(prisma, ctx);
    }
  }, 30_000);

  it("4.1 result.status === BLOCKED — real kill switch read automationsPaused from DB", () => {
    expect(execResult.status).toBe("BLOCKED");
    expect(execResult.error).toMatch(/automations paused/i);
  });

  it("4.2 proposal.status === FAILED in DB", async () => {
    const p = await (prisma as any).actionProposal.findUnique({
      where: { id: proposalId },
      select: { status: true, lastAttemptError: true, operationId: true },
    });
    expect(p.status).toBe("FAILED");
    expect(p.lastAttemptError).toMatch(/Kill switch active/i);
    expect(p.operationId).toBeNull();
  });

  it("4.3 opportunity.status === FAILED in DB", async () => {
    await assertOpportunityStatus(prisma, opportunityId, "FAILED");
  });

  it("4.4 no MutationOperation created", () => {
    expect(execResult.operationId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §5 — RISK ENGINE: PROTECTED FIELD ESCALATION
// ═══════════════════════════════════════════════════════════════════════════════

describe("§5 Risk engine: protected field forces minimum HIGH", () => {
  it("5.1 canonicalUrl → HIGH risk, score ≥ 50, 'Protected field' in reasons", () => {
    const result = calculateOperationRisk({
      mutationType: "BLOG_CONTENT_UPDATE",
      affectedFields: ["canonicalUrl"],
      diffSizeBytes: 200,
      targetModel: "Blog",
      sitePageCount: 100,
      affectedUrlCount: 1,
    });
    expect(result.riskLevel).toBe("HIGH");
    expect(result.riskScore).toBeGreaterThanOrEqual(50);
    expect(result.reasons.some((r: string) => r.includes("Protected field"))).toBe(true);
  });

  it("5.2 metaDescription → NOT HIGH (SEO-sensitive but not protected)", () => {
    const result = calculateOperationRisk({
      mutationType: "BLOG_CONTENT_UPDATE",
      affectedFields: ["metaDescription"],
      diffSizeBytes: 200,
      targetModel: "Blog",
      sitePageCount: 100,
      affectedUrlCount: 1,
    });
    expect(result.riskLevel).not.toBe("HIGH");
    expect(result.riskLevel).not.toBe("CRITICAL");
  });

  it("5.3 CHANGE_CANONICAL is Tier 2 → proposal riskLevel MEDIUM, but risk engine escalates to HIGH at operation level", () => {
    // Tier-derived proposal risk
    const tier = SAFETY_TIER_MAP["CHANGE_CANONICAL"];
    expect(tier).toBe(2);
    const proposalRisk = tier <= 1 ? "LOW" : tier === 2 ? "MEDIUM" : "HIGH";
    expect(proposalRisk).toBe("MEDIUM");

    // Operation-level risk engine escalates because canonicalUrl is protected
    const opRisk = calculateOperationRisk({
      mutationType: "BLOG_CONTENT_UPDATE",
      affectedFields: ["canonicalUrl"],
      diffSizeBytes: 200,
      targetModel: "Blog",
      sitePageCount: 100,
      affectedUrlCount: 1,
    });
    expect(opRisk.riskLevel).toBe("HIGH");

    // The two-layer model: proposal uses tier (MEDIUM), operation escalates (HIGH)
    expect(opRisk.riskLevel).not.toBe(proposalRisk);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §6 — STATE MACHINE: ILLEGAL TRANSITION REJECTION
// ═══════════════════════════════════════════════════════════════════════════════

describeIf("§6 State machine rejects illegal OPEN → EXECUTING transition at DB layer", () => {
  let ctx: TestContext;
  let prisma: any;
  let opportunityId: string;

  beforeAll(async () => {
    assertStagingDatabase();
    ({ prisma } = await import("@/lib/prisma"));
    ctx = makeTestContext("sp-statemachine", Date.now());

    await seedUser(prisma, ctx.userId);
    await seedSite(prisma, ctx.siteId, ctx.userId);
    opportunityId = await seedOpportunity(prisma, ctx, {
      opportunityId: ctx.id("opp-sm"),
      opportunityStatus: "OPEN",
    });
  }, 60_000);

  afterAll(async () => {
    if (prisma && ctx) await cleanupContext(prisma, ctx);
  }, 30_000);

  it("6.1 OpportunityTransitionError is thrown for OPEN → EXECUTING", async () => {
    const { transitionOpportunity } = await import(
      "@/lib/proposals/opportunity-lifecycle"
    );

    await expect(
      transitionOpportunity({
        decisionId: opportunityId,
        from: "OPEN",
        to: "EXECUTING",
        actorId: "system:d8-test",
      }),
    ).rejects.toThrow(OpportunityTransitionError);
  });

  it("6.2 opportunity status remains OPEN in DB after rejected transition", async () => {
    await assertOpportunityStatus(prisma, opportunityId, "OPEN");
  });
});
