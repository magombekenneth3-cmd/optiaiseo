import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

/**
 * GET /api/serp-gap/quota
 *
 * Returns the current user's SERP gap analysis quota for this calendar month.
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { subscriptionTier: true },
    });

    const tier = (user?.subscriptionTier ?? "FREE").toUpperCase();
    const limits: Record<string, number> = { FREE: 0, STARTER: 5, PRO: 30, AGENCY: 200 };
    const limit = limits[tier] ?? 0;

    // Read the current counter from Redis (same key pattern as checkSerpAnalysisLimit)
    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const redisKey = `serp-analysis:${session.user.id}:${monthKey}`;

    let used = 0;
    try {
        const hasRedis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
        if (hasRedis) {
            const count = await redis.get(redisKey);
            used = typeof count === "number" ? count : parseInt(String(count ?? "0"), 10) || 0;
        }
    } catch {
        // Redis error — fail open with used=0
    }

    const remaining = Math.max(limit - used, 0);

    // Reset date = 1st of next month UTC
    const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));

    return NextResponse.json({
        used,
        limit,
        remaining,
        tier,
        resetAt: resetAt.toISOString(),
    });
}
