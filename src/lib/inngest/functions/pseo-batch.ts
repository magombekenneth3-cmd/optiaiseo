import { inngest } from "../client";
import { generateSinglePseoPage, PseoBatchRequest } from "@/lib/pseo/generator";
import { logger } from "@/lib/logger";

export const pseoBatchFunction = inngest.createFunction(
    {
        id: "pseo-batch-generator",
        name: "Programmatic SEO Batch Generator",
        triggers: [{ event: "pseo/batch.requested" }],
    },
    async ({ event, step }) => {
        const req = event.data as PseoBatchRequest & { batchJobId: string };
        logger.info("[pSEO Worker] Starting async batch generation", { batchJobId: req.batchJobId });

        for (let i = 0; i < req.dataset.length; i++) {
            const row = req.dataset[i];

            await step.run(`generate-page-${i}`, async () => {
                const page = await generateSinglePseoPage(
                    req.pattern,
                    row,
                    req.siteDomain,
                    req.authorName
                );
                return page;
            });
        }

        await step.run("mark-batch-job-complete", async () => {
            logger.info("[pSEO Worker] Batch job completed successfully", { batchJobId: req.batchJobId });
        });

        return { success: true, batchJobId: req.batchJobId, count: req.dataset.length };
    }
);
