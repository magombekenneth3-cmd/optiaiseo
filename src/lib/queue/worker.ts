import { getRedis } from "@/lib/redis";
import { QueueJob } from "@/lib/queue/queue";
import { logger } from "@/lib/logger";

export async function processNextJob(queueName: string = "aiseo:queue:aeo_audit"): Promise<QueueJob | null> {
    const redis = getRedis();
    if (!redis) return null;

    try {
        const raw = await redis.rpop(queueName);
        if (!raw) return null;

        const job: QueueJob = typeof raw === "string" ? JSON.parse(raw) : raw;

        logger.info("[QueueWorker] Processing background task", {
            jobId: job.id,
            type: job.type,
        });

        return job;
    } catch (err: unknown) {
        logger.error("[QueueWorker] Failed to process job from queue", {
            queueName,
            error: (err as Error)?.message || String(err),
        });
        return null;
    }
}
