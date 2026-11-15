import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyFindingLiveAndPersist } from "@/lib/seo-audit/live-verify";

export const dynamic = "force-dynamic";

export async function POST(
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
    select: { id: true, gscConnected: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const rateLimitResult = await checkRateLimit(`live-verify:${user.id}:${findingId}`, 6, 60);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: "Too many verification requests. Please wait a minute before retrying." },
      { status: 429 },
    );
  }

  const finding = await prisma.diagnosticFindingRecord.findUnique({
    where: { id: findingId },
    select: {
      id: true,
      siteId: true,
      fingerprint: true,
      issueType: true,
      status: true,
      scopeUrls: true,
      rootCause: true,
      verificationCriteria: true,
      lifecycleState: true,
    },
  });

  if (!finding) {
    return NextResponse.json({ error: "Finding not found" }, { status: 404 });
  }

  const site = await prisma.site.findUnique({
    where: { id: finding.siteId },
    select: { id: true, userId: true, domain: true },
  });

  if (!site || site.userId !== user.id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  let body: { url?: string; includeGscInspection?: boolean } = {};
  try {
    const raw = await req.json();
    if (raw && typeof raw === "object") {
      body = raw as { url?: string; includeGscInspection?: boolean };
    }
  } catch {
    // Empty or non-JSON request body is allowed; finding.scopeUrls will be used
  }

  try {
    const result = await verifyFindingLiveAndPersist({
      finding,
      site,
      explicitUrl: typeof body.url === "string" ? body.url : undefined,
      includeGscInspection:
        typeof body.includeGscInspection === "boolean"
          ? body.includeGscInspection
          : user.gscConnected !== false,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Live verification failed";
    const status = /must belong to the site/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

