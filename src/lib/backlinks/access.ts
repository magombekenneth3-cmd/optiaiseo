/**
 * Central authorization and cost controls for DataForSEO-backed operations.
 * Keep this separate from routes/actions so every entry point applies the same
 * paid-feature and rate-limit policy.
 */

import { checkRateLimit } from "@/lib/rate-limit";
import { hasFeature } from "@/lib/stripe/plans";
import { isRedisConfigured } from "@/lib/redis";

export type BacklinkOperation =
    | "summary"
    | "details"
    | "sync"
    | "gap"
    | "target-summary";

const RATE_LIMITS: Record<BacklinkOperation, { max: number }> = {
    summary: { max: 20 },
    details: { max: 10 },
    sync: { max: 10 },
    gap: { max: 5 },
    "target-summary": { max: 10 },
};

export type BacklinkAccess =
    | { allowed: true; remaining: number | null }
    | { allowed: false; status: 403 | 429 | 503; error: string };

/**
 * Verify a paid backlink entitlement and, for an actual provider call, consume
 * one daily operation allowance. DB-only reads never use this function.
 */
export async function authorizeBacklinkOperation(
    userId: string,
    subscriptionTier: string | null | undefined,
    operation: BacklinkOperation,
    consumeRateLimit = true,
): Promise<BacklinkAccess> {
    if (!hasFeature(subscriptionTier ?? "FREE", "backlinks")) {
        return {
            allowed: false,
            status: 403,
            error: "Backlink monitoring requires a Pro plan.",
        };
    }

    if (!consumeRateLimit) return { allowed: true, remaining: null };

    // The shared rate-limit helper deliberately fails open for most product
    // features. That is unsafe for a metered provider: without Redis an
    // attacker could turn a transient infrastructure issue into uncapped API
    // spend. Local development still uses the helper's in-memory fallback.
    if (process.env.NODE_ENV === "production" && !isRedisConfigured) {
        return {
            allowed: false,
            status: 503,
            error: "Backlink monitoring is temporarily unavailable while usage controls reconnect.",
        };
    }

    const config = RATE_LIMITS[operation];
    const result = await checkRateLimit(
        "backlinks:" + operation + ":" + userId,
        config.max,
        86_400,
    );
    if (!result.allowed) {
        return {
            allowed: false,
            status: 429,
            error: "Daily backlink lookup limit reached. Try again tomorrow.",
        };
    }

    return { allowed: true, remaining: result.remaining };
}
