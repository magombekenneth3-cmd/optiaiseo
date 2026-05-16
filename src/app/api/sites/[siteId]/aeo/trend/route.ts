export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";

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

        const reports = await prisma.aeoReport.findMany({
            where: { siteId, status: "COMPLETED" },
            orderBy: { createdAt: "asc" },
            take: 24,
            select: {
                score: true,
                citationScore: true,
                grade: true,
                createdAt: true,
            },
        });

        const trend = reports.map(r => ({
            date: r.createdAt.toISOString(),
            score: r.score,
            citationScore: r.citationScore,
            grade: r.grade,
        }));

        return NextResponse.json({ trend });
    } catch {
        return NextResponse.json({ error: "Failed to load trend" }, { status: 500 });
    }
}
