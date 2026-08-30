/**
 * POST /api/proposals/[id]/reject
 *
 * Rejects a READY or APPROVED proposal. Transitions opportunity back to REJECTED.
 * Body: { reason?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

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
    const reason = (body?.reason as string) ?? "Rejected by user";

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

    if (!["READY", "APPROVED"].includes(proposal.status)) {
      return NextResponse.json(
        { error: `Cannot reject proposal in ${proposal.status} status` },
        { status: 409 }
      );
    }

    const now = new Date();

    await (prisma as any).actionProposal.update({
      where: { id: params.id },
      data: { status: "REJECTED", completedAt: now, lastAttemptError: reason },
    });

    // Transition opportunity → REJECTED
    await prisma.growthDecision.updateMany({
      where: {
        id: proposal.decisionId,
        ...(({ opportunityStatus: { in: ["PROPOSED", "APPROVED"] } }) as any),
      },
      data: {
        ...(({ opportunityStatus: "REJECTED" }) as any),
        updatedAt: now,
      },
    });

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
      id: params.id,
      error: (err as Error)?.message,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
