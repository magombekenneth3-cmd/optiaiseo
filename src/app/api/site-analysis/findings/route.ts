// =============================================================================
// GET /api/site-analysis/findings?siteId=xxx — List findings with filters
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
  const severity = params.get("severity"); // INFO | LOW | MEDIUM | HIGH | CRITICAL
  const status = params.get("status"); // OPEN | RESOLVED | REOPENED | ...
  const type = params.get("type"); // QUICK_WIN | BROKEN_LINK | ...
  const agentType = params.get("agentType"); // CRAWL | GSC_INTELLIGENCE | ...
  const limit = Math.min(parseInt(params.get("limit") ?? "50", 10), 200);
  const offset = parseInt(params.get("offset") ?? "0", 10);

  // Build where clause
  const where: Record<string, unknown> = {
    agentRun: { siteId },
  };

  if (severity) where.severity = severity;
  if (status) {
    where.status = status;
  } else {
    // Default: show active findings only
    where.status = { in: ["OPEN", "REOPENED", "ACKNOWLEDGED", "IN_PROGRESS"] };
  }
  if (type) where.type = type;
  if (agentType) {
    where.agentRun = { ...where.agentRun as Record<string, unknown>, agentType };
  }

  const [findings, total] = await Promise.all([
    prisma.agentFinding.findMany({
      where,
      include: {
        evidence: true,
        agentRun: { select: { agentType: true, createdAt: true } },
      },
      orderBy: [
        { severity: "desc" },
        { confidence: "desc" },
        { createdAt: "desc" },
      ],
      take: limit,
      skip: offset,
    }),
    prisma.agentFinding.count({ where }),
  ]);

  // Summary stats
  const stats = await prisma.agentFinding.groupBy({
    by: ["severity"],
    where: { agentRun: { siteId }, status: { in: ["OPEN", "REOPENED"] } },
    _count: true,
  });

  return NextResponse.json({
    findings,
    total,
    limit,
    offset,
    stats: stats.reduce(
      (acc: Record<string, number>, s: { severity: string; _count: number }) => {
        acc[s.severity] = s._count;
        return acc;
      },
      {} as Record<string, number>,
    ),
  });
}
