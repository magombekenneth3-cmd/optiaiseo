/**
 * src/app/api/sites/[siteId]/serp-gap/[analysisId]/route.ts
 *
 * GET /api/sites/:siteId/serp-gap/:analysisId
 * Returns the full GapReport + ImplementationPlan for a completed analysis.
 * Polls until status === "COMPLETED" | "FAILED"
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ siteId: string; analysisId: string }> }
) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { siteId, analysisId } = await params;

    const analysis = await prisma.serpGapAnalysis.findFirst({
        where: { id: analysisId, siteId, userId: session.user.id },
    });

    if (!analysis) {
        return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
    }

    return NextResponse.json(analysis);
}