export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { subDays } from "date-fns";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ siteId: string }> }
) {
    const { siteId } = await params;
    const user = await getAuthUser(req);
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user!.id },
        select: { id: true, niche: true, location: true },
    });

    if (!site) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const trending = await prisma.trendingTopic.findFirst({
        where: {
            industry: site.niche ?? "",
            fetchedAt: { gte: subDays(new Date(), 2) },
        },
        orderBy: { fetchedAt: "desc" },
    });

    return NextResponse.json({
        keywords: trending?.keywords ?? [],
        industry: site.niche,
        location: site.location,
        fetchedAt: trending?.fetchedAt ?? null,
    });
}
