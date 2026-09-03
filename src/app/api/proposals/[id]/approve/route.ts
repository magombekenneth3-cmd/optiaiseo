/**
 * POST /api/proposals/[id]/approve
 *
 * Approves a READY proposal. Triggers execution via Inngest.
 *
 * Body: { comment?: string }
 *
 * Transitions:
 *   Proposal:    READY → APPROVED
 *   Opportunity: PROPOSED → APPROVED
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { hashProposedChanges, evaluatePolicy } from "@/lib/proposals";
import type { ActionType, ProposedChange } from "@/lib/proposals";
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
    const comment = body?.comment as string | undefined;

    // Load proposal
    const proposal = await (prisma as any).actionProposal.findUnique({
      where: { id },
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

    // Must be READY
    if (proposal.status !== "READY") {
      return NextResponse.json(
        { error: `Cannot approve proposal in ${proposal.status} status — must be READY` },
        { status: 409 }
      );
    }

    const policy = evaluatePolicy(proposal.actionType as ActionType);
    const now = new Date();
    const approvalHash = hashProposedChanges(
      proposal.actionType as ActionType,
      proposal.targetUrl,
      proposal.proposedChanges as ProposedChange[]
    );

    // Transition proposal to APPROVED
    await (prisma as any).actionProposal.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedBy: `user:${userId}`,
        approvedAt: now,
        approvalExpiresAt: new Date(
          now.getTime() + policy.approvalTtlMinutes * 60 * 1000
        ),
        approvalHash,
      },
    });

    // Transition opportunity: PROPOSED → APPROVED
    // Route through transitionOpportunity() to enforce the state machine guard
    // and produce an audit event. Raw updateMany is explicitly prohibited here.
    await transitionOpportunity({
      decisionId: proposal.decisionId,
      from: "PROPOSED",
      to: "APPROVED",
      actorId: `user:${userId}`,
      reason: comment ? `Human approval: ${comment}` : "Human approval via dashboard",
      proposalId: proposal.id,
    });

    // Trigger execution via Inngest
    await inngest.send({
      name: "proposal.execute",
      data: { proposalId: proposal.id, siteId: proposal.siteId },
    });

    logger.info("[ProposalsAPI] Proposal approved", {
      proposalId: proposal.id,
      approvedBy: userId,
    });

    return NextResponse.json({
      success: true,
      proposalId: proposal.id,
      status: "APPROVED",
      message: "Proposal approved. Execution has been queued.",
      comment,
    });
  } catch (err: unknown) {
    logger.error("[ProposalsAPI] POST /approve failed", {
      id,
      error: (err as Error)?.message,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
