import { inngest } from "./client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { CONCURRENCY } from "@/lib/inngest/concurrency";

const STALE_THRESHOLD_DAYS = 180;
const BATCH_SIZE = 20;

export const freshnessDecayCron = inngest.createFunction(
    {
        id: "blog-freshness-decay",
        name: "Weekly Blog Freshness Decay Audit",
        concurrency: { limit: CONCURRENCY.freshness },
    
        triggers: [{ cron: "0 3 * * 1" }],
    },
    async ({ step }) => {
        const staleBlogs = await step.run("find-stale-blogs", async () => {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - STALE_THRESHOLD_DAYS);

            return prisma.blog.findMany({
                where: {
                    status: "PUBLISHED",
                    AND: [
                        { publishedAt: { lt: cutoff } },
                        { updatedAt: { lt: cutoff } },
                    ],
                },
                select: {
                    id: true,
                    title: true,
                    slug: true,
                    publishedAt: true,
                    updatedAt: true,
                    siteId: true,
                },
                orderBy: { publishedAt: "asc" },
                take: 200,
            });
        });

        if (staleBlogs.length === 0) {
            logger.info("[freshness] No stale blogs found", { staleThresholdDays: STALE_THRESHOLD_DAYS });
            return { flagged: 0 };
        }

        logger.info("[freshness] Stale blogs found, flagging for review", {
            count: staleBlogs.length,
            staleThresholdDays: STALE_THRESHOLD_DAYS,
        });

        const batches: typeof staleBlogs[] = [];
        for (let i = 0; i < staleBlogs.length; i += BATCH_SIZE) {
            batches.push(staleBlogs.slice(i, i + BATCH_SIZE));
        }

        let flagged = 0;
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            await step.run(`flag-batch-${i}`, async () => {
                await prisma.blog.updateMany({
                    where: { id: { in: batch.map((b) => b.id) } },
                    data: { needsRefresh: true },
                });

                for (const blog of batch) {
                    const publishedAtDate = blog.publishedAt ? new Date(blog.publishedAt) : null;
                    const daysSince = publishedAtDate
                        ? Math.floor((Date.now() - publishedAtDate.getTime()) / (1000 * 60 * 60 * 24))
                        : null;

                    logger.info("[freshness] Blog flagged as stale", {
                        blogId: blog.id,
                        title: blog.title,
                        slug: blog.slug,
                        siteId: blog.siteId,
                        daysSincePublished: daysSince,
                    });
                }
            });

            flagged += batch.length;
        }

        return { flagged, staleThresholdDays: STALE_THRESHOLD_DAYS };
    }
);