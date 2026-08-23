import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id: decisionId } = await context.params;

        const decision = await prisma.growthDecision.findUnique({
            where: { id: decisionId },
            include: { site: { select: { id: true, userId: true } } },
        });

        if (!decision || decision.site.userId !== session.user.id) {
            return NextResponse.json({ error: "Recommendation not found or unauthorized" }, { status: 404 });
        }

        // Mark status as DISMISSED
        await prisma.growthDecision.update({
            where: { id: decisionId },
            data: { status: "DISMISSED" },
        });

        // Invalidate Redis cache
        const redis = getRedis();
        if (redis) {
            try { await redis.del(`growth_decisions_compressed:${decision.siteId}`); } catch { /* fail open */ }
        }

        logger.info("[RecommendationsAPI] Dismissed recommendation", {
            decisionId,
            siteId: decision.siteId,
        });

        return NextResponse.json({
            success: true,
            decisionId,
            status: "DISMISSED",
        });
    } catch (err: unknown) {
        logger.error("[RecommendationsAPI] Dismiss failed", { error: (err as Error)?.message || String(err) });
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
