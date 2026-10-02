"use server";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PLANS, Tier } from "@/lib/stripe/plans";

export interface UserUsage {
    tier: Tier;
    // Sites still have a per-tier cap — kept as-is.
    sites: { used: number; limit: number };
    // Blogs and audits are now credit-gated only, not count-limited.
    // We still surface the monthly count for informational display.
    blogs: { used: number; limit: number };
    audits: { used: number; limit: number };
    // Credits summary
    credits: { remaining: number };
}

export async function getUserUsage(): Promise<UserUsage | null> {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return null;

        const userId = session.user.id;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { subscriptionTier: true, credits: true },
        });

        if (!user) return null;

        const tierStr: Tier = user.subscriptionTier && PLANS[user.subscriptionTier as Tier]
            ? (user.subscriptionTier as Tier)
            : "FREE";

        const plan = PLANS[tierStr];

        const now = new Date();
        const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

        const [sitesCount, blogsCount, auditsCount] = await Promise.all([
            prisma.site.count({ where: { userId } }),
            prisma.blog.count({
                where: { site: { userId }, createdAt: { gte: startOfMonth } },
            }),
            prisma.audit.count({
                where: { site: { userId }, runTimestamp: { gte: startOfMonth } },
            }),
        ]);

        return {
            tier: tierStr,
            sites:  { used: sitesCount,  limit: plan.limits.sites },
            // limit: -1 signals "unlimited" to the UI (no monthly cap).
            // Monthly count is still shown for info only — it no longer blocks anything.
            blogs:  { used: blogsCount,  limit: -1 },
            audits: { used: auditsCount, limit: -1 },
            credits: { remaining: user.credits ?? 0 },
        };
    } catch (error: unknown) {
        logger.error("[getUserUsage] Error fetching usage:", { error: (error as Error)?.message || String(error) });
        return null;
    }
}
