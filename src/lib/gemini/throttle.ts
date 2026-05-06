import { logger } from "@/lib/logger";

const MAX_REQUESTS_PER_MINUTE = parseInt(process.env.GEMINI_RPM_LIMIT ?? "4", 10);
const MAX_THROTTLE_ATTEMPTS = 100;

function currentMinuteWindow(): number {
    return Math.floor(Date.now() / 60000);
}

function msUntilNextMinute(): number {
    return 60000 - (Date.now() % 60000);
}

function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

export async function throttledGeminiCall<T>(fn: () => Promise<T>): Promise<T> {
    let redis: import("@upstash/redis").Redis | null = null;

    try {
        const mod = await import("@/lib/redis");
        redis = mod.redis;
    } catch {
        logger.warn("[Gemini Throttle] Redis unavailable — applying fallback delay");
        await delay(1000 + Math.random() * 500);
        return fn();
    }

    const start = Date.now();

    for (let attempt = 0; attempt < MAX_THROTTLE_ATTEMPTS; attempt++) {
        if (Date.now() - start > 65000) {
            throw new Error("Gemini throttle timeout");
        }

        const key = `gemini:rpm:${currentMinuteWindow()}`;

        try {
            const count = await redis.incr(key);

            if (count === 1) {
                await redis.expire(key, 65);
            }

            if (count <= MAX_REQUESTS_PER_MINUTE) {
                break;
            }

            const waitMs = msUntilNextMinute() + 100;
            const jitter = Math.random() * 300;

            logger.warn("[Gemini Throttle] Rate limit hit", {
                key,
                count,
                limit: MAX_REQUESTS_PER_MINUTE,
                waitMs,
            });

            await delay(waitMs + jitter);
        } catch (redisErr) {
            logger.error("[Gemini Throttle] Redis error — applying fallback delay", {
                key,
                attempt,
                error: (redisErr as Error)?.message || String(redisErr),
            });
            await delay(1000 + Math.random() * 500);
            break;
        }
    }

    return fn();
}
