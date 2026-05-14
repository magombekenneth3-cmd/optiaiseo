import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export const purgeExpiredSerpCache = inngest.createFunction(
    {
        id: "purge-expired-serp-cache",
        name: "Purge Expired SERP Cache",
        retries: 1,
        triggers: [{ cron: "0 3 * * 0" }],
    },
    async ({ step }) => {
        const deleted = await step.run("delete-expired-serp", async () => {
            const result = await prisma.keywordSerpAnalysis.deleteMany({
                where: { expiresAt: { lt: new Date() } },
            });
            return result.count;
        });

        logger.info(`[PurgeSerpCache] Deleted ${deleted} expired KeywordSerpAnalysis rows`);
        return { deleted };
    }
);
