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

if (process.env.NODE_ENV === "production" && !isBuildPhase) {
    if (!url || !token) {
        // Hard crash — do not allow the app to start without Redis in production.
        // Without Redis: rate limiting, account lockout, and JWT cache-busting
        // are silently disabled, creating security vulnerabilities.
        throw new Error(
            "[Redis] UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN " +
            "are required in production. " +
            "Set them in your environment and redeploy. " +
            "Get credentials at https://console.upstash.com"
        );
    }
}

export const redis = new Redis({
    url:   url   ?? "http://localhost",
    token: token ?? "placeholder",
});

export const isRedisConfigured = !!(url && token);
