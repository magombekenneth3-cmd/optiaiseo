// =============================================================================
// POST /api/site-analysis/start — Trigger a full site analysis
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { isAnalysisLocked } from "@/lib/agents/analysis-lock";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { siteId } = body as { siteId?: string };

  if (!siteId) {
    return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  }

  // Verify the user owns this site
  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    select: { id: true, domain: true },
  });

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // Check if an analysis is already running in Redis or DB
  const [locked, activeRun] = await Promise.all([
    isAnalysisLocked(siteId),
    prisma.agentRun.findFirst({
      where: { siteId, agentType: "ORCHESTRATOR", status: { in: ["QUEUED", "RUNNING"] } },
      select: { id: true },
    }),
  ]);

  if (locked || activeRun) {
    return NextResponse.json(
      { error: "Analysis already in progress", status: "RUNNING" },
      { status: 409 },
    );
  }

  // Fire the Inngest event
  await inngest.send({
    name: "site-analysis/requested",
    data: { siteId },
  });

  logger.info("[API] Site analysis requested", { siteId, userId: session.user.id });

  return NextResponse.json({ status: "QUEUED", siteId });
}
