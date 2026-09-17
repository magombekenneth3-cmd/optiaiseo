/**
 * POST /api/proposals/[id]/ready
 *
 * Promotes a planner-created DRAFT into the human-review queue.
 *
 * Transitions:
 *   Proposal:    DRAFT → READY
 *   Opportunity: OPEN → PROPOSED (when it has not already been proposed)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { transitionOpportunity } from "@/lib/proposals/opportunity-lifecycle";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const body = await req.json().catch(() => ({}));
    const comment = typeof body?.comment === "string" ? body.comment.trim() : "";

    const proposal = await (prisma as any).actionProposal.findUnique({
      where: { id },
      select: {
        id: true,
        siteId: true,
        decisionId: true,
        status: true,
      },
    });
    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }

    // Viewers may inspect proposals but only the site owner may advance one.
    const site = await prisma.site.findFirst({
      where: { id: proposal.siteId, userId },
      select: { id: true },
    });
    if (!site) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    if (proposal.status !== "DRAFT") {
      return NextResponse.json(
        { error: `Cannot mark proposal ${proposal.status} as ready — must be DRAFT` },
        { status: 409 }
      );
    }

    const decision = await prisma.growthDecision.findUnique({
      where: { id: proposal.decisionId },
      select: { opportunityStatus: true },
    });
    if (!decision) {
      return NextResponse.json({ error: "Decision not found" }, { status: 404 });
    }
    if (!["OPEN", "PROPOSED"].includes(decision.opportunityStatus)) {
      return NextResponse.json(
        {
          error: `Cannot mark proposal ready while its opportunity is ${decision.opportunityStatus}`,
        },
        { status: 409 }
      );
    }

    // First move the proposal under a compare-and-swap guard. If promotion of
    // the related opportunity then fails, restore DRAFT so the two lifecycles
    // are not left claiming different stages.
    const promoted = await (prisma as any).actionProposal.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "READY" },
    });
    if (promoted.count !== 1) {
      return NextResponse.json(
        { error: "Proposal changed while it was being prepared for review" },
        { status: 409 }
      );
    }

    if (decision.opportunityStatus === "OPEN") {
      try {
        const transitioned = await transitionOpportunity({
          decisionId: proposal.decisionId,
          from: "OPEN",
          to: "PROPOSED",
          actorId: `user:${userId}`,
          reason: comment || "Draft marked ready for human review",
          proposalId: proposal.id,
        });

        if (!transitioned) {
          await (prisma as any).actionProposal.updateMany({
            where: { id, status: "READY" },
            data: { status: "DRAFT" },
          });
          return NextResponse.json(
            { error: "Opportunity changed while the proposal was being prepared" },
            { status: 409 }
          );
        }
      } catch (error) {
        await (prisma as any).actionProposal.updateMany({
          where: { id, status: "READY" },
          data: { status: "DRAFT" },
        });
        throw error;
      }
    }

    logger.info("[ProposalsAPI] Draft marked ready for review", {
      proposalId: proposal.id,
      preparedBy: userId,
      decisionId: proposal.decisionId,
    });

    return NextResponse.json({
      success: true,
      proposalId: proposal.id,
      status: "READY",
      message: "Proposal is ready for review and approval.",
    });
  } catch (error: unknown) {
    logger.error("[ProposalsAPI] POST /ready failed", {
      id,
      error: (error as Error)?.message,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
