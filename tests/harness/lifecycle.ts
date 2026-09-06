/**
 * D.8.1.1 — Lifecycle Builder
 *
 * Composite helper that advances an opportunity through the autonomous
 * pipeline to a desired lifecycle stage using real DB operations.
 *
 * Usage:
 *   const { opportunityId, scoreRecordId, allocationId } =
 *     await buildLifecycle(db, ctx, { targetStage: "SELECTED" });
 *
 * Infrastructure: LIVE_DB
 */

import {
  makeTestContext,
  seedUser,
  seedSite,
  seedOpportunity,
  seedScoreRecord,
  seedAllocation,
  seedProposal,
  seedTrace,
  type TestContext,
  type SiteOverrides,
  type OpportunityOverrides,
  type ScoreOverrides,
  type AllocationOverrides,
  type ProposalOverrides,
} from "./fixtures";

// ── Lifecycle Stage ───────────────────────────────────────────────────────────

/**
 * Ordered lifecycle stages for the autonomous pipeline.
 * Each stage is a superset of the previous.
 */
export type LifecycleStage =
  | "SEEDED"      // Site + user created
  | "OPEN"        // GrowthDecision with opportunityStatus=OPEN
  | "SCORED"      // OpportunityScoreRecord with PROMOTE decision
  | "SELECTED"    // PortfolioAllocation with SELECTED decision
  | "PLANNED"     // ActionProposal in DRAFT status
  | "TRACE"       // ExecutionTrace created (authorization pending)
  | "AUTHORIZED"; // ExecutionTrace with AUTO_EXECUTE decision

// ── Lifecycle State ───────────────────────────────────────────────────────────

export interface LifecycleState {
  ctx: TestContext;
  siteId: string;
  opportunityId: string;
  scoreRecordId?: string;
  allocationId?: string;
  proposalId?: string;
  traceId?: string;
  stage: LifecycleStage;
}

// ── Builder Options ───────────────────────────────────────────────────────────

export interface BuildLifecycleOptions {
  targetStage: LifecycleStage;
  ctx?: TestContext;
  site?: SiteOverrides;
  opportunity?: OpportunityOverrides;
  score?: ScoreOverrides;
  allocation?: AllocationOverrides;
  proposal?: ProposalOverrides;
}

const STAGE_ORDER: LifecycleStage[] = [
  "SEEDED",
  "OPEN",
  "SCORED",
  "SELECTED",
  "PLANNED",
  "TRACE",
  "AUTHORIZED",
];

function stageIndex(stage: LifecycleStage): number {
  return STAGE_ORDER.indexOf(stage);
}

// ── Main Builder ─────────────────────────────────────────────────────────────

/**
 * Seeds the database to the requested lifecycle stage.
 *
 * Each call uses a fresh TestContext (or accepts one if provided).
 * The returned state has all IDs needed for downstream assertions.
 */
export async function buildLifecycle(
  db: any,
  options: BuildLifecycleOptions
): Promise<LifecycleState> {
  const ctx = options.ctx ?? makeTestContext("lifecycle");
  const target = stageIndex(options.targetStage);

  const state: LifecycleState = {
    ctx,
    siteId: ctx.siteId,
    opportunityId: ctx.id("opp"),
    stage: "SEEDED",
  };

  // ── SEEDED ────────────────────────────────────────────────────────────────
  await seedUser(db, ctx.userId);
  await seedSite(db, ctx.siteId, ctx.userId, options.site ?? {});

  if (target <= stageIndex("SEEDED")) return state;

  // ── OPEN ──────────────────────────────────────────────────────────────────
  state.opportunityId = await seedOpportunity(db, ctx, {
    opportunityId: ctx.id("opp"),
    ...options.opportunity,
  });
  state.stage = "OPEN";

  if (target <= stageIndex("OPEN")) return state;

  // ── SCORED ────────────────────────────────────────────────────────────────
  state.scoreRecordId = await seedScoreRecord(db, state.opportunityId, options.score ?? {});
  state.stage = "SCORED";

  if (target <= stageIndex("SCORED")) return state;

  // ── SELECTED ──────────────────────────────────────────────────────────────
  state.allocationId = await seedAllocation(
    db,
    ctx,
    state.opportunityId,
    state.scoreRecordId!,
    options.allocation ?? {}
  );
  state.stage = "SELECTED";

  if (target <= stageIndex("SELECTED")) return state;

  // ── PLANNED ───────────────────────────────────────────────────────────────
  state.proposalId = await seedProposal(db, ctx, state.opportunityId, options.proposal ?? {});
  state.stage = "PLANNED";

  if (target <= stageIndex("PLANNED")) return state;

  // ── TRACE ─────────────────────────────────────────────────────────────────
  state.traceId = await seedTrace(db, ctx, state.opportunityId, {
    actionType: options.opportunity?.action ?? "UPDATE_META_DESCRIPTION",
    policyDecision: "BLOCKED",
    policyReason: "Trace created — authorization pending",
  });
  state.stage = "TRACE";

  if (target <= stageIndex("TRACE")) return state;

  // ── AUTHORIZED ────────────────────────────────────────────────────────────
  await db.executionTrace.update({
    where: { id: state.traceId },
    data: {
      policyDecision: "AUTO_EXECUTE",
      policyReason: "All gates passed — D8 test fixture",
      authorizedAt: new Date(),
    },
  });
  state.stage = "AUTHORIZED";

  return state;
}
