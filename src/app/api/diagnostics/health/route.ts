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
    return NextResponse.json({
      severity: { critical: 0, high: 0, medium: 0, low: 0 },
      lifecycle: { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, REGRESSED: 0, UNKNOWN: 0 },
      resolution: { last7d: 0, last30d: 0, last90d: 0, total: 0 },
      verification: { t0: { passed: 0, failed: 0, pending: 0, insufficient: 0, total: 0 }, t7: { passed: 0, failed: 0, pending: 0, insufficient: 0, total: 0 }, t28: { passed: 0, failed: 0, pending: 0, insufficient: 0, total: 0 } },
      totalFindings: 0,
      siteId: null,
      domain: null,
    });
  }

  const site = await prisma.site.findUnique({
    where: { id: resolvedSiteId },
    select: { id: true, domain: true, userId: true },
  });
  if (!site || site.userId !== user.id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 86_400_000);
  const d30 = new Date(now.getTime() - 30 * 86_400_000);
  const d90 = new Date(now.getTime() - 90 * 86_400_000);

  const [findings, resolutions7, resolutions30, resolutions90, resolutionsAll, verificationEvidence] = await Promise.all([
    prisma.diagnosticFindingRecord.findMany({
      where: { siteId: resolvedSiteId },
      select: {
        id: true,
        status: true,
        severity: true,
        lifecycleState: true,
        resolvedAt: true,
      },
    }),
    prisma.diagnosticFindingRecord.count({
      where: { siteId: resolvedSiteId, resolvedAt: { gte: d7 } },
    }),
    prisma.diagnosticFindingRecord.count({
      where: { siteId: resolvedSiteId, resolvedAt: { gte: d30 } },
    }),
    prisma.diagnosticFindingRecord.count({
      where: { siteId: resolvedSiteId, resolvedAt: { gte: d90 } },
    }),
    prisma.diagnosticFindingRecord.count({
      where: { siteId: resolvedSiteId, resolvedAt: { not: null } },
    }),
    prisma.sEOEvidenceRecord.findMany({
      where: {
        siteId: resolvedSiteId,
        findingId: { not: null },
      },
      select: {
        findingId: true,
        observedValue: true,
      },
    }),
  ]);

  const severity = { critical: 0, high: 0, medium: 0, low: 0 };
  const lifecycle: Record<string, number> = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, REGRESSED: 0, UNKNOWN: 0 };

  const activeFindings = findings.filter(f => f.status === "FAIL" || f.status === "WARNING");
  for (const f of activeFindings) {
    const sev = f.severity as keyof typeof severity;
    if (sev in severity) severity[sev]++;
  }

  for (const f of findings) {
    const state = f.lifecycleState;
    if (state in lifecycle) lifecycle[state]++;
    else lifecycle[state] = 1;
  }

  type ObservedValue = Record<string, unknown> | null;

  const t0 = { passed: 0, failed: 0, pending: 0, insufficient: 0, total: 0 };
  const t7 = { passed: 0, failed: 0, pending: 0, insufficient: 0, total: 0 };
  const t28 = { passed: 0, failed: 0, pending: 0, insufficient: 0, total: 0 };

  const findingVerificationMap = new Map<string, { t0: string | null; t7: string | null; t28: string | null }>();

  for (const ev of verificationEvidence) {
    if (!ev.findingId) continue;
    const obs = ev.observedValue as ObservedValue;
    const vType = obs?.verificationType as string | undefined;
    if (!vType) continue;

    if (!findingVerificationMap.has(ev.findingId)) {
      findingVerificationMap.set(ev.findingId, { t0: null, t7: null, t28: null });
    }
    const entry = findingVerificationMap.get(ev.findingId)!;
    const outcome = (obs?.outcome as string) ?? null;

    if (vType.startsWith("T0")) entry.t0 = outcome;
    else if (vType.startsWith("T7")) entry.t7 = outcome;
    else if (vType.startsWith("T28")) entry.t28 = outcome;
  }

  function categorizeOutcome(outcome: string | null): "passed" | "failed" | "insufficient" | "pending" {
    if (!outcome) return "pending";
    if (outcome === "improved" || outcome === "passed") return "passed";
    if (outcome === "degraded" || outcome === "failed") return "failed";
    if (outcome === "neutral" || outcome === "inconclusive") return "insufficient";
    return "pending";
  }

  for (const entry of findingVerificationMap.values()) {
    if (entry.t0 !== undefined) {
      t0.total++;
      t0[categorizeOutcome(entry.t0)]++;
    }
    if (entry.t7 !== undefined) {
      t7.total++;
      t7[categorizeOutcome(entry.t7)]++;
    }
    if (entry.t28 !== undefined) {
      t28.total++;
      t28[categorizeOutcome(entry.t28)]++;
    }
  }

  return NextResponse.json({
    severity,
    lifecycle,
    resolution: {
      last7d: resolutions7,
      last30d: resolutions30,
      last90d: resolutions90,
      total: resolutionsAll,
    },
    verification: { t0, t7, t28 },
    totalFindings: findings.length,
    siteId: resolvedSiteId,
    domain: site.domain,
  });
}
