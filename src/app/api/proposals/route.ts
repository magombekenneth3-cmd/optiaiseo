import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("siteId");
    const status = searchParams.get("status");
    const sort = searchParams.get("sort") ?? "createdAt";
    const order = searchParams.get("order") ?? "desc";
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100);
    const offset = parseInt(searchParams.get("offset") ?? "0");

    if (!siteId) {
      return NextResponse.json({ error: "siteId is required" }, { status: 400 });
    }

    // Verify site ownership
    const site = await prisma.site.findFirst({
      where: { id: siteId, userId },
      select: { id: true },
    });
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const where: any = { siteId };
    if (status && status !== "ALL") where.status = status;

    // Sort options
    const SORT_MAP: Record<string, any> = {
      createdAt: { createdAt: order },
      confidence: { confidence: order },
      safetyTier: { safetyTier: order },
    };
    const orderBy = SORT_MAP[sort] ?? { createdAt: "desc" };

    const [proposals, total, statusCounts] = await Promise.all([
      (prisma as any).actionProposal.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
        select: {
          id: true,
          actionType: true,
          status: true,
          targetUrl: true,
          targetModel: true,
          safetyTier: true,
          riskLevel: true,
          confidence: true,
          generatedBy: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
          proposedChanges: true,
          expectedOutcome: true,
          decision: {
            select: {
              id: true,
              url: true,
              primaryKeyword: true,
              action: true,
              opportunityStatus: true,
              score: true,
            },
          },
        },
      }),
      (prisma as any).actionProposal.count({ where }),
      // Status count aggregation
      (prisma as any).actionProposal.groupBy({
        by: ["status"],
        where: { siteId },
        _count: { status: true },
      }),
    ]);

    // Build status count map
    const statusCountMap: Record<string, number> = {};
    for (const group of statusCounts) {
      statusCountMap[group.status] = group._count.status;
    }

    // Enrich proposals with LLM enhancement info
    const enrichedProposals = proposals.map((p: any) => {
      const llmMeta = p.metadata?.llm ?? null;
      return {
        ...p,
        llmOutcome: llmMeta?.outcome ?? "SKIPPED",
        llmConfidence: llmMeta?.confidence ?? null,
        isAiEnhanced: llmMeta?.outcome === "ENHANCED",
        // Strip raw metadata from response — expose only safe fields
        metadata: undefined,
      };
    });

    return NextResponse.json({
      proposals: enrichedProposals,
      total,
      limit,
      offset,
      statusCounts: statusCountMap,
    });
  } catch (err: unknown) {
    logger.error("[ProposalsAPI] GET /api/proposals failed", {
      error: (err as Error)?.message,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
