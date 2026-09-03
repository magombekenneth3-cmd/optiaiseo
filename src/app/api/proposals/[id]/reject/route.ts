/**
 * POST /api/proposals/[id]/reject
 *
 * Rejects a READY or APPROVED proposal. Transitions the opportunity through
 * the state machine: PROPOSED → REJECTED or APPROVED → REJECTED.
 *
 * All opportunity status changes go through transitionOpportunity() to
 * enforce state-machine guards and produce an audit event.
 *
 * Body: { reason?: string }
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
    const reason = (body?.reason as string) ?? "Rejected by user";

    const proposal = await (prisma as any).actionProposal.findUnique({
      where: { id },
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

    if (!["READY", "APPROVED"].includes(proposal.status)) {
      return NextResponse.json(
        { error: `Cannot reject proposal in ${proposal.status} status` },
        { status: 409 }
      );
    }

    const now = new Date();
    const actorId = `user:${userId}`;

    // Transition proposal → REJECTED
    await (prisma as any).actionProposal.update({
      where: { id },
      data: { status: "REJECTED", completedAt: now, lastAttemptError: reason },
    });

    // Transition opportunity through the state machine.
    // The proposal may be in READY (opportunity = PROPOSED) or APPROVED
    // (opportunity = APPROVED). Try PROPOSED → REJECTED first; if the guard
    // fails (already moved), try APPROVED → REJECTED.
    // Both paths are valid per OPPORTUNITY_TRANSITIONS.
    const rejectedFromProposed = await transitionOpportunity({
      decisionId: proposal.decisionId,
      from: "PROPOSED",
      to: "REJECTED",
      actorId,
      reason,
      proposalId: proposal.id,
    });

    if (!rejectedFromProposed) {
      await transitionOpportunity({
        decisionId: proposal.decisionId,
        from: "APPROVED",
        to: "REJECTED",
        actorId,
        reason,
        proposalId: proposal.id,
      });
    }

    logger.info("[ProposalsAPI] Proposal rejected", {
      proposalId: proposal.id,
      rejectedBy: userId,
      reason,
    });

    return NextResponse.json({
      success: true,
      proposalId: proposal.id,
      status: "REJECTED",
      reason,
    });
  } catch (err: unknown) {
    logger.error("[ProposalsAPI] POST /reject failed", {
      id,
      error: (err as Error)?.message,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
