import { inngest } from "@/lib/inngest/client";
import { runCitationGapAnalysis } from "@/lib/aeo/citation-gap";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";

// ─── On-demand trigger (user clicks "Run Analysis") ───────────────────────────

export const runCitationGapOnDemand = inngest.createFunction(
    {
        id: "aeo-citation-gap-on-demand",
        name: "AEO Citation Gap — On Demand",
        // Retry twice on transient Perplexity/Gemini failures
        retries: 2,
        // Don't run more than 2 concurrent analyses (API rate limit protection)
        concurrency: { limit: 2, key: "event.data.siteId" },
        triggers: [{ event: "aeo/citation-gap.requested" }],
    },
    async ({ event, step }) => {
        const { siteId } = event.data as { siteId: string };

        const site = await step.run("load-site", async () => {
            return prisma.site.findUnique({
                where: { id: siteId },
                select: { domain: true, coreServices: true },
            });
        });

        if (!site) {
            logger.warn("[CitationGap/Inngest] Site not found", { siteId });
            return { skipped: true, reason: "site not found" };
        }

        const report = await step.run("run-analysis", async () => {
            return runCitationGapAnalysis(siteId, 20);
        });

        // Notify the user if we found high-impact gaps
        if (report.summary.highImpactGaps > 0) {
            await step.run("notify-high-impact", async () => {
                // Send via Inngest to the alerts engine
                // The alert engine picks this up and emails the user
                await inngest.send({
                    name: "alerts/citation-gap.found",
                    data: {
                        siteId,
                        domain: site.domain,
                        highImpactGaps: report.summary.highImpactGaps,
                        topGapReason: report.summary.topGapReason,
                        topCompetitor: report.summary.topCompetitorWinning,
                        topGap: report.gaps[0]
                            ? {
                                keyword: report.gaps[0].keyword,
                                competitor: report.gaps[0].topCompetitorCiting?.domain,
                                fix: report.gaps[0].fix,
                            }
                            : null,
                    },
                });
            });
        }

        return {
            siteId,
            domain: site.domain,
            gapCount: report.gapCount,
            highImpactGaps: report.summary.highImpactGaps,
        };
    }
);

// ─── Weekly cron (every Wednesday 06:00 UTC) ────────────────────────────────

export const runCitationGapWeekly = inngest.createFunction(
    {
        id: "aeo-citation-gap-weekly",
        name: "AEO Citation Gap — Weekly Cron",
        retries: 1,
        concurrency: { limit: 3 },
    
        triggers: [{ cron: "0 6 * * 3" }],
    },
    async ({ step }) => {
        const BATCH_SIZE = 50;
        let cursor: string | undefined;
        let totalDispatched = 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const batch = await step.run(`load-sites-batch-${cursor ?? "start"}`, async () => {
                return prisma.site.findMany({
                    where: {
                        user: { subscriptionTier: { in: ["PRO", "AGENCY"] } },
                        competitors: { some: {} },
                    },
                    select: { id: true, domain: true },
                    take: BATCH_SIZE,
                    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                    orderBy: { id: "asc" },
                });
            });

            if (batch.length === 0) break;

            await step.run(`dispatch-batch-${cursor ?? "start"}`, async () => {
                await inngest.send(
                    batch.map(site => ({
                        name: "aeo/citation-gap.requested" as const,
                        data: { siteId: site.id },
                    }))
                );
            });

            totalDispatched += batch.length;
            cursor = batch[batch.length - 1].id;

            if (batch.length < BATCH_SIZE) break;
        }

        logger.info("[CitationGap/Weekly] Batch complete", { totalDispatched });
        return { dispatched: totalDispatched };
    }
);