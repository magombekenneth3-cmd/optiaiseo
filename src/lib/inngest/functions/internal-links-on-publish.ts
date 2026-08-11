import { inngest } from "../client";
import { logger } from "@/lib/logger";
import { analyzeInternalLinking } from "@/lib/seo-audit/internal-links";
import { syncVectorInternalLinksForSite } from "@/lib/blog/vector-linker";

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

        const vectorOpportunities = await step.run("sync-vector-internal-links", async () => {
            return syncVectorInternalLinksForSite(siteId, blogId);
        });

        logger.info("[InternalLinks/OnPublish] Opportunities found", {
            blogId,
            count: opportunities.length,
            vectorUpdatedCount: vectorOpportunities.filter(v => v.updated).length,
        });

        return { blogId, linked: opportunities.length, vectorLinked: vectorOpportunities.length };
    }
);
