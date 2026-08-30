/**
 * POST /api/proposals/[id]/retry
 *
 * Manually retries a FAILED proposal.
 * Archives the failed proposal, re-opens the opportunity, and queues a fresh generation.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { RETRY_POLICIES } from "@/lib/proposals";
import type { SafetyTier } from "@/lib/proposals";

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

    const site = await prisma.site.findFirst({
      where: { id: proposal.siteId, userId },
      select: { id: true },
    });
    if (!site) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    if (proposal.status !== "FAILED") {
      return NextResponse.json(
        { error: `Cannot retry proposal in ${proposal.status} status — must be FAILED` },
        { status: 409 }
      );
    }

    // Respect max attempts
    const tier = ((proposal.safetyTier as number) ?? 1) as SafetyTier;
    const policy = RETRY_POLICIES[tier];
    if (proposal.attemptCount >= policy.maxAttempts) {
      return NextResponse.json(
        {
          error: `Max retry attempts (${policy.maxAttempts}) reached for Tier ${tier} proposal. Create a new proposal instead.`,
        },
        { status: 422 }
      );
    }

    const now = new Date();

    // Archive the failed proposal
    await (prisma as any).actionProposal.update({
      where: { id: params.id },
      data: {
        status: "REJECTED",
        completedAt: now,
        lastAttemptError: `Manually retried by user:${userId}`,
      },
    });

    // Re-open the opportunity
    await prisma.growthDecision.updateMany({
      where: {
        id: proposal.decisionId,
        ...(({ opportunityStatus: "FAILED" }) as any),
      },
      data: {
        ...(({ opportunityStatus: "OPEN" }) as any),
        updatedAt: now,
      },
    });

    // Trigger fresh proposal generation
    await inngest.send({
      name: "proposal.generate",
      data: { decisionId: proposal.decisionId, siteId: proposal.siteId },
    });

    logger.info("[ProposalsAPI] Proposal retry triggered", {
      proposalId: proposal.id,
      decisionId: proposal.decisionId,
      retriedBy: userId,
    });

    return NextResponse.json({
      success: true,
      message: "Opportunity re-opened and new proposal generation queued.",
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
