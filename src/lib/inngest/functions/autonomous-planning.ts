/**
 * Phase D.3 — Autonomous Planning (Inngest Functions)
 *
 * Event chain:
 *   opportunity.opened → autonomous-planning-opportunity
 *     → planOpportunity()
 *     → if PLAN: ActionProposal(DRAFT) created
 *
 * Reconciliation (every 30 min) catches stranded OPEN records
 * that don't have an active proposal.
 *
 * INVARIANT: Planning is observational — it produces DRAFT proposals.
 * It does NOT execute, authorize, reserve budgets, or perform
 * Phase C authorization. The ONLY persistence is the DRAFT proposal
 * via the pure createDraftProposal() boundary.
 */

import { inngest } from "../client";
import { logger } from "@/lib/logger";
import { planOpportunity } from "@/lib/planning/planner";
import { ACTIVE_PROPOSAL_STATUSES } from "@/lib/proposals/draft-proposal";

// ── 1. Per-Opportunity Planning (Event-Triggered) ───────────────────────────

export const autonomousPlanningOpportunity = inngest.createFunction(
  {
    id: "autonomous-planning-opportunity",
    name: "Autonomous Planning: Per-Opportunity",
    retries: 2,
    concurrency: { limit: 5 },
    triggers: [{ event: "opportunity.opened" }],
  },
  async ({
    event,
    step,
  }: {
    event: {
      data: {
        opportunityId: string;
        siteId: string;
        finalScore?: number;
        scoringVersion?: string;
      };
    };
    step: any;
  }) => {
    const { opportunityId, siteId } = event.data;

    // Plan the opportunity
    const result = await step.run("plan-opportunity", async () => {
      return planOpportunity(opportunityId);
    });

    logger.info("[AutonomousPlanning] Opportunity planned", {
      opportunityId,
      siteId,
      decision: result.decision,
      proposalId: result.proposalId,
      proposalStatus: result.proposalStatus,
    });

    return {
      status: "COMPLETED",
      opportunityId,
      decision: result.decision,
      proposalId: result.proposalId,
      proposalStatus: result.proposalStatus,
      reasons: result.reasons,
    };
  }
);

// ── 2. Reconciliation (Periodic) ────────────────────────────────────────────

/**
 * Finds OPEN opportunities that don't have an active proposal.
 * Emits opportunity.opened for each to trigger planning.
 *
 * This handles:
 *   - Events lost after successful promotion (inngest.send failure)
 *   - Proposals that were REJECTED/EXPIRED leaving opportunity OPEN
 */
export const autonomousPlanningReconcile = inngest.createFunction(
  {
    id: "autonomous-planning-reconcile",
    name: "Autonomous Planning: Reconcile",
    retries: 1,
    triggers: [{ cron: "*/30 * * * *" }], // Every 30 minutes
  },
  async ({ step }: { step: any }) => {
    // Find OPEN opportunities without active proposals
    const unplanned = await step.run("find-unplanned-open", async () => {
      const { prisma } = await import("@/lib/prisma");

      // Get all OPEN opportunities
      const openOpportunities = await (prisma as any).growthDecision.findMany({
        where: {
          opportunityStatus: "OPEN",
        },
        select: { id: true, siteId: true },
        take: 50,
      });

      if (openOpportunities.length === 0) return [];

      // Filter to those without active proposals
      const result: Array<{ id: string; siteId: string }> = [];

      for (const opp of openOpportunities as Array<{ id: string; siteId: string }>) {
        const activeProposal = await (prisma as any).actionProposal.findFirst({
          where: {
            decisionId: opp.id,
            status: { in: [...ACTIVE_PROPOSAL_STATUSES] },
          },
          select: { id: true },
        });

        if (!activeProposal) {
          result.push(opp);
        }
      }

      return result;
    });

    if (unplanned.length === 0) {
      return { queued: 0 };
    }

    // Emit planning events
    const events = unplanned.map((opp: { id: string; siteId: string }) => ({
      name: "opportunity.opened",
      data: {
        opportunityId: opp.id,
        siteId: opp.siteId,
      },
    }));

    await step.sendEvent("reconcile-planning-events", events);

    logger.info("[PlanningReconcile] Reconciliation complete", {
      openFound: unplanned.length,
      eventsQueued: events.length,
    });

    return { queued: events.length };
  }
);
