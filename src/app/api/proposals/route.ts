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
    if (status) where.status = status;

    const [proposals, total] = await Promise.all([
      (prisma as any).actionProposal.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          decision: {
            select: {
              id: true,
              url: true,
              primaryKeyword: true,
              action: true,
              opportunityStatus: true,
            },
          },
        },
      }),
      (prisma as any).actionProposal.count({ where }),
    ]);

    return NextResponse.json({
      proposals,
      total,
      limit,
      offset,
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
