/**
 * src/lib/stripe/guards.ts
 *
 * Single source of truth for all server-side tier enforcement.
 * Every server action and API route MUST use these helpers instead of
 * calling resolveEffectiveTier directly.
 *
 * Enforced by ESLint rule: eslint-rules/no-direct-resolve-effective-tier.js
 */

import { prisma } from "@/lib/prisma";
import { hasFeature, withinLimit, getPlan } from "./plans";
import type { Tier } from "./plans";
import { resolveEffectiveTier } from "./resolveEffectiveTier";
import { logger } from "@/lib/logger";


export class TierError extends Error {
    readonly code = "TIER_INSUFFICIENT" as const;
    readonly currentTier: Tier;
    readonly requiredTiers: Tier[];

    constructor(message: string, currentTier: Tier, requiredTiers: Tier[]) {
        super(message);
        this.name = "TierError";
        this.currentTier = currentTier;
        this.requiredTiers = requiredTiers;
    }
}

/** Narrows an unknown catch value to a safe { success: false, error } shape. */
export function guardErrorToResult(err: unknown): { success: false; error: string } {
    if (err instanceof TierError) return { success: false, error: err.message };
    if (err instanceof Error) return { success: false, error: err.message };
    return { success: false, error: "An unexpected error occurred." };
}


/**
 * Resolves the effective tier for a user, accounting for:
 * - Free trial (via resolveEffectiveTier)
 * - Cancelled or expired subscriptions (downgrade to FREE)
 *
 * This is the one place in the codebase that calls resolveEffectiveTier.
 * All other code goes through the exported guards below.
 */
async function getUserTier(userId: string): Promise<Tier> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            subscriptionTier: true,
            credits: true,
            subscription: {
                select: { status: true, currentPeriodEnd: true, stripeCustomerId: true, cancelledAt: true },
            },
        },
    });

    const rawTier = (user?.subscriptionTier ?? "FREE") as Tier;

    const resolvedTier = (await resolveEffectiveTier(userId, rawTier)) as Tier;

    if (resolvedTier === "FREE") return "FREE";

    const sub = user?.subscription;

    if (!sub) {
        logger.warn("[Auth/Tier] Non-FREE tier with no subscription row", {
            userId,
            rawTier,
            resolvedTier,
            note: "Either admin grant or missed webhook. Run Stripe sync cron to verify.",
        });
        return resolvedTier;
    }

    // Grace period: cancelled subs get 2 days to resubscribe before losing credits.
    if (sub.status === "canceled" && sub.cancelledAt) {
        const graceDeadline = new Date(sub.cancelledAt.getTime() + 2 * 24 * 60 * 60 * 1000);
        const now = new Date();

        if (now < graceDeadline) {
            // Within grace window — keep tier, let them use remaining credits
            logger.debug("[Auth/Tier] Cancelled but within 2-day grace period", {
                userId,
                cancelledAt: sub.cancelledAt.toISOString(),
                graceDeadline: graceDeadline.toISOString(),
            });
            return resolvedTier;
        }

        // Grace expired — downgrade to FREE and LOCK credits (read-only).
        // Credits stay visible but unusable. The finalizer cron wipes them
        // after 2 more days if the user doesn't top-up or resubscribe.
        logger.info("[Auth/Tier] Grace period expired — locking credits", {
            userId,
            cancelledAt: sub.cancelledAt.toISOString(),
            creditsLocked: user?.credits ?? 0,
        });
        await prisma.user.update({
            where: { id: userId },
            data: { subscriptionTier: "FREE", creditsLockedAt: new Date() },
        }).catch(() => {});
        return "FREE";
    }

    if (sub.status === "canceled") return "FREE";
    if (sub.status === "past_due") return "FREE";
    if (sub.currentPeriodEnd && sub.currentPeriodEnd < new Date()) return "FREE";

    return resolvedTier;
}


/**
 * Asserts the user has a specific plan feature.
 * Throws TierError if the check fails — catch with guardErrorToResult().
 *
 * @example
 *   await requireFeature(user.id, "competitor");
 */
export async function requireFeature(
    userId: string,
    feature: Parameters<typeof hasFeature>[1]
): Promise<void> {
    const tier = await getUserTier(userId);
    if (!hasFeature(tier, feature)) {
        throw new TierError(
            `This feature is not available on the ${tier} plan. Upgrade to continue.`,
            tier,
            ["STARTER", "PRO", "AGENCY"]
        );
    }
}

/**
 * Asserts the user is within a usage limit for the current billing period.
 * Throws TierError if the check fails — catch with guardErrorToResult().
 *
 * @example
 *   await requireWithinLimit(user.id, "blogsPerMonth", currentBlogCount);
 */
export async function requireWithinLimit(
    userId: string,
    limitKey: Parameters<typeof withinLimit>[1],
    currentUsage: number
): Promise<void> {
    const tier = await getUserTier(userId);
    if (!withinLimit(tier, limitKey, currentUsage)) {
        const limit = getPlan(tier).limits[limitKey];
        throw new TierError(
            `You have reached the ${limit} ${limitKey} limit on the ${tier} plan. Upgrade to continue.`,
            tier,
            ["STARTER", "PRO", "AGENCY"]
        );
    }
}

/**
 * Asserts the user is on one of the given tiers.
 * Use this when a feature doesn't map neatly to a plans.ts feature key.
 * Throws TierError if the check fails — catch with guardErrorToResult().
 *
 * @example
 *   await requireTiers(user.id, ["PRO", "AGENCY"]);
 */
export async function requireTiers(
    userId: string,
    allowed: Tier[]
): Promise<void> {
    const tier = await getUserTier(userId);
    if (!allowed.includes(tier)) {
        throw new TierError(
            `This feature requires the ${allowed.join(" or ")} plan. You are on ${tier}.`,
            tier,
            allowed
        );
    }
}

/**
 * Returns the resolved plan object for a user.
 * Use when you need plan metadata (limits, feature flags) without throwing.
 *
 * @example
 *   const plan = await getUserPlan(user.id);
 *   const max = plan.limits.competitorsPerSite;
 */
export async function getUserPlan(userId: string) {
    return getPlan(await getUserTier(userId));
}

/**
 * Returns the effective tier string for a user.
 * Use when you need the tier for non-guard purposes (e.g. passing to Inngest).
 * This is the ONLY approved way to read a user's tier outside guards.ts.
 *
 * @example
 *   const tier = await getEffectiveTier(user.id);
 *   await inngest.send({ name: "audit.run", data: { tier } });
 */
export async function getEffectiveTier(userId: string): Promise<Tier> {
    return getUserTier(userId);
}