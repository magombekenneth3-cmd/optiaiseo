import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function checkInngestIdempotency(
    functionId: string,
    siteId: string,
    userId: string
): Promise<boolean> {
    const key = `${functionId}:${siteId}:${new Date().toISOString().slice(0, 10)}`;
    try {
        const existing = await prisma.idempotencyKey.findFirst({
            where: { idempotencyKey: key, userId },
        });
        if (existing) {
            logger.info(`[Idempotency] Skipping duplicate: ${key}`);
            return false;
        }
        await prisma.idempotencyKey.create({
            data: {
                idempotencyKey: key,
                userId,
                requestChecksum: key,
                status: "PROCESSING",
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
        });
        return true;
    } catch (e: unknown) {
        if ((e as { code?: string })?.code === "P2002") {
            logger.info(`[Idempotency] Race-condition duplicate caught: ${key}`);
            return false;
        }
        logger.warn("[Idempotency] Check failed, allowing execution", {
            error: (e as Error)?.message,
        });
        return true;
    }
}

export async function runIdempotentJob<T>(
    jobId: string,
    idempotencyKey: string,
    fn: () => Promise<T>
): Promise<{ result: T; executed: boolean }> {
    const { getRedis } = await import("@/lib/redis");
    const redis = getRedis();
    const lockKey = `job:lock:${idempotencyKey}`;
    const resultKey = `job:res:${idempotencyKey}`;

    if (redis) {
        try {
            const cached = await redis.get(resultKey);
            if (cached) {
                logger.info("[JobEngine] Idempotent job cache hit", { jobId, idempotencyKey });
                const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
                return { result: parsed as T, executed: false };
            }

            const acquired = await redis.set(lockKey, "LOCKED", { nx: true, ex: 300 });
            if (!acquired) {
                throw new Error(`Job ${jobId} with key ${idempotencyKey} is currently executing in another process.`);
            }
        } catch (err: unknown) {
            const msg = (err as Error)?.message ?? "";
            if (msg.includes("currently executing")) throw err;
            logger.warn("[JobEngine] Redis lock check failed, continuing without lock", { error: msg });
        }
    }

    try {
        const result = await fn();
        if (redis) {
            try {
                await redis.set(resultKey, JSON.stringify(result), { ex: 86400 });
                await redis.del(lockKey);
            } catch { /* non-fatal cache write error */ }
        }
        return { result, executed: true };
    } catch (err) {
        if (redis) {
            try { await redis.del(lockKey); } catch { /* ignore */ }
        }
        throw err;
    }
}

