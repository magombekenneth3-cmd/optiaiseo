export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSelfHealingStats } from "@/lib/self-healing/measure-impact";
import { getAuthUser } from "@/lib/auth/get-auth-user";
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
        select: { id: true },
    });

    if (!site) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const stats = await getSelfHealingStats(siteId);
    return NextResponse.json(stats);
}
