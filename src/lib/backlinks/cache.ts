/**
 * Redis-backed cache helper for backlink DataForSEO calls.
 * Uses Upstash Redis (@upstash/redis) — the same client used elsewhere in the app.
 *
 * TTLs:
 *   summary          → 1 hour   (summary is cheap to re-fetch, but not every page load)
 *   details          → 6 hours  (per-backlink data changes slowly)
 *   referringDomains → 1 hour   (used for gap analysis + alert detection)
 */

import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";

export const BACKLINK_CACHE_TTL = {
    summary:          60 * 60,          // 1 hour
    details:          6 * 60 * 60,      // 6 hours
    referringDomains: 60 * 60,          // 1 hour
} as const;

export const cacheKeys = {
    summary:          (domain: string) => `bl:summary:${domain}`,
    details:          (domain: string) => `bl:details:${domain}`,
    referringDomains: (domain: string) => `bl:rd:${domain}`,
};

/**
 * Check the cache for `key`. On a hit, parse and return the value.
 * On a miss, call `fetcher`, write the result to Redis, and return it.
 * Any Redis errors are caught and logged — the fetcher result is always returned.
 */
export async function withBacklinkCache<T>(
    key: string,
    ttl: number,
    fetcher: () => Promise<T>,
): Promise<T> {
    try {
        // Upstash Redis client returns the parsed value directly (or null on miss)
        const cached = await redis.get<string>(key);
        if (cached) {
            return JSON.parse(cached) as T;
        }
    } catch (err) {
        logger.warn("[BacklinkCache] Cache read failed — proceeding without cache", {
            key, err: String(err),
        });
    }

    const fresh = await fetcher();

    try {
        // setex: set with expiry in seconds
        await redis.setex(key, ttl, JSON.stringify(fresh));
    } catch (err) {
        // Cache write failure is non-fatal — the fresh data is still returned
        logger.warn("[BacklinkCache] Cache write failed", { key, err: String(err) });
    }

    return fresh;
}

/**
 * Bust all three cache keys for a domain.
 * Called when the user explicitly requests a refresh.
 * Errors are swallowed — cache eviction is always best-effort.
 */
export async function bustBacklinkCache(domain: string): Promise<void> {
    try {
        await Promise.all([
            redis.del(cacheKeys.summary(domain)),
            redis.del(cacheKeys.details(domain)),
            redis.del(cacheKeys.referringDomains(domain)),
        ]);
    } catch (err) {
        logger.warn("[BacklinkCache] Cache bust failed", { domain, err: String(err) });
    }
}
