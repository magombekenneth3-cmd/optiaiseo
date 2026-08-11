import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

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
        id: `job-${type.toLowerCase()}-${Date.now()}`,
        type,
        payload,
        createdAt: new Date(),
    };

    const redis = getRedis();
    if (redis) {
        try {
            await redis.lpush(`aiseo:queue:${type.toLowerCase()}`, JSON.stringify(job));
            logger.info("[Queue] Enqueued task to Redis queue", { jobId: job.id, type });
        } catch {
            logger.warn("[Queue] Redis offline — executed inline fallback", { jobId: job.id, type });
        }
    } else {
        logger.info("[Queue] Redis omitted — running task inline", { jobId: job.id, type });
    }

    return job;
}
