/**
 * 6.1: Credits-based usage layer
 * Atomic credit check + deduction for expensive API actions.
 * Protects: full audit (10), AEO check (5), blog generation (15),
 * competitor analysis (8), GitHub PR fix (3), voice session (2).
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

import {
    CREDIT_COSTS,
    type CreditAction,
    ACTION_LABELS,
    FREE_MONTHLY_CREDITS,
    STARTER_MONTHLY_CREDITS,
    PRO_MONTHLY_CREDITS,
    AGENCY_MONTHLY_CREDITS,
    monthlyCreditsForTier
} from "./constants";

export {
    CREDIT_COSTS,
    type CreditAction,
    ACTION_LABELS,
    monthlyCreditsForTier
};

interface ConsumeResult {
    allowed: boolean;
    remaining: number;
    cost: number;
    reason?: string;
}

/**
 * Atomically check balance and deduct credits.
 * Uses a raw updateMany with a WHERE credits >= cost to ensure atomicity.
 */
export async function consumeCredits(
    userId: string,
    action: CreditAction,
    multiplier = 1,
): Promise<ConsumeResult> {
    const cost = CREDIT_COSTS[action] * multiplier;

    // Free actions always pass
    if (cost === 0) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { credits: true },
        });
        return { allowed: true, remaining: user?.credits ?? 0, cost: 0 };
    }

    // Check if credits are locked (subscription expired, read-only window)
    const lockCheck = await prisma.user.findUnique({
        where: { id: userId },
        select: { creditsLockedAt: true, credits: true },
    });
    if (lockCheck?.creditsLockedAt) {
        logger.warn(`[Credits] Credits locked — cannot consume for ${action}`, {
            userId, cost, remaining: lockCheck.credits,
            lockedAt: lockCheck.creditsLockedAt.toISOString(),
        });
        return {
            allowed: false,
            remaining: lockCheck.credits,
            cost,
            reason: "credits_locked",
        };
    }

    // Atomic deduct: only updates if credits >= cost
    const result = await prisma.$executeRaw`
        UPDATE "User"
        SET credits = credits - ${cost}
        WHERE id = ${userId}
        AND credits >= ${cost}
        AND "creditsLockedAt" IS NULL
    `;

    if (result === 0) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { credits: true },
        });
        const remaining = user?.credits ?? 0;
        logger.warn(`[Credits] Insufficient credits for ${action}`, { userId, cost, remaining });
        return { allowed: false, remaining, cost, reason: "insufficient_credits" };
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { credits: true },
    });

    const remaining = user?.credits ?? 0;

    // Fire-and-forget ledger write — never blocks or throws for the caller.
    prisma.creditHistory.create({
        data: {
            userId,
            action,
            label: ACTION_LABELS[action],
            cost,
            balanceAfter: remaining,
        },
    }).catch((err: unknown) => {
        logger.warn("[Credits] Failed to write credit ledger:", { error: (err as Error)?.message });
    });

    return { allowed: true, remaining, cost };
}

/**
 * Monthly cron: reset credits for all users based on their plan.
 * Called by: a monthly Inngest cron job.
 */
export async function resetMonthlyCredits(): Promise<void> {
    // IMPORTANT: use GREATEST(credits, amount) not SET credits = amount.
    // A flat overwrite destroys purchased credit packs.
    // e.g. user on PRO buys 200-credit pack mid-month, has 220 remaining —
    // without GREATEST the reset would drop them to 500 (PRO floor), losing nothing,
    // but if they had 620 it would wipe 120 purchased credits.
    // GREATEST ensures the monthly floor is restored without capping earned/purchased surplus.
    const tiers = [
        { tier: "FREE",       amount: FREE_MONTHLY_CREDITS },
        { tier: "STARTER",   amount: STARTER_MONTHLY_CREDITS },
        { tier: "PRO",       amount: PRO_MONTHLY_CREDITS },
        { tier: "AGENCY",    amount: AGENCY_MONTHLY_CREDITS },
    ];

    let totalUsersReset = 0;

    await prisma.$transaction(async (tx) => {
        for (const { tier, amount } of tiers) {
            const affected = await tx.$executeRaw`
                UPDATE "User"
                SET credits = GREATEST(credits, ${amount})
                WHERE "subscriptionTier" = ${tier}
            `;
            totalUsersReset += Number(affected);
        }
    });

    logger.info("[Credits] Monthly credits reset complete", { totalUsersReset });
}

/**
 * One-time credit pack purchase: add credits on top of the user's current balance.
 * Called by the Stripe webhook when a CREDIT_PACK invoice is paid.
 * Uses an atomic increment so concurrent purchases never race.
 */
export async function addCreditPackCredits(
    userId: string,
    creditsToAdd: number,
): Promise<void> {
    if (creditsToAdd <= 0) {
        logger.warn("[Credits] addCreditPackCredits called with non-positive amount", {
            userId,
            creditsToAdd,
        });
        return;
    }

    await prisma.$executeRaw`
        UPDATE "User"
        SET credits = credits + ${creditsToAdd}
        WHERE id = ${userId}
    `;

    logger.info("[Credits] Added credit pack credits", { userId, creditsToAdd });
}
