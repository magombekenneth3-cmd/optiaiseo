import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const siteId = url.searchParams.get("siteId");
  const limitParam = Math.min(10, Math.max(1, parseInt(url.searchParams.get("limit") ?? "5", 10)));

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let resolvedSiteId = siteId;
  if (!resolvedSiteId) {
    const firstSite = await prisma.site.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    resolvedSiteId = firstSite?.id ?? null;
  }

  if (!resolvedSiteId) {
    return NextResponse.json({ findings: [], siteId: null });
  }

  const site = await prisma.site.findUnique({
    where: { id: resolvedSiteId },
    select: { id: true, domain: true, userId: true },
  });
  if (!site || site.userId !== user.id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const SEVERITY_WEIGHT: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  const findings = await prisma.diagnosticFindingRecord.findMany({
    where: {
      siteId: resolvedSiteId,
      status: { in: ["FAIL", "WARNING"] },
      lifecycleState: { not: "RESOLVED" },
    },
    orderBy: [
      { priorityScore: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    take: limitParam,
    select: {
      id: true,
      fingerprint: true,
      issueType: true,
      status: true,
      severity: true,
      rootCause: true,
      confidence: true,
      expectedOutcome: true,
      remediationType: true,
      priorityScore: true,
      lifecycleState: true,
      createdAt: true,
    },
  });

  findings.sort((a, b) => {
    const aScore = a.priorityScore ?? -1;
    const bScore = b.priorityScore ?? -1;
    if (bScore !== aScore) return bScore - aScore;
    const aSev = SEVERITY_WEIGHT[a.severity] ?? 4;
    const bSev = SEVERITY_WEIGHT[b.severity] ?? 4;
    if (aSev !== bSev) return aSev - bSev;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return NextResponse.json({
    findings,
    siteId: resolvedSiteId,
    domain: site.domain,
  });
}
