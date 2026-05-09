/**
 * Monthly quota rate limiting.
 *
 * Uses Upstash Redis for durable, calendar-month counters. Falls back to a
 * permissive in-memory counter in local dev so the app stays functional without
 * a live Redis connection.
 *
 * Key design decisions:
 *   - Calendar-month windows (not rolling): counters reset on the 1st of each month UTC.
 *   - Uses raw Redis INCR + EXPIREAT rather than @upstash/ratelimit's sliding window,
 *     which is not reliable for multi-day windows.
 *   - Redis failure in production → fail-open with a warning. A Redis blip should
 *     never lock users out of the product entirely.
 *   - Uses the shared @/lib/redis singleton — same connection pool as auth, session
 *     cache, etc. No separate Redis client created here.
 */
import { logger } from "@/lib/logger";
import { getPlan } from "@/lib/stripe/plans";
import { redis as _sharedRedis } from "@/lib/redis";

export type RateLimitResult = {
    allowed:   boolean;
    remaining: number;
    resetAt:   Date;
};

// ─── Calendar-month helpers ───────────────────────────────────────────────────

function getCalendarMonthWindow(): { monthKey: string; resetAt: Date } {
    const now      = new Date();
    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const resetAt  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
    return { monthKey, resetAt };
}

// ─── In-memory fallback (local dev only) ─────────────────────────────────────

const _mem = new Map<string, { count: number; resetAt: number }>();

function checkMemory(key: string, limit: number, resetAt: Date): RateLimitResult {
    const now      = Date.now();
    const existing = _mem.get(key);

    if (!existing || existing.resetAt < now) {
        _mem.set(key, { count: 1, resetAt: resetAt.getTime() });
        return { allowed: true, remaining: limit - 1, resetAt };
    }
    if (existing.count >= limit) {
        return { allowed: false, remaining: 0, resetAt: new Date(existing.resetAt) };
    }
    existing.count++;
    return { allowed: true, remaining: limit - existing.count, resetAt: new Date(existing.resetAt) };
}

// ─── Redis INCR-based counter (production) ────────────────────────────────────

async function checkRedis(key: string, limit: number, resetAt: Date): Promise<RateLimitResult> {
    const count = await _sharedRedis.incr(key);

    // Set expiry only on first increment — subsequent calls must not extend the window.
    if (count === 1) {
        await _sharedRedis.expireat(key, Math.floor(resetAt.getTime() / 1000));
    }

    const allowed   = count <= limit;
    const remaining = Math.max(limit - count, 0);

    // Decrement when over limit so the counter stays capped at `limit`.
    if (!allowed) await _sharedRedis.decr(key);

    return { allowed, remaining, resetAt };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const checkRateLimit = async (
    key: string,
    limit: number,
    windowSecondsOrResetAt: number | Date,
): Promise<RateLimitResult> => {
    if (process.env.NODE_ENV === "test") {
        return { allowed: true, remaining: 999, resetAt: new Date(Date.now() + 86_400_000) };
    }

    const resetAt = windowSecondsOrResetAt instanceof Date
        ? windowSecondsOrResetAt
        : new Date(Date.now() + windowSecondsOrResetAt * 1000);

    const hasRedis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

    if (!hasRedis) {
        if (process.env.NODE_ENV === "production") {
            logger.error("[RateLimit/Monthly] UPSTASH credentials missing in production — failing open.");
            return { allowed: true, remaining: 0, resetAt };
        }
        return checkMemory(key, limit, resetAt);
    }

    try {
        return await checkRedis(key, limit, resetAt);
    } catch (err: unknown) {
        logger.error("[RateLimit/Monthly] Redis error — failing open to prevent user lockout:", {
            error: err instanceof Error ? (err.stack ?? err.message) : String(err),
        });
        return { allowed: true, remaining: 0, resetAt };
    }
};

// ─── Per-feature quota helpers ────────────────────────────────────────────────

export const checkBlogLimit = (userId: string, tier: string): Promise<RateLimitResult> => {
    const { monthKey, resetAt } = getCalendarMonthWindow();
    return checkRateLimit(`blog:${userId}:${monthKey}`, getPlan(tier).limits.blogsPerMonth, resetAt);
};

export const checkAuditLimit = (userId: string, tier: string): Promise<RateLimitResult> => {
    const { monthKey, resetAt } = getCalendarMonthWindow();
    return checkRateLimit(`audit:${userId}:${monthKey}`, getPlan(tier).limits.auditsPerMonth, resetAt);
};

export const checkAeoLimit = (userId: string, tier: string): Promise<RateLimitResult> => {
    const { monthKey, resetAt } = getCalendarMonthWindow();
    return checkRateLimit(`aeo:${userId}:${monthKey}`, getPlan(tier).limits.aeoAuditsPerMonth, resetAt);
};

export const checkVerificationLimit = (userId: string, tier: string): Promise<RateLimitResult> => {
    const limits: Record<string, number> = { FREE: 10, STARTER: 40, PRO: 100, AGENCY: 1000 };
    const { monthKey, resetAt } = getCalendarMonthWindow();
    return checkRateLimit(`verify:${userId}:${monthKey}`, limits[tier] ?? 10, resetAt);
};

export const checkKgFeedLimit = (userId: string, tier: string): Promise<RateLimitResult> => {
    const limits: Record<string, number> = { FREE: 5, STARTER: 30, PRO: 100, AGENCY: 500 };
    const { monthKey, resetAt } = getCalendarMonthWindow();
    return checkRateLimit(`kgfeed:${userId}:${monthKey}`, limits[tier] ?? 5, resetAt);
};

export const checkCompetitorRefreshLimit = (userId: string): Promise<RateLimitResult> => {
    const { monthKey, resetAt } = getCalendarMonthWindow();
    return checkRateLimit(`competitor-refresh:${userId}:${monthKey}`, 10, resetAt);
};

export const checkAeoVerifyLimit = (userId: string): Promise<RateLimitResult> => {
    const { monthKey, resetAt } = getCalendarMonthWindow();
    return checkRateLimit(`aeo-verify:${userId}:${monthKey}`, 20, resetAt);
};

export const checkFixLimit = (userId: string, tier: string): Promise<RateLimitResult> => {
    const limits: Record<string, number> = { FREE: 20, STARTER: 100, PRO: 300, AGENCY: 1000 };
    const { monthKey, resetAt } = getCalendarMonthWindow();
    return checkRateLimit(`fix:${userId}:${monthKey}`, limits[tier?.toUpperCase()] ?? 20, resetAt);
};

export const checkSerpAnalysisLimit = (userId: string, tier: string): Promise<RateLimitResult> => {
    const limits: Record<string, number> = { FREE: 0, STARTER: 5, PRO: 30, AGENCY: 200 };
    const { monthKey, resetAt } = getCalendarMonthWindow();
    const cap = limits[tier?.toUpperCase()] ?? 0;
    return checkRateLimit(`serp-analysis:${userId}:${monthKey}`, cap, resetAt);
};
