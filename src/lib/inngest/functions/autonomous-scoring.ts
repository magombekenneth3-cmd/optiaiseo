/**
 * Phase D.2 — Autonomous Scoring (Inngest Functions)
 *
 * Event chain:
 *   opportunity.candidate.created → autonomous-scoring-candidate
 *     → scoreCandidate()
 *     → if PROMOTE: CANDIDATE → OPEN (via promoter)
 *
 * Reconciliation (every 30 min) catches stranded CANDIDATE records.
 *
 * INVARIANT: Scoring is observational — it does not execute, generate
 * mutation proposals, reserve budgets, or perform Phase C authorization.
 * The ONLY mutation is CANDIDATE → OPEN (via promoter.ts).
 */

import { inngest } from "../client";
import { logger } from "@/lib/logger";
import { scoreCandidate } from "@/lib/scoring/scorer";

// ── 1. Per-Candidate Scoring (Event-Triggered) ─────────────────────────────

export const autonomousScoringCandidate = inngest.createFunction(
  {
    id: "autonomous-scoring-candidate",
    name: "Autonomous Scoring: Per-Candidate",
    retries: 2,
    concurrency: { limit: 5 },
    triggers: [{ event: "opportunity.candidate.created" }],
  },
  async ({
    event,
    step,
  }: {
    event: {
      data: {
        opportunityId: string;
        siteId: string;
        fingerprint?: string;
      };
    };
    step: any;
  }) => {
    const { opportunityId, siteId } = event.data;

    // Score the candidate
    const result = await step.run("score-candidate", async () => {
      return scoreCandidate(opportunityId);
    });

    logger.info("[AutonomousScoring] Candidate scored", {
      opportunityId,
      siteId,
      decision: result.decision,
      finalScore: result.finalScore,
      promoted: result.promoted,
    });

    return {
      status: "COMPLETED",
      opportunityId,
      decision: result.decision,
      finalScore: result.finalScore,
      promoted: result.promoted ?? false,
      promotionReason: result.promotionReason,
    };
  }
);

// ── 2. Reconciliation (Periodic) ────────────────────────────────────────────

/**
 * Finds stranded CANDIDATE records that haven't been scored,
 * or whose scores are stale (scored > 24h ago with no promotion).
 *
 * Emits opportunity.candidate.created for each to trigger scoring.
 */
export const autonomousScoringReconcile = inngest.createFunction(
  {
    id: "autonomous-scoring-reconcile",
    name: "Autonomous Scoring: Reconcile",
    retries: 1,
    triggers: [{ cron: "*/30 * * * *" }], // Every 30 minutes
  },
  async ({ step }: { step: any }) => {
    const MS_PER_HOUR = 60 * 60 * 1000;
    const STALE_THRESHOLD_HOURS = 24;

    // Find CANDIDATE records that haven't been scored recently
    const candidates = await step.run("find-unscored-candidates", async () => {
      const { prisma } = await import("@/lib/prisma");
      const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_HOURS * MS_PER_HOUR);

      return (prisma as any).growthDecision.findMany({
        where: {
          opportunityStatus: "CANDIDATE",
          OR: [
            { lastScoredAt: null },
            { lastScoredAt: { lt: staleThreshold } },
          ],
        },
        select: { id: true, siteId: true, fingerprint: true },
        take: 50, // Batch limit
      }) as Promise<{ id: string; siteId: string; fingerprint: string | null }[]>;
    });

    if (candidates.length === 0) {
      return { queued: 0 };
    }

    // Emit scoring events
    const events = candidates.map((c: any) => ({
      name: "opportunity.candidate.created",
      data: {
        opportunityId: c.id,
        siteId: c.siteId,
        fingerprint: c.fingerprint,
      },
    }));

    await step.sendEvent("reconcile-scoring-events", events);

    logger.info("[ScoringReconcile] Reconciliation complete", {
      candidatesFound: candidates.length,
      eventsQueued: events.length,
    });

    return { queued: events.length };
  }
);
