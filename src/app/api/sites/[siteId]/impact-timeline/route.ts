export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { getImpactTimeline } from "@/lib/impact";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ siteId: string }> }
) {
    try {
        const { siteId } = await params;
        const user = await getAuthUser(req);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const site = await prisma.site.findFirst({
            where: { id: siteId, userId: user.id },
            select: { id: true },
        });
        if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const timeline = await getImpactTimeline(siteId);
        return NextResponse.json(timeline);
    } catch (error: unknown) {
        return NextResponse.json(
            { error: (error as Error)?.message || "Internal server error" },
            { status: 500 }
        );
    }
}
