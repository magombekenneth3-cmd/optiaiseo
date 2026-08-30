

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function GET(
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
      include: {
        decision: {
          select: {
            id: true,
            url: true,
            primaryKeyword: true,
            action: true,
            opportunityStatus: true,
            score: true,
            whyNow: true,
          },
        },
        operation: {
          select: {
            id: true,
            status: true,
            mutationType: true,
            riskLevel: true,
            riskScore: true,
            createdAt: true,
            completedAt: true,
          },
        },
      },
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

    return NextResponse.json({ proposal });
  } catch (err: unknown) {
    logger.error("[ProposalsAPI] GET /api/proposals/[id] failed", {
      id: params.id,
      error: (err as Error)?.message,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
