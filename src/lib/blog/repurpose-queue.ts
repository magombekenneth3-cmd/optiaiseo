import IORedis from "ioredis";
import { Queue, Worker } from "bullmq";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { repurposeBlog } from "./rules";
import type { RepurposeJobData } from "./rules";

function getRedis(): IORedis | null {
    if (!process.env.REDIS_URL) return null;
    try {
        const conn = new IORedis(process.env.REDIS_URL, {
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            lazyConnect: true,
        });
        conn.on("error", (err: Error) => {
            logger.warn("[RepurposeQueue] Redis error", { message: err.message });
        });
        return conn;
    } catch (e) {
        logger.warn("[RepurposeQueue] Redis init failed", {
            error: e instanceof Error ? e.message : String(e),
        });
        return null;
    }
}

function getQueue(): Queue {
    const redis = getRedis();
    if (!redis) throw new Error("REDIS_URL is required for the repurpose queue");
    return new Queue("repurpose", {
        connection: redis,
        defaultJobOptions: {
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: 100,
            removeOnFail: 500,
        },
    });
}

let _queue: Queue | null = null;

export async function enqueueRepurposeJob(data: RepurposeJobData): Promise<{ jobId: string }> {
    if (!_queue) _queue = getQueue();
    const job = await _queue.add("repurpose-blog", data);
    return { jobId: job.id! };
}

export function startRepurposeWorker(): Worker {
    const redis = getRedis();
    if (!redis) throw new Error("REDIS_URL is required for the repurpose worker");

    return new Worker(
        "repurpose",
        async (job) => {
            const { blogId, formats } = job.data as RepurposeJobData;

            const blog = await prisma.blog.findUnique({
                where: { id: blogId },
                include: { site: true },
            });

            if (!blog) throw new Error(`Blog not found: ${blogId}`);

            const repurposed = await repurposeBlog(blog, formats);

            await prisma.repurposedResult.upsert({
                where: { blogId },
                create: {
                    blogId,
                    siteId: blog.siteId,
                    data: repurposed as object,
                    status: "completed",
                },
                update: {
                    data: repurposed as object,
                    status: "completed",
                    updatedAt: new Date(),
                },
            });

            return repurposed;
        },
        { connection: redis, concurrency: 5 }
    );
}

export async function getRepurposeStatus(blogId: string) {
    return prisma.repurposedResult.findUnique({ where: { blogId } });
}
