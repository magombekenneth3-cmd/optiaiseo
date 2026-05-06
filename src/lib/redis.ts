import { Redis } from "@upstash/redis";

const url   = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (process.env.NODE_ENV === "production") {
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
