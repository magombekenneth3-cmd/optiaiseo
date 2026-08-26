import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { executeGrowthDecision } from "@/lib/growth/execution-engine";
import { logger } from "@/lib/logger";
import { hashCanonicalMutation } from "@/lib/mutations";

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

        const approvalHash = hashCanonicalMutation(
            "Blog",
            decision.url,
            1,
            decision.action,
            { action: decision.action, url: decision.url },
        );

        const ttlHours = 24;
        const approvalExpiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
        await prisma.growthDecision.update({
            where: { id: decisionId },
            data: {
                status: "APPROVED",
                approvedBy: session.user.id,
                approvedAt: new Date(),
                approvalExpiresAt,
                mutationHash: approvalHash,
            },
        });

        // Invalidate Redis cache
        const redis = getRedis();
        if (redis) {
            try { await redis.del(`growth_decisions_compressed:${decision.siteId}`); } catch { /* fail open */ }
        }

        // ── 3. Execute via mutation lifecycle ────────────────────────────────
        const execResult = await executeGrowthDecision(decisionId, decision.siteId);

        logger.info("[RecommendationsAPI] Approved and executed recommendation", {
            decisionId,
            siteId: decision.siteId,
            success: execResult.success,
            operationId: execResult.operationId,
        });

        return NextResponse.json({
            success: execResult.success,
            decisionId,
            actionExecuted: execResult.actionExecuted,
            details: execResult.details,
            executedAt: execResult.executedAt,
            operationId: execResult.operationId,
        });
    } catch (err: unknown) {
        logger.error("[RecommendationsAPI] Approve failed", { error: (err as Error)?.message || String(err) });
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
