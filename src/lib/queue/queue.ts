import { getRedis, redisErrorCode } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { randomUUID } from "node:crypto";

export interface QueueJob<T = any> {
    id: string;
    type: "AEO_AUDIT" | "PDF_GENERATION" | "BATCH_INDEXING";
    payload: T;
    createdAt: Date;
}

export async function enqueueTask<T = any>(
    type: QueueJob["type"],
    payload: T
): Promise<QueueJob<T>> {
    const job: QueueJob<T> = {
        id: `job-${type.toLowerCase()}-${randomUUID()}`,
        type,
        payload,
        createdAt: new Date(),
    };

    const redis = getRedis();
    if (!redis) {
        throw new Error("Redis-backed task queue is unavailable because Redis is not configured.");
    }

    try {
        await redis.lpush(`aiseo:queue:${type.toLowerCase()}`, JSON.stringify(job));
        logger.info("[Queue] Enqueued task to Redis queue", { jobId: job.id, type });
    } catch (error) {
        logger.error("[Queue] Failed to enqueue task; caller must retry", {
            jobId: job.id,
            type,
            errorCode: redisErrorCode(error),
        });
        throw new Error("Redis-backed task queue is unavailable. The task was not accepted.");
    }

    return job;
}
