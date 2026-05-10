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
});

export const isRedisConfigured = !!(url && token);
