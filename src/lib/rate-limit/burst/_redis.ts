/**
 * Shared Redis client factory for all burst rate-limiters.
 *
 * A single module-level singleton is created here and imported by every
 * limiter module. This guarantees:
 *   - One connection pool shared across all limiters (not N independent pools)
 *   - One place to change connection options (TLS, retry, timeout)
 *   - No silent divergence between copies of buildRedis()
 *
 * The singleton is null when Upstash credentials are absent (local dev / CI).
 * Every consumer must handle the null case — see ALLOW_ALL in client.ts.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "@/lib/redis";

// Reuse the same bounded-retry Upstash client as the rest of the app.
export const redis = getRedis();

// Returned by makeLimiter() when Redis is unavailable.
// Always allows requests so local dev and CI are never blocked.
export const ALLOW_ALL: Ratelimit = {
    limit: async (_id: string) => ({
        success:   true,
        limit:     9999,
        remaining: 9999,
        reset:     0,
        pending:   Promise.resolve(),
    }),
} as unknown as Ratelimit;
