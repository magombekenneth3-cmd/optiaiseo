/**
 * Tier-aware burst rate limiting.
 *
 * Separate from monthly quotas (rate-limit/monthly/) — monthly quotas cap total
 * usage per calendar month, this caps burst rate per minute by subscription tier.
 *
 * Applied in route handlers AFTER the named per-endpoint limiter so both work
 * in concert:
 *   named limiter → caps calls to this specific endpoint
 *   tier limiter  → caps general API burst rate by subscription level
 */
import { Ratelimit } from "@upstash/ratelimit";
import { logger } from "@/lib/logger";
import { redis, ALLOW_ALL } from "./_redis";

type SubscriptionTier = "FREE" | "STARTER" | "PRO" | "AGENCY";

const TIER_BURST_LIMITS: Record<SubscriptionTier, { requests: number; window: string }> = {
    FREE:    { requests: 10,  window: "1 m" },
    STARTER: { requests: 30,  window: "1 m" },
    PRO:     { requests: 60,  window: "1 m" },
    AGENCY:  { requests: 200, window: "1 m" },
};

// One limiter instance per tier, created on first use.
const limiterCache = new Map<string, Ratelimit>();

function getLimiterForTier(tier: string): Ratelimit {
    if (!redis) return ALLOW_ALL;
    if (limiterCache.has(tier)) return limiterCache.get(tier)!;

    if (!(tier in TIER_BURST_LIMITS)) {
        logger.warn("[RateLimit/Tier] Unknown subscription tier — applying FREE limits", { tier });
    }
    const { requests, window } = TIER_BURST_LIMITS[tier as SubscriptionTier] ?? TIER_BURST_LIMITS.FREE;

    const limiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(
            requests,
            window as Parameters<typeof Ratelimit.slidingWindow>[1],
        ),
        prefix: `rl:tier:${tier}`,
        analytics: true,
    });

    limiterCache.set(tier, limiter);
    return limiter;
}

/**
 * Check the tier-based burst limit for a user.
 *
 * @param userId  The authenticated user's ID (the rate-limit key)
 * @param tier    Subscription tier — "FREE" | "STARTER" | "PRO" | "AGENCY"
 * @returns       A 429 Response with an upgrade URL, or null if allowed
 */
export async function rateLimitByTier(
    userId: string,
    tier: string,
): Promise<Response | null> {
    const limiter = getLimiterForTier(tier);
    const { success, limit, remaining, reset } = await limiter.limit(userId);

    if (!success) {
        const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
        return new Response(
            JSON.stringify({
                error:      "Rate limit exceeded for your plan",
                tier,
                limit,
                remaining:  0,
                reset,
                retryAfter,
                upgradeUrl: "/billing",
            }),
            {
                status: 429,
                headers: {
                    "Content-Type":          "application/json",
                    "X-RateLimit-Limit":     String(limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset":     String(reset),
                    "Retry-After":           String(retryAfter),
                },
            },
        );
    }

    return null;
}
