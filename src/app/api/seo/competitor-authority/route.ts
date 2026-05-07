export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { getCompetitorAuthorityComparison } from "@/lib/seo/competitor-authority";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const siteId = req.nextUrl.searchParams.get("siteId");
  if (!siteId)
    return NextResponse.json({ error: "siteId required" }, { status: 400 });

  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: user.id },
    select: { id: true },
  });
  if (!site)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const comparison = await getCompetitorAuthorityComparison(siteId);
  return NextResponse.json(comparison ?? { error: "No data" });
}
