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


// ── Structured error thrown by all guards ────────────────────────────────────

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

// ── Internal tier resolution (full subscription validation) ──────────────────

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
            subscription: {
                select: { status: true, currentPeriodEnd: true, stripeCustomerId: true },
            },
        },
    });

    const rawTier = (user?.subscriptionTier ?? "FREE") as Tier;

    // Always run resolveEffectiveTier — it handles trials, promo codes, and
    // any programmatic tier overrides regardless of the stored plan level.
    const resolvedTier = (await resolveEffectiveTier(userId, rawTier)) as Tier;

    // FREE (or resolved-to-FREE) users need no further subscription checks.
    if (resolvedTier === "FREE") return "FREE";

    const sub = user?.subscription;

    if (!sub) {
        // No subscription row found. Two valid reasons:
        //   1. Admin-granted tier (no Stripe involved) — trust the column.
        //   2. Stripe webhook missed subscription deletion — stale column.
        //
        // Heuristic: if the Subscription table has a stripeCustomerId, Stripe
        // was involved at some point. A missing row after that implies the webhook
        // was dropped and the subscription was deleted on Stripe's side.
        // In that case, downgrade to FREE for security.
        //
        // If there was NEVER a Subscription row, it's an admin grant — keep rawTier.
        //
        // We distinguish by querying for a soft-deleted or historically present sub.
        // Since Prisma hard-deletes, we fall back to: if stripeCustomerId exists
        // on the user object at all (via any past subscription), it was Stripe-managed.
        // For safety, we check the Subscription table directly for a deleted record.
        // If rawTier !== FREE and no sub row exists, treat as admin grant only if
        // the Subscription relation has never existed (no stripeCustomerId anywhere).
        //
        // Simpler safe default: trust admin grants by checking if any Subscription
        // row was ever connected. Since Prisma deletes cascade, a missing row when
        // rawTier is paid is ambiguous. The defence-in-depth answer is: require the
        // Stripe subscription cron (run separately) to keep the column in sync.
        // For the in-request guard, trust the column for non-FREE tiers with no sub
        // row (admin grants are rare and intentional), but log a warning.
        logger.warn("[Auth/Tier] Non-FREE tier with no subscription row", {
            userId,
            rawTier,
            resolvedTier,
            note: "Either admin grant or missed webhook. Run Stripe sync cron to verify.",
        });
        return resolvedTier;
    }

    // Active subscription: check it hasn't expired or lapsed.
    // These checks are defence-in-depth for races where the Stripe webhook
    // (customer.subscription.deleted / invoice.payment_failed) hasn't fired yet.
    if (sub.status === "canceled" || sub.status === "past_due") return "FREE";
    if (sub.currentPeriodEnd && sub.currentPeriodEnd < new Date()) return "FREE";

    return resolvedTier;
}

// ── Public guard API ─────────────────────────────────────────────────────────

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