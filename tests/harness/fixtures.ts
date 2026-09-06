/**
 * D.8.1.1 — Fixture Factories
 *
 * Deterministic, isolated seed helpers for all D.8 test suites.
 * Every factory accepts explicit IDs so tests control isolation.
 *
 * Usage:
 *   const ctx = makeTestContext("my-test");
 *   await seedSite(prisma, ctx.siteId, ctx.userId);
 *   await seedOpportunity(prisma, ctx, { action: "UPDATE_META_DESCRIPTION" });
 *
 * Infrastructure: LIVE_DB (all factories write to DB)
 */

import type { PrismaClient } from "@prisma/client";

// ── Test Context ─────────────────────────────────────────────────────────────

export interface TestContext {
  /** Unique prefix for all IDs in this test run */
  prefix: string;
  siteId: string;
  userId: string;
  /** Generates a stable ID under this context */
  id: (name: string) => string;
}

/** Creates a deterministic test context. Call once per test/suite. */
export function makeTestContext(label: string, ts?: number): TestContext {
  const stamp = ts ?? Date.now();
  const prefix = `d8-${label}-${stamp}`;
  return {
    prefix,
    siteId: `${prefix}-site`,
    userId: `${prefix}-user`,
    id: (name: string) => `${prefix}-${name}`,
  };
}

// ── Site ─────────────────────────────────────────────────────────────────────

export interface SiteOverrides {
  operatingMode?: string;
  dailyMutationLimit?: number;
  maxConcurrentExecutions?: number;
  automationsPaused?: boolean;
}

export async function seedUser(db: any, userId: string): Promise<void> {
  await db.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      name: "D8 Test User",
      email: `${userId}@d8-test.local`,
    },
  });
}

export async function seedSite(
  db: any,
  siteId: string,
  userId: string,
  overrides: SiteOverrides = {}
): Promise<void> {
  await db.site.upsert({
    where: { id: siteId },
    update: {},
    create: {
      id: siteId,
      userId,
      domain: `${siteId}.d8-test.local`,
      operatingMode: overrides.operatingMode ?? "AUTOPILOT",
      dailyMutationLimit: overrides.dailyMutationLimit ?? 10,
      maxConcurrentExecutions: overrides.maxConcurrentExecutions ?? 3,
      automationsPaused: overrides.automationsPaused ?? false,
    },
  });
}

// ── Opportunity (GrowthDecision) ──────────────────────────────────────────────

export interface OpportunityOverrides {
  opportunityId?: string;
  action?: string;
  primaryCategory?: string;
  primaryKeyword?: string;
  opportunityStatus?: string;
  url?: string;
  expiresAt?: Date | null;
}

export async function seedOpportunity(
  db: any,
  ctx: TestContext,
  overrides: OpportunityOverrides = {}
): Promise<string> {
  const opportunityId = overrides.opportunityId ?? ctx.id("opp");
  await db.growthDecision.upsert({
    where: { id: opportunityId },
    update: {},
    create: {
      id: opportunityId,
      siteId: ctx.siteId,
      url: overrides.url ?? `https://${ctx.siteId}.d8-test.local/page`,
      primaryKeyword: overrides.primaryKeyword ?? "test-keyword",
      action: overrides.action ?? "UPDATE_META_DESCRIPTION",
      primaryCategory: overrides.primaryCategory ?? "QUICK_WIN",
      opportunityCategories: [overrides.primaryCategory ?? "QUICK_WIN"],
      score: { finalScore: 80 },
      whyNow: { reason: "test" },
      impact: { expectedUplift: 10 },
      executionPlan: { steps: [] },
      opportunityStatus: overrides.opportunityStatus ?? "OPEN",
      generatedAt: new Date(),
      expiresAt: overrides.expiresAt !== undefined
        ? overrides.expiresAt
        : new Date(Date.now() + 86400_000),
    },
  });
  return opportunityId;
}

// ── Score Record ──────────────────────────────────────────────────────────────

export interface ScoreOverrides {
  scoreRecordId?: string;
  finalScore?: number;
  decision?: string;
  evidenceHash?: string;
  scoringVersion?: string;
  learningVersion?: string | null;
}

export async function seedScoreRecord(
  db: any,
  opportunityId: string,
  overrides: ScoreOverrides = {}
): Promise<string> {
  const record = await db.opportunityScoreRecord.create({
    data: {
      id: overrides.scoreRecordId,
      opportunityId,
      decision: overrides.decision ?? "PROMOTE",
      finalScore: overrides.finalScore ?? 80,
      impactScore: 75,
      confidenceScore: 70,
      evidenceScore: 65,
      urgencyScore: 60,
      effortScore: 30,
      riskScore: 20,
      evidenceHash: overrides.evidenceHash ?? `hash-${opportunityId}`,
      decisionReasons: [{ rule: "TEST", details: "d8 fixture" }],
      weightsUsed: { impact: 0.3, confidence: 0.2, evidence: 0.15, urgency: 0.15, effort: 0.1, risk: 0.1 },
      scoringVersion: overrides.scoringVersion ?? "d2-test",
      learningVersion: overrides.learningVersion ?? null,
    },
  });
  return record.id;
}

// ── Portfolio Allocation ──────────────────────────────────────────────────────

export interface AllocationOverrides {
  decision?: "SELECTED" | "DEFERRED" | "EXCLUDED";
  rank?: number;
  scoreRecordId?: string;
  evidenceHash?: string;
  expiresAt?: Date;
  reason?: string;
}

export async function seedAllocation(
  db: any,
  ctx: TestContext,
  opportunityId: string,
  scoreRecordId: string,
  overrides: AllocationOverrides = {}
): Promise<string> {
  const cycleId = `d7-${ctx.siteId}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const record = await db.portfolioAllocation.create({
    data: {
      siteId: ctx.siteId,
      opportunityId,
      cycleId,
      decision: overrides.decision ?? "SELECTED",
      rank: overrides.rank ?? 1,
      scoreRecordId,
      evidenceHash: overrides.evidenceHash ?? `hash-${opportunityId}`,
      candidateSnapshot: { finalScore: 80, riskScore: 20 },
      constraintSnapshot: { dailyMutationLimit: 10, maxConcurrentExecutions: 3 },
      reason: overrides.reason ?? "D8 fixture",
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 86400_000),
    },
  });
  return record.id;
}

// ── Action Proposal ───────────────────────────────────────────────────────────

export interface ProposalOverrides {
  proposalId?: string;
  status?: string;
  actionType?: string;
  targetUrl?: string;
  requiresApproval?: boolean;
  safetyTier?: number;
  riskLevel?: string;
}

export async function seedProposal(
  db: any,
  ctx: TestContext,
  opportunityId: string,
  overrides: ProposalOverrides = {}
): Promise<string> {
  const proposalId = overrides.proposalId ?? ctx.id("proposal");
  const idempotencyKey = `op:${ctx.siteId}:${opportunityId}:${overrides.actionType ?? "UPDATE_META_DESCRIPTION"}`;

  await db.actionProposal.upsert({
    where: { id: proposalId },
    update: {},
    create: {
      id: proposalId,
      siteId: ctx.siteId,
      decisionId: opportunityId,
      idempotencyKey,
      actionType: overrides.actionType ?? "UPDATE_META_DESCRIPTION",
      targetUrl: overrides.targetUrl ?? `https://${ctx.siteId}.d8-test.local/page`,
      targetModel: "Blog",
      targetId: ctx.id("target"),
      proposedChanges: [{ field: "metaDescription", currentValue: "old", proposedValue: "new" }],
      expectedOutcome: "Improved click-through rate",
      riskLevel: overrides.riskLevel ?? "LOW",
      safetyTier: overrides.safetyTier ?? 1,
      confidence: 0.85,
      status: overrides.status ?? "DRAFT",
      requiresApproval: overrides.requiresApproval ?? false,
    },
  });
  return proposalId;
}

// ── Experiment (D.5) ──────────────────────────────────────────────────────────

export interface ExperimentOverrides {
  experimentId?: string;
  status?: string;
  url?: string;
}

