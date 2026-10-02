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

function getUtcDayWindow(): { dayKey: string; resetAt: Date } {
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);
    const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return { dayKey, resetAt };
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
//
// Monthly count-based limits have been removed. Credits are the single gate for
// all compute-heavy actions (blogs, audits, AEO, fixes, SERP analysis).
// These functions are retained as no-op stubs so existing call sites continue to
// compile without changes. They always return allowed: true.
//
// Tier feature gates (requireFeature) and resource caps (sites, keywordsTracked,
// competitorsPerSite) are NOT affected — those remain enforced.

const _unlimitedResult = (): RateLimitResult => ({
    allowed:   true,
    remaining: 9999,
    resetAt:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const checkBlogLimit = (_userId: string, _tier: string): Promise<RateLimitResult> =>
    Promise.resolve(_unlimitedResult());

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const checkAuditLimit = (_userId: string, _tier: string): Promise<RateLimitResult> =>
    Promise.resolve(_unlimitedResult());

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const checkAeoLimit = (_userId: string, _tier: string): Promise<RateLimitResult> =>
    Promise.resolve(_unlimitedResult());

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const checkVerificationLimit = (_userId: string, _tier: string): Promise<RateLimitResult> =>
    Promise.resolve(_unlimitedResult());

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const checkKgFeedLimit = (_userId: string, _tier: string): Promise<RateLimitResult> =>
    Promise.resolve(_unlimitedResult());

/** Anti-abuse daily cap for competitor refreshes — retained as a genuine limiter. */
export const checkCompetitorRefreshLimit = (userId: string): Promise<RateLimitResult> => {
    const { dayKey, resetAt } = getUtcDayWindow();
    return checkRateLimit(`competitor-refresh:${userId}:${dayKey}`, 10, resetAt);
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const checkAeoVerifyLimit = (_userId: string): Promise<RateLimitResult> =>
    Promise.resolve(_unlimitedResult());

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const checkFixLimit = (_userId: string, _tier: string): Promise<RateLimitResult> =>
    Promise.resolve(_unlimitedResult());

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const checkSerpAnalysisLimit = (_userId: string, _tier: string): Promise<RateLimitResult> =>
    Promise.resolve(_unlimitedResult());
