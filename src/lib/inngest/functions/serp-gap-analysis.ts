/**
 * src/lib/inngest/functions/serp-gap-analysis.ts
 *
 * Inngest background job — SERP Gap Analysis + Implementation Plan
 *
 * Triggered by: "serp-gap/requested"
 * Payload: { siteId, userId, keyword, clientUrl, clientPosition }
 *
 * Flow:
 *   1. Validate credits & tier
 *   2. Fetch + scrape SERP (analyseSerpGap)
 *   3. Generate implementation plan (generateImplementationPlan)
 *   4. Save GapReport + ImplementationPlan to DB (SerpGapAnalysis model)
 *   5. Fire "serp-gap/completed" event for real-time UI update
 */

import { inngest } from "../client";
import { NonRetriableError } from "inngest";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { analyseSerpGap } from "@/lib/serp-gap/analyser";
import { generateImplementationPlan } from "@/lib/serp-gap/plan-generator";
import { consumeCredits } from "@/lib/credits";

const CREDIT_COST = 5; // 5 credits per gap analysis

export const runSerpGapAnalysisJob = inngest.createFunction(
    {
        id: "run-serp-gap-analysis",
        name: "SERP Gap Analysis + Implementation Plan",
        retries: 2,
        concurrency: {
            limit: 3,
            key: "event.data.siteId",
        },
        triggers: [{ event: "serp-gap/requested" }],
    },
    async ({ event, step }) => {
        const { siteId, userId, keyword, clientUrl, clientPosition, analysisId } = event.data as {
            siteId: string;
            userId: string;
            keyword: string;
            clientUrl: string;
            clientPosition: number;
            analysisId: string;
        };

        if (!siteId || !keyword || !clientUrl || !clientPosition) {
            throw new NonRetriableError("Missing required fields: siteId, keyword, clientUrl, clientPosition");
        }

        try {

        // ── Step 1: Verify record + deduct credits ────────────────────────────────
        await step.run("verify-and-deduct-credits", async () => {
            const analysis = await prisma.serpGapAnalysis.findUnique({ where: { id: analysisId } });
            if (!analysis) throw new NonRetriableError(`SerpGapAnalysis ${analysisId} not found`);

            const creditResult = await consumeCredits(userId, "serp_gap_analysis");
            if (!creditResult.allowed) {
                await prisma.serpGapAnalysis.update({
                    where: { id: analysisId },
                    data: { status: "FAILED", errorMessage: "Insufficient credits" },
                });
                throw new NonRetriableError("Insufficient credits for gap analysis");
            }

            await prisma.serpGapAnalysis.update({
                where: { id: analysisId },
                data: { status: "SCRAPING" },
            });
        });

        // ── Step 2: Run SERP analysis ─────────────────────────────────────────────
        const gapReport = await step.run("analyse-serp-gap", async () => {
            const report = await analyseSerpGap(keyword, clientUrl, clientPosition);

            if (!report) {
                const errorMsg = "SERP analysis failed — check SERPER_API_KEY, network connectivity, or if the keyword returns valid results";
                logger.error("[SerpGap] Analysis returned null", { keyword, clientUrl, clientPosition, errorMsg });
                await prisma.serpGapAnalysis.update({
                    where: { id: analysisId },
                    data: { status: "FAILED", errorMessage: errorMsg },
                });
                throw new NonRetriableError(errorMsg);
            }

            await prisma.serpGapAnalysis.update({
                where: { id: analysisId },
                data: {
                    status: "PLANNING",
                    gapReport: report as object,
                    serpFormat: report.serpFormat,
                    serpHasAiOverview: report.serpHasAiOverview,
                    serpHasFeaturedSnippet: report.serpHasFeaturedSnippet,
                    gapCount: report.gaps.length,
                    criticalGapCount: report.gaps.filter((g) => g.gap === "critical").length,
                    competitorAvgWordCount: report.topCompetitorAvgWordCount,
                },
            });

            return report;
        });

        // ── Step 3: Generate implementation plan ──────────────────────────────────
        const plan = await step.run("generate-implementation-plan", async () => {
            const implementationPlan = await generateImplementationPlan(gapReport);

            if (!implementationPlan) {
                const errorMsg = "Plan generation failed — check GEMINI_API_KEY or API rate limits";
                logger.error("[SerpGap] Plan generation returned null", { keyword, errorMsg });
                await prisma.serpGapAnalysis.update({
                    where: { id: analysisId },
                    data: { status: "FAILED", errorMessage: errorMsg },
                });
                throw new NonRetriableError(errorMsg);
            }

            return implementationPlan;
        });

        // ── Step 4: Save completed analysis ──────────────────────────────────────
        await step.run("save-completed-analysis", async () => {
            await prisma.serpGapAnalysis.update({
                where: { id: analysisId },
                data: {
                    status: "COMPLETED",
                    implementationPlan: plan as object,
                    estimatedPositionGain: plan.estimatedPositionGain,
                    executiveSummary: plan.executiveSummary,
                    topPriority: plan.topPriority,
                    taskCount: plan.tasks.length,
                    automatedTaskCount: plan.tasks.filter((t) => t.ariaCanAutomate).length,
                    completedAt: new Date(),
                },
            });

            logger.info("[SerpGap] Analysis completed", {
                keyword,
                analysisId,
                gapCount: gapReport.gaps.length,
                taskCount: plan.tasks.length,
            });
        });

        // ── Step 5: Fire completion event for real-time UI ────────────────────────
        await step.sendEvent("notify-gap-complete", {
            name: "serp-gap/completed",
            data: { siteId, userId, analysisId, keyword },
        });

        return {
            analysisId,
            keyword,
            gapCount: gapReport.gaps.length,
            taskCount: plan.tasks.length,
            automatedTasks: plan.tasks.filter((t) => t.ariaCanAutomate).length,
        };

        } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error("[SerpGap] Job failed with error", { analysisId, keyword, errorMsg });
            await prisma.serpGapAnalysis.update({
                where: { id: analysisId },
                data: { status: "FAILED", errorMessage: `Job error: ${errorMsg}` },
            }).catch(() => {});
            throw error;
        }
    }
);