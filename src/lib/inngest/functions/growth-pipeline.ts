/**
 * Growth Pipeline — per-site Inngest handler.
 *
 * Triggered by the `growth.pipeline.run` event (fired by the weekly cron
 * fan-out in cron-schedule.ts). Runs the recommendation engine for a single
 * site and persists new decisions.
 */

import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { buildRecommendations } from "@/lib/recommendations/engine";
import type { SiteContext } from "@/lib/recommendations/engine";
import { logger } from "@/lib/logger";

export const growthPipelineJob = inngest.createFunction(
    {
        id: "growth-pipeline-site",
        name: "Growth Pipeline: Per-Site Recommendations",
        retries: 2,
        concurrency: { limit: 3 },
        triggers: [{ event: "growth.pipeline.run" }],
    },
    async ({ event, step }: { event: { data: { siteId: string } }; step: any }) => {
        const { siteId } = event.data;

        // Build SiteContext from DB
        const ctx = await step.run("build-site-context", async (): Promise<SiteContext | null> => {
            const site = await prisma.site.findUnique({
                where: { id: siteId },
            });

            if (!site) return null;

            const [trackedKwCount, publishedBlogCount] = await Promise.all([
                prisma.trackedKeyword.count({ where: { siteId } }).catch(() => 0),
                prisma.blog.count({ where: { siteId, status: "PUBLISHED" } }).catch(() => 0),
            ]);

            return {
                siteId: site.id,
                userId: site.userId,
                domain: site.domain,
                hasGithub: !!(site as any).githubRepoUrl,
                hasGsc: !!(site as any).gscConnected,
                hasAeo: false,
                hasIndexNow: false,
                hasTrackedKeywords: trackedKwCount > 0,
                hasBlogsPublished: publishedBlogCount > 0,
                operatingMode: (site as any).operatingMode ?? "AUTOPILOT",
            };
        });

        if (!ctx) {
            logger.warn("[GrowthPipeline] Site not found", { siteId });
            return { siteId, status: "SITE_NOT_FOUND", recommendations: 0 };
        }

        const result = await step.run("generate-recommendations", async () => {
            try {
                const recs = await buildRecommendations(ctx);
                return {
                    success: true,
                    totalRecommendations: recs.recommendations?.length ?? 0,
                };
            } catch (err: unknown) {
                logger.error("[GrowthPipeline] buildRecommendations failed", {
                    siteId,
                    error: (err as Error)?.message,
                });
                return { success: false, totalRecommendations: 0 };
            }
        });

        if (!result.success) {
            return { siteId, status: "FAILED", recommendations: 0 };
        }

        logger.info("[GrowthPipeline] Pipeline completed", {
            siteId,
            recommendations: result.totalRecommendations,
        });

        return {
            siteId,
            status: "COMPLETED",
            recommendations: result.totalRecommendations,
        };
    }
);
