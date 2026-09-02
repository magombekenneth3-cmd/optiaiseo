/**
 * POST /api/proposals/[id]/rollback
 *
 * Rolls back a VERIFIED, EXECUTED, FAILED, or ROLLBACK_PARTIAL proposal.
 *
 * Contract (Amendment #3):
 *   1. Proposal must be in a rollback-eligible status (EXECUTING excluded)
 *   2. operationId must be present
 *   3. compensateOperation() is called — its result determines final status
 *   4. finalStatus = "ROLLED_BACK" only when compensateOperation().finalStatus = "ROLLED_BACK"
 *      otherwise proposal becomes ROLLBACK_PARTIAL (re-tryable)
 *   5. Opportunity transitions via transitionOpportunity() — state machine enforced
 *
 * Body: { reason: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { ROLLBACK_ELIGIBLE_PROPOSAL_STATUSES } from "@/lib/proposals/types";
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

    const body = await req.json().catch(() => ({}));
    const reason = (body?.reason as string) ?? "Rolled back by user";

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

    // Must be in a rollback-eligible status (EXECUTING explicitly excluded)
    if (!ROLLBACK_ELIGIBLE_PROPOSAL_STATUSES.includes(proposal.status)) {
      const message =
        proposal.status === "EXECUTING"
          ? "Cannot rollback while EXECUTING — mutation is in flight. Wait for completion, then retry."
          : `Cannot rollback proposal in ${proposal.status} status. Rollback is available from: ${ROLLBACK_ELIGIBLE_PROPOSAL_STATUSES.join(", ")}`;
      return NextResponse.json({ error: message }, { status: 409 });
    }

    // Must have an operationId — can't rollback what was never executed
    if (!proposal.operationId) {
      return NextResponse.json(
        { error: "Cannot rollback: no associated MutationOperation found" },
        { status: 422 }
      );
    }

    const now = new Date();
    const actorId = `user:${userId}`;

    // Attempt to compensate the mutation operation.
    // The result determines the final status — we do NOT assume full success.
    let compensationResult: { finalStatus: string };
    try {
      const { compensateOperation } = await import("@/lib/mutations");
      compensationResult = await compensateOperation({
        operationId: proposal.operationId,
        actorId,
        reason,
      });
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? "Unknown compensation error";
      logger.error("[ProposalsAPI] compensateOperation failed", {
        proposalId: proposal.id,
        operationId: proposal.operationId,
        error: msg,
      });
      return NextResponse.json(
        { error: `Rollback failed: ${msg}` },
        { status: 500 }
      );
    }

    // Determine final proposal status based on actual compensation result.
    // ROLLED_BACK only when compensateOperation confirms full success.
    // ROLLBACK_PARTIAL allows the operator to retry compensation.
    const fullyCompensated = compensationResult.finalStatus === "ROLLED_BACK";
    const finalProposalStatus = fullyCompensated ? "ROLLED_BACK" : "ROLLBACK_PARTIAL";

    // Transition proposal status
    await (prisma as any).actionProposal.update({
      where: { id: params.id },
      data: {
        status: finalProposalStatus,
        rolledBackBy: actorId,
        rolledBackAt: now,
        rollbackReason: reason.slice(0, 2000),
        // completedAt only when terminal (ROLLED_BACK); ROLLBACK_PARTIAL is re-tryable
        ...(fullyCompensated ? { completedAt: now } : {}),
      },
    });

    // Transition opportunity through the state machine — only when fully compensated.
    // ROLLBACK_PARTIAL leaves the opportunity in its current state (VERIFIED/FAILED);
    // the operator will re-try compensation and trigger the final transition then.
    if (fullyCompensated) {
      // Try each eligible source in order — only one will match current status
      for (const fromStatus of ["VERIFIED", "FAILED", "EXECUTED"] as const) {
        const applied = await transitionOpportunity({
          decisionId: proposal.decisionId,
          from: fromStatus as any,
          to: "ROLLED_BACK",
          actorId,
          reason,
          proposalId: proposal.id,
          operationId: proposal.operationId,
        });
        if (applied) break;
      }
    }

    logger.info("[ProposalsAPI] Proposal rollback complete", {
      proposalId: proposal.id,
      operationId: proposal.operationId,
      rolledBackBy: userId,
      reason,
      finalProposalStatus,
      fullyCompensated,
    });

    return NextResponse.json({
      success: true,
      proposalId: proposal.id,
      operationId: proposal.operationId,
      status: finalProposalStatus,
      fullyCompensated,
      rolledBackAt: now.toISOString(),
      reason,
    });
  } catch (err: unknown) {
    logger.error("[ProposalsAPI] POST /rollback failed", {
      id: params.id,
      error: (err as Error)?.message,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
