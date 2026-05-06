/**
 * Redis Rate-Limit Key Cleanup
 *
 * @upstash/ratelimit sets TTLs automatically, so keys expire naturally.
 * However orphaned keys can accumulate from:
 *   - Old limiter prefixes that were renamed or removed
 *   - Testing/staging data that leaked into production namespaces
 *   - Manual redis.set() calls during debugging
 *
 * Run once per month from the cleanup cron route.
 * NOTE: SCAN may take a few seconds on large datasets — never use on a hot request path.
 */
import { Redis } from "@upstash/redis";
import { logger } from "@/lib/logger";

/** All currently active rl: prefixes — update this if you add/rename a limiter */
const ACTIVE_PREFIXES = [
    "rl:auth",
    "rl:password-reset",
    "rl:api",
    "rl:blog-generate",
    "rl:aeo-check",
    "rl:voice-session",
    "rl:audit-run",
    "rl:competitor-fetch",
    "rl:github-pr",
    "rl:indexing-submit",
    "rl:webhook",
    "rl:edge",
    "rl:tier:",         // prefix match (FREE / PRO / AGENCY suffixes)
    "rl:session-tool:", // prefix match (per-tool keys)
];

function isActiveKey(key: string): boolean {
    return ACTIVE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export interface CleanupResult {
    scanned: number;
    deleted: number;
    orphans: string[];
}

/**
 * Scan all rate-limit keys and delete any that no longer belong to an active prefix.
 * Safe to call without arguments — builds its own Redis instance.
 */
export async function cleanupOrphanedRateLimitKeys(): Promise<CleanupResult> {
    const redis = Redis.fromEnv();

    let cursor = 0;
    let scanned = 0;
    let deleted = 0;
    const orphans: string[] = [];

    do {
        const [nextCursor, keys] = await redis.scan(cursor, {
            match: "rl:*",
            count: 100,
        });
        cursor = parseInt(String(nextCursor), 10);
        scanned += keys.length;

        const orphanBatch = keys.filter((k) => !isActiveKey(k));
        orphans.push(...orphanBatch);

        if (orphanBatch.length > 0) {
            await redis.del(...orphanBatch);
            deleted += orphanBatch.length;
        }
    } while (cursor !== 0);

    logger.info("[RateLimit/Cleanup] Scan complete", { scanned, deleted });
    return { scanned, deleted, orphans };
}
