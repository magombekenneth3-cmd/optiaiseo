import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAutonomyPipelineHealth } from "@/lib/autonomy/pipeline-health";

/** GET /api/autonomy/health?siteId=...&windowHours=24 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const siteId = request.nextUrl.searchParams.get("siteId");
  if (!siteId) {
    return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  }

  const requestedWindow = Number(request.nextUrl.searchParams.get("windowHours") ?? "24");
  if (!Number.isInteger(requestedWindow) || requestedWindow < 1 || requestedWindow > 168) {
    return NextResponse.json({ error: "windowHours must be an integer between 1 and 168" }, { status: 400 });
  }

  const site = await prisma.site.findFirst({
    where: { id: siteId, OR: [{ userId: session.user.id }, { viewerId: session.user.id }] },
    select: { id: true },
  });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 403 });
  }

  return NextResponse.json(await getAutonomyPipelineHealth(siteId, requestedWindow));
}
