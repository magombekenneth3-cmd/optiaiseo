/**
 * POST /api/proposals/[id]/retry
 *
 * Retries a FAILED proposal by re-opening the opportunity and queuing a fresh
 * proposal generation with explicit lineage.
 *
 * Contract:
 *   - The FAILED proposal stays FAILED permanently (terminal — audit trail preserved)
 *   - The opportunity transitions: FAILED → OPEN (via transitionOpportunity — state machine enforced)
 *   - A fresh proposal.generate event is fired with previousProposalId for lineage
 *   - Retry count and policy are enforced before proceeding
 *
 * Transitions:
 *   Proposal:    FAILED → stays FAILED (terminal)
 *   Opportunity: FAILED → OPEN
 *   New Proposal: (created fresh by proposal.generate handler)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { RETRY_POLICIES } from "@/lib/proposals";
import type { SafetyTier } from "@/lib/proposals";
import { transitionOpportunity } from "@/lib/proposals/opportunity-lifecycle";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const proposal = await (prisma as any).actionProposal.findUnique({
      where: { id: params.id },
    });
    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }

    // Verify site ownership
    const site = await prisma.site.findFirst({
      where: { id: proposal.siteId, userId },
      select: { id: true },
    });
    if (!site) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Only FAILED proposals can be retried
    if (proposal.status !== "FAILED") {
      return NextResponse.json(
        { error: `Cannot retry proposal in ${proposal.status} status — must be FAILED` },
        { status: 409 }
      );
    }

    // Enforce retry policy for this safety tier
    const tier = ((proposal.safetyTier as number) ?? 1) as SafetyTier;
    const policy = RETRY_POLICIES[tier];
    if (proposal.attemptCount >= policy.maxAttempts) {
      return NextResponse.json(
        {
          error: `Max retry attempts (${policy.maxAttempts}) reached for Tier ${tier} proposal. Create a new proposal instead.`,
          canRetry: false,
        },
        { status: 422 }
      );
    }

    // Verify the opportunity is still in a retryable state
    const decision = await prisma.growthDecision.findUnique({
      where: { id: proposal.decisionId },
      select: { id: true, opportunityStatus: true },
    });
    if (!decision) {
      return NextResponse.json({ error: "Decision not found" }, { status: 404 });
    }
    if (decision.opportunityStatus === "VERIFIED") {
      return NextResponse.json(
        { error: "Opportunity is already VERIFIED — retry is not needed" },
        { status: 409 }
      );
    }

    const actorId = `user:${userId}`;

    // ── The FAILED proposal stays FAILED (terminal). Do NOT change its status. ──
    logger.info("[ProposalsAPI] Retry initiated — FAILED proposal preserved as audit trail", {
      failedProposalId: proposal.id,
      decisionId: proposal.decisionId,
      retriedBy: userId,
    });

    // Re-open the opportunity through the state machine: FAILED → OPEN
    const applied = await transitionOpportunity({
      decisionId: proposal.decisionId,
      from: "FAILED",
      to: "OPEN",
      actorId,
      reason: "Retry requested by user",
      proposalId: proposal.id,
    });

    if (!applied) {
      // Opportunity already moved — possibly another retry or recovery is in progress
      logger.warn("[ProposalsAPI] Retry: opportunity status had already changed — proceeding anyway", {
        failedProposalId: proposal.id,
        decisionId: proposal.decisionId,
      });
    }

    // Trigger a fresh proposal.generate with lineage link
    await inngest.send({
      name: "proposal.generate",
      data: {
        decisionId: proposal.decisionId,
        siteId: proposal.siteId,
        previousProposalId: proposal.id,
      },
    });

    logger.info("[ProposalsAPI] Retry queued — new proposal will be generated", {
      failedProposalId: proposal.id,
      decisionId: proposal.decisionId,
      retriedBy: userId,
    });

    return NextResponse.json({
      success: true,
      message: "Opportunity re-opened. A new proposal is being generated with retry lineage.",
      failedProposalId: proposal.id,
      decisionId: proposal.decisionId,
    });
  } catch (err: unknown) {
    logger.error("[ProposalsAPI] POST /retry failed", {
      id: params.id,
      error: (err as Error)?.message,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
