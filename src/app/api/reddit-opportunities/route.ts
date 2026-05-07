// GET /api/reddit-opportunities?siteId=...
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { getRedditOpportunitiesForSite } from "@/lib/reddit/reddit-opportunities";

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const siteId = req.nextUrl.searchParams.get("siteId");
    if (!siteId)
        return NextResponse.json({ error: "siteId required" }, { status: 400 });

    // Verify ownership
    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user.id },
        select: { id: true },
    });
    if (!site)
        return NextResponse.json({ error: "Site not found" }, { status: 404 });

    const opportunities = await getRedditOpportunitiesForSite(siteId);
    return NextResponse.json({ opportunities }, {
        headers: { "Cache-Control": "private, s-maxage=1800, stale-while-revalidate=300" },
    });
}
