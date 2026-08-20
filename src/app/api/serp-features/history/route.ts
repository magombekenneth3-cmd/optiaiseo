// GET /api/serp-features/history?siteId=...&days=90
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { getSerpFeatureHistory } from "@/app/actions/serp-features";

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const siteId = req.nextUrl.searchParams.get("siteId");
    if (!siteId)
        return NextResponse.json({ error: "siteId required" }, { status: 400 });

    // Verify site ownership
    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user.id },
        select: { id: true },
    });
    if (!site)
        return NextResponse.json({ error: "Site not found" }, { status: 404 });

    const daysParam = req.nextUrl.searchParams.get("days");
    const days = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 90, 7), 365) : 90;

    const history = await getSerpFeatureHistory(siteId, days);

    return NextResponse.json({ history }, {
        headers: {
            // Cache for 5 minutes — weekly cron so fresh-enough
            "Cache-Control": "private, s-maxage=300, stale-while-revalidate=60",
        },
    });
}
