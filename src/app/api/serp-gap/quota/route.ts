import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CREDIT_COSTS } from "@/lib/credits";

/**
 * GET /api/serp-gap/quota
 *
 * Returns the current user's SERP gap analysis quota (credit-gated, with 1 lifetime trial on FREE).
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
    const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));

    const [user, usedThisMonth, totalUsed] = await Promise.all([
        prisma.user.findUnique({
            where: { id: session.user.id },
            select: { subscriptionTier: true, credits: true },
        }),
        prisma.serpGapAnalysis.count({
            where: {
                userId: session.user.id,
                createdAt: { gte: monthStart },
                status: { not: "FAILED" },
            },
        }),
        prisma.serpGapAnalysis.count({
            where: {
                userId: session.user.id,
                status: { not: "FAILED" },
            },
        }),
    ]);

    const tier = (user?.subscriptionTier ?? "FREE").toUpperCase();
    const credits = user?.credits ?? 0;
    const costPerAnalysis = CREDIT_COSTS.serp_gap_analysis;
    const creditAffordable = Math.floor(credits / costPerAnalysis);

    // FREE plan gets at most 1 analysis total; paid plans are gated solely by credits
    const remaining = tier === "FREE"
        ? Math.min(Math.max(1 - totalUsed, 0), creditAffordable)
        : creditAffordable;
    const limit = tier === "FREE" ? 1 : usedThisMonth + remaining;

    return NextResponse.json({
        used: tier === "FREE" ? totalUsed : usedThisMonth,
        limit,
        remaining,
        credits,
        costPerAnalysis,
        tier,
        resetAt: resetAt.toISOString(),
    });
}
