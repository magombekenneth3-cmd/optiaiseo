import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { executeGrowthDecision } from "@/lib/growth/execution-engine";
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

        // 1. Mark status as APPROVED
        await prisma.growthDecision.update({
            where: { id: decisionId },
            data: { status: "APPROVED" },
        });

        // Invalidate Redis cache
        const redis = getRedis();
        if (redis) {
            try { await redis.del(`growth_decisions_compressed:${decision.siteId}`); } catch { /* fail open */ }
        }

        // 2. Execute via Execution Engine (applies fixes, sets EXECUTED, enqueues indexing, records T0 baseline)
        const execResult = await executeGrowthDecision(decisionId, decision.siteId);

        logger.info("[RecommendationsAPI] Approved and executed recommendation", {
            decisionId,
            siteId: decision.siteId,
            success: execResult.success,
        });

        return NextResponse.json({
            success: execResult.success,
            decisionId,
            actionExecuted: execResult.actionExecuted,
            details: execResult.details,
            executedAt: execResult.executedAt,
        });
    } catch (err: unknown) {
        logger.error("[RecommendationsAPI] Approve failed", { error: (err as Error)?.message || String(err) });
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
