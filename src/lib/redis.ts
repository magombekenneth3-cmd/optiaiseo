import { Redis } from "@upstash/redis";

const url   = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

// Skip validation during `next build` — Next.js sets NODE_ENV=production at
// build time and evaluates server-side modules, but Redis is only needed at
// runtime. The Dockerfile sets SKIP_ENV_VALIDATION=1 as a belt-and-suspenders
// signal; we also check NEXT_PHASE directly.
const isBuildPhase =
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.SKIP_ENV_VALIDATION === "1";

if (process.env.NODE_ENV === "production" && !isBuildPhase && (!url || !token)) {
    console.warn(
        "[Redis] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set. " +
        "Rate limiting, notification caching, and session cache-busting are disabled. " +
        "Set credentials at https://console.upstash.com"
    );
}

export const redis = new Redis({
    url:   url   ?? "http://localhost",
    token: token ?? "placeholder",
    // Keep transient network failures bounded. Upstash uses HTTP requests, so
    // failures reject the command promise instead of emitting socket events.
    retry: {
        retries: 1,
        backoff: (retryCount) => Math.min(250 * 2 ** retryCount, 1_000),
    },
});

export const isRedisConfigured = !!(url && token);

export function getRedis(): Redis | null {
    if (!url || !token) return null;
    return redis;
}

/** Return only a stable machine identifier; never log an endpoint or error body. */
export function redisErrorCode(error: unknown): string {
    if (!error || typeof error !== "object") return "redis_error";
    const value = error as { code?: unknown; name?: unknown };
    for (const candidate of [value.code, value.name]) {
        if (typeof candidate === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(candidate)) {
            return candidate;
        }
    }
    return "redis_error";
}