export async function seedExperiment(
  db: any,
  ctx: TestContext,
  opportunityId: string,
  overrides: ExperimentOverrides = {}
): Promise<string> {
  const experimentId = overrides.experimentId ?? ctx.id("experiment");
  const configPayload = {
    siteId: ctx.siteId,
    opportunityId,
    hypothesis: "D8 test experiment",
    successMetric: "clicks_lift",
    successThreshold: 10,
    maxDurationDays: 28,
    maxMutationCount: 1,
    maxBudgetUnits: 1,
  };
  const configHash = Buffer.from(JSON.stringify(configPayload)).toString("base64").slice(0, 44);

  await db.experiment.upsert({
    where: { id: experimentId },
    update: {},
    create: {
      id: experimentId,
      siteId: ctx.siteId,
      opportunityId,
      hypothesis: "D8 test experiment",
      successMetric: "clicks_lift",
      successThreshold: 10,
      status: overrides.status ?? "RUNNING",
      configVersion: "d5-v1",
      configHash,
      maxDurationDays: 28,
      maxMutationCount: 1,
      maxBudgetUnits: 1,
    },
  });
  return experimentId;
}

// ── Execution Trace ───────────────────────────────────────────────────────────

export async function seedTrace(
  db: any,
  ctx: TestContext,
  opportunityId: string,
  overrides: Partial<{
    findingId: string;
    actionType: string;
    safetyTier: number;
    opportunityScore: number;
    operatingMode: string;
    policyDecision: string;
    policyReason: string;
  }> = {}
): Promise<string> {
  const trace = await db.executionTrace.create({
    data: {
      siteId: ctx.siteId,
      triggerType: "CRON",
      opportunityId,
      opportunityScore: overrides.opportunityScore ?? 80,
      actionType: overrides.actionType ?? "UPDATE_META_DESCRIPTION",
      safetyTier: overrides.safetyTier ?? 1,
      operatingMode: overrides.operatingMode ?? "AUTOPILOT",
      effectiveTierLimit: 2,
      policyDecision: overrides.policyDecision ?? "BLOCKED",
      policyReason: overrides.policyReason ?? "Trace created — authorization pending",
      actorType: "SYSTEM",
      actorId: "system:d8-test",
      discoveredAt: new Date(),
      findingId: overrides.findingId,
    },
  });
  return trace.id;
}

// ── Full Cleanup ──────────────────────────────────────────────────────────────

/**
 * Deletes all test data for a given context prefix.
 * Call in afterAll. Safe to call even if seeding partially failed.
 */
export async function cleanupContext(db: any, ctx: TestContext): Promise<void> {
  // Cascade order: allocations → score records → opportunities → proposals → traces → site → user
  try { await db.portfolioAllocation.deleteMany({ where: { siteId: ctx.siteId } }); } catch {}
  try { await db.autonomousExecutionClaim.deleteMany({ where: { siteId: ctx.siteId } }); } catch {}
  try { await db.budgetReservation.deleteMany({ where: { siteId: ctx.siteId } }); } catch {}
  try { await db.executionTrace.deleteMany({ where: { siteId: ctx.siteId } }); } catch {}
  try {
    const opps = await db.growthDecision.findMany({ where: { siteId: ctx.siteId }, select: { id: true } });
    const ids = opps.map((o: any) => o.id);
    if (ids.length) {
      await db.opportunityScoreRecord.deleteMany({ where: { opportunityId: { in: ids } } });
      await db.actionProposal.deleteMany({ where: { decisionId: { in: ids } } });
      await db.experiment.deleteMany({ where: { opportunityId: { in: ids } } });
      await db.growthDecision.deleteMany({ where: { siteId: ctx.siteId } });
    }
  } catch {}
  try { await db.circuitBreaker.deleteMany({ where: { siteId: ctx.siteId } }); } catch {}
  try { await db.site.deleteMany({ where: { id: ctx.siteId } }); } catch {}
  try { await db.user.deleteMany({ where: { id: ctx.userId } }); } catch {}
}
