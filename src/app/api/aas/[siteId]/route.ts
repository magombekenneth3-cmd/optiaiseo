export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { calculateLatestAAS, getAASTrend } from "@/lib/aeo/ai-authority-score";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ siteId: string }> }
) {
    try {
        const { siteId } = await params;
        const user = await getAuthUser(req);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Verify user owns or has access to this site
        const site = await prisma.site.findFirst({
            where: {
                id: siteId,
                OR: [
                    { userId: user.id },
                    { viewerId: user.id }
                ]
            },
            select: { id: true },
        });

        if (!site) {
            return NextResponse.json({ error: "Site not found" }, { status: 404 });
        }

        const [latest, trend] = await Promise.all([
            calculateLatestAAS(siteId),
            getAASTrend(siteId, 30),
        ]);

        return NextResponse.json({ latest, trend });
    } catch (e: unknown) {
        return NextResponse.json(
            { error: "Failed to retrieve AI Authority Score", details: (e as Error)?.message },
            { status: 500 }
        );
    }
}
