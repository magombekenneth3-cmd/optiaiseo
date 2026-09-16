import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/autonomy/mutations?siteId=...&limit=25
 *
 * A compact forensic timeline. ExecutionTrace is the correlation spine; the
 * linked operation is deliberately summarized instead of exposing payloads.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const siteId = request.nextUrl.searchParams.get("siteId");
  if (!siteId) {
    return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  }
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "25");
  const limit = Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 25;

  const site = await prisma.site.findFirst({
    where: { id: siteId, OR: [{ userId: session.user.id }, { viewerId: session.user.id }] },
    select: { id: true },
  });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 403 });
  }

  const traces = await (prisma as any).executionTrace.findMany({
    where: { siteId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, opportunityId: true, proposalId: true, operationId: true,
      actionType: true, safetyTier: true, policyDecision: true, policyReason: true,
      executionResult: true, failureClass: true, retryCount: true,
      verificationStatus: true, createdAt: true, authorizedAt: true,
      executedAt: true, completedAt: true,
    },
  });
  const operationIds = traces.map((trace: { operationId: string | null }) => trace.operationId).filter(Boolean);
  const operations = operationIds.length === 0 ? [] : await (prisma as any).mutationOperation.findMany({
    where: { siteId, id: { in: operationIds } },
    select: { id: true, status: true, mutationType: true, riskLevel: true, riskScore: true, completedAt: true },
  });
  const byId = new Map(operations.map((operation: { id: string }) => [operation.id, operation]));

  return NextResponse.json({
    traces: traces.map((trace: { operationId: string | null; [key: string]: unknown }) => ({
      ...trace,
      operation: trace.operationId ? byId.get(trace.operationId) ?? null : null,
    })),
  });
}
