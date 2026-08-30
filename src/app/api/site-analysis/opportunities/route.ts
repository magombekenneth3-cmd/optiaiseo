// =============================================================================
// GET /api/site-analysis/opportunities?siteId=xxx — List opportunities
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const siteId = params.get("siteId");
  if (!siteId) {
    return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  }

  // Verify ownership
  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    select: { id: true },
  });

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // Parse optional filters
  const category = params.get("category");
  const status = params.get("status") ?? "ACTIVE";
  const action = params.get("action");
  const limit = Math.min(parseInt(params.get("limit") ?? "50", 10), 200);
  const offset = parseInt(params.get("offset") ?? "0", 10);

  // Build query where clause
  const where: Record<string, unknown> = {
    siteId,
    status,
  };

  if (category) where.primaryCategory = category;
  if (action) where.action = action;

  const [opportunities, total] = await Promise.all([
    prisma.growthDecision.findMany({
      where,
      include: {
        sourceFindings: {
          include: {
            finding: {
              include: {
                evidence: true,
              },
            },
          },
        },
      },
      orderBy: { generatedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.growthDecision.count({ where }),
  ]);

  return NextResponse.json({
    opportunities,
    total,
    limit,
    offset,
  });
}
