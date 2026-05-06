import { inngest } from "../client";
import { logger } from "@/lib/logger";
import { analyzeInternalLinking } from "@/lib/seo-audit/internal-links";

export const internalLinksOnPublishJob = inngest.createFunction(
    {
        id: "internal-links-on-publish",
        name: "Internal Links — Post Publish",
        retries: 2,
        concurrency: { limit: 5, key: "event.data.siteId" },
    
        triggers: [{ event: "blog.published" }],
    },
    async ({ event, step }) => {
        const { siteId, blogId } = event.data as {
            siteId: string;
            blogId: string;
            blogUrl: string;
            keyword: string;
        };

        const opportunities = await step.run("find-link-opportunities", async () => {
            return analyzeInternalLinking(siteId);
        });

        logger.info("[InternalLinks/OnPublish] Opportunities found", {
            blogId,
            count: opportunities.length,
        });

        return { blogId, linked: opportunities.length };
    }
);
