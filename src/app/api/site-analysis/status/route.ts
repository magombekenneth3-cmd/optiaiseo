// =============================================================================
// GET /api/site-analysis/status?siteId=xxx — Check analysis status
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAnalysisLocked } from "@/lib/agents/analysis-lock";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const siteId = req.nextUrl.searchParams.get("siteId");
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

  // Check if currently running
  const running = await isAnalysisLocked(siteId);

  // Get latest orchestrator run
  const latestRun = await prisma.agentRun.findFirst({
    where: { siteId, agentType: "ORCHESTRATOR" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      findingCount: true,
      createdAt: true,
    },
  });

  // Get child run statuses for the latest orchestrator
  let childRuns: { agentType: string; status: string; findingCount: number }[] = [];
  if (latestRun) {
    childRuns = await prisma.agentRun.findMany({
      where: { parentRunId: latestRun.id },
      select: { agentType: true, status: true, findingCount: true },
      orderBy: { createdAt: "asc" },
    });
  }

  return NextResponse.json({
    running,
    latestRun: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          startedAt: latestRun.startedAt,
          completedAt: latestRun.completedAt,
          findingCount: latestRun.findingCount,
          createdAt: latestRun.createdAt,
        }
      : null,
    childRuns,
  });
}
