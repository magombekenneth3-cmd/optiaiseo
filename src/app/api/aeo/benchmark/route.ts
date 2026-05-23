import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const avgScore = await prisma.aeoReport.aggregate({
        _avg: { score: true }
    });

    const average = Math.round(avgScore._avg.score ?? 38);

    return NextResponse.json({
        success: true,
        average: average,
        topTenPercent: Math.max(71, Math.round(average * 1.8))
    });
}
