import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: findingId } = await params;
  if (!findingId || findingId.length > 50) {
    return NextResponse.json({ error: "Invalid finding ID" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const finding = await prisma.diagnosticFindingRecord.findUnique({
    where: { id: findingId },
    select: {
      id: true,
      siteId: true,
      fingerprint: true,
      issueType: true,
      status: true,
      severity: true,
      scopeType: true,
      scopeUrls: true,
      rootCause: true,
      confidence: true,
      expectedOutcome: true,
      remediationType: true,
      verificationCriteria: true,
      lifecycleState: true,
      resolvedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!finding) {
    return NextResponse.json({ error: "Finding not found" }, { status: 404 });
  }

  const site = await prisma.site.findUnique({
    where: { id: finding.siteId },
    select: { userId: true, domain: true },
  });
  if (!site || site.userId !== user.id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const [evidence, healingLogs, proposals] = await Promise.all([
    prisma.sEOEvidenceRecord.findMany({
      where: { findingId: finding.id },
      orderBy: { observedAt: "asc" },
      select: {
        id: true,
        source: true,
        url: true,
        observedAt: true,
        observedValue: true,
        confidence: true,
      },
    }),
    prisma.selfHealingLog.findMany({
      where: { diagnosticFindingId: finding.id },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: {
        id: true,
        issueType: true,
        description: true,
        actionTaken: true,
        status: true,
        impactScore: true,
        createdAt: true,
      },
    }),
    prisma.seoFixProposal.findMany({
      where: { diagnosticFindingId: finding.id },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: {
        id: true,
        issueLabel: true,
        status: true,
        prUrl: true,
        prNumber: true,
        deploymentUrl: true,
        deploymentStatus: true,
        deployedAt: true,
        verificationStatus: true,
        createdAt: true,
      },
    }),
  ]);

  type ObservedValue = Record<string, unknown> | null;

  const diagnosticEvidence = evidence.filter((e) => {
    const obs = e.observedValue as ObservedValue;
    return !obs?.verificationType;
  });

  const verificationEvidence = evidence.filter((e) => {
    const obs = e.observedValue as ObservedValue;
    return !!obs?.verificationType;
  });

  const t0Evidence = verificationEvidence.filter((e) => {
    const obs = e.observedValue as ObservedValue;
    return (obs?.verificationType as string)?.startsWith("T0");
  });

  const t7Evidence = verificationEvidence.filter((e) => {
    const obs = e.observedValue as ObservedValue;
    return (obs?.verificationType as string)?.startsWith("T7");
  });

  const t28Evidence = verificationEvidence.filter((e) => {
    const obs = e.observedValue as ObservedValue;
    return (obs?.verificationType as string)?.startsWith("T28");
  });

  const deployments = proposals
    .filter((p) => p.deployedAt)
    .map((p) => ({
      proposalId: p.id,
      issueLabel: p.issueLabel,
      prUrl: p.prUrl,
      prNumber: p.prNumber,
      deploymentUrl: p.deploymentUrl,
      deploymentStatus: p.deploymentStatus,
      deployedAt: p.deployedAt,
      verificationStatus: p.verificationStatus,
    }));

  const hasDeployment = deployments.length > 0;
  const hasT0 = t0Evidence.length > 0;
  const hasT7 = t7Evidence.length > 0;
  const hasT28 = t28Evidence.length > 0;

  function gateStatus(hasData: boolean, evidence: typeof t0Evidence): string {
    if (!hasData) return hasDeployment ? "pending" : "unavailable";
    const obs = evidence[evidence.length - 1]?.observedValue as ObservedValue;
    const outcome = obs?.outcome as string | undefined;
    if (outcome === "improved" || outcome === "passed") return "passed";
    if (outcome === "degraded" || outcome === "failed") return "failed";
    if (outcome === "neutral" || outcome === "inconclusive") return "insufficient_data";
    return "pending";
  }

  const timeline = {
    finding: {
      id: finding.id,
      issueType: finding.issueType,
      status: finding.status,
      severity: finding.severity,
      lifecycleState: finding.lifecycleState,
      rootCause: finding.rootCause,
      expectedOutcome: finding.expectedOutcome,
      createdAt: finding.createdAt,
      resolvedAt: finding.resolvedAt,
    },
    stages: {
      discovery: {
        status: "completed" as const,
        timestamp: finding.createdAt,
      },
      evidence: {
        status: diagnosticEvidence.length > 0 ? "completed" as const : "pending" as const,
        count: diagnosticEvidence.length,
        items: diagnosticEvidence,
      },
      remediation: {
        status: (healingLogs.length > 0 || proposals.length > 0)
          ? "completed" as const
          : "unavailable" as const,
        healingLogs,
        proposals: proposals.map((p) => ({
          id: p.id,
          issueLabel: p.issueLabel,
          status: p.status,
          prUrl: p.prUrl,
          prNumber: p.prNumber,
          createdAt: p.createdAt,
        })),
      },
      deployment: {
        status: hasDeployment ? "completed" as const : "unavailable" as const,
        deployments,
      },
      t0Verification: {
        status: gateStatus(hasT0, t0Evidence),
        evidence: t0Evidence,
      },
      t7Verification: {
        status: gateStatus(hasT7, t7Evidence),
        evidence: t7Evidence,
      },
      t28Outcome: {
        status: gateStatus(hasT28, t28Evidence),
        evidence: t28Evidence,
      },
      resolution: {
        status: finding.lifecycleState === "RESOLVED"
          ? "completed" as const
          : finding.resolvedAt
            ? "completed" as const
            : "pending" as const,
        resolvedAt: finding.resolvedAt,
        lifecycleState: finding.lifecycleState,
      },
    },
    domain: site.domain,
  };

  return NextResponse.json(timeline);
}
