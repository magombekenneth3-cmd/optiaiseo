import { prisma } from "@/lib/prisma";

/**
 * Returns true if the user has an active paid subscription.
 * Accepts userId (not email) — email is mutable and provider-dependent.
 * Every call site must pass session.user.id from the signed JWT.
 */
export async function userIsPaid(userId: string): Promise<boolean> {
    if (!userId) return false;

    const user = await prisma.user.findUnique({
        where:  { id: userId },
        select: { subscriptionTier: true },
    });

    if (!user) return false;

    // FREE is the only unpaid tier — STARTER, PRO, AGENCY are all paid
    return user.subscriptionTier !== "FREE";
}
