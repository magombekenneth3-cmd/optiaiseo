import { logger } from "@/lib/logger";
import { inngest } from "../client";
import { NonRetriableError } from "inngest";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
// Monthly AEO count limit removed — credits are the single gate.
import { runAeoAudit, runAeoAuditLite } from "@/lib/aeo";
import { CREDIT_COSTS, refundCreditsIdempotent } from "@/lib/credits";
import { CONCURRENCY } from "../concurrency";
import { fireWhiteLabelWebhook } from "@/lib/webhooks/white-label";
import { redis } from "@/lib/redis";
import { writeMetricSnapshot } from "@/lib/metrics/metric-snapshot";
import { detectGsovDrop, generateHealingPlan, executeHealing } from "@/lib/self-healing/engine";


export const runAeoAuditJob = inngest.createFunction(
    {
        id: "run-aeo-audit",
        name: "Run Deep AEO Audit",
        concurrency: { limit: CONCURRENCY.aeo, key: "global-aeo-audit" },
        idempotency: "event.data.reportId",
        throttle: {
            limit: 30,
            period: "1m",
            key: "global-aeo",
        },
        onFailure: async ({ event, error }) => {
            const data = (event.data?.event?.data ?? {}) as Record<string, unknown>;
            const reportId = data.reportId as string | undefined;
            const userId = data.userId as string | undefined;
            const siteId = data.siteId as string | undefined;
            const autopilot = Boolean(data.autopilot);

            logger.error(`[Inngest/AEO-Audit] Failed for report ${reportId}:`, { error: error?.message || error });

            if (userId && siteId) {
                await redis.del(`aeo-audit-lock:${userId}:${siteId}`).catch(() => { });
            }

            if (reportId) {
                await prisma.aeoReport.updateMany({ where: { id: reportId }, data: { grade: "F", status: "FAILED" } });
            }

            if (userId && !autopilot && reportId) {
                const refundAmount = CREDIT_COSTS.aeo_check;
                await refundCreditsIdempotent(
                    userId,
                    refundAmount,
                    `refund:aeo:${reportId}`,
                    "AEO audit background job failed",
                ).catch((e: unknown) => logger.error("[Inngest/AEO-Audit] Credit refund failed", { userId, error: (e as Error).message }));
            }
        },
    
        triggers: [{ event: "aeo.audit.run" }],
    },
    async ({ event, step }) => {
        if (!process.env.GEMINI_API_KEY) throw new NonRetriableError("Missing GEMINI_API_KEY - dropping job to save retries");
        const { siteId, reportId } = event.data as { siteId: string; reportId?: string; userId?: string; autopilot?: boolean };

        const site = await step.run("fetch-site", async () => {
            const s = await prisma.site.findUnique({
                where: { id: siteId },
                include: { user: { select: { id: true, subscriptionTier: true } } }
            });
            if (!s) throw new Error("Site not found");
            return s;
        });

        const result = await step.run(
            "run-audit",
            async () => await runAeoAudit(site.domain, site.coreServices, false, site.brandName ?? null, reportId, siteId),
        ) as any;

        const savedReportId = await step.run("save-report", async () => {
            const reportPayload = {
                status: "COMPLETED" as const,
                score: result.score,
                grade: result.grade,
                citationScore: result.citationScore,
                generativeShareOfVoice: result.generativeShareOfVoice,
                citationLikelihood: result.citationLikelihood,
                multiEngineScore: result.multiEngineScore as any,
                schemaTypes: result.schemaTypes,
                checks: result.checks as unknown as object,
                topRecommendations: result.topRecommendations,
                multiModelResults: result.modelCitationResults as any,
                layerScores: result.layerScores as object ?? null,
                diagnosis: result.diagnosis as object ?? null,
                dimensions: result.dimensions ? (result.dimensions as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
                auditConfidence: result.auditConfidence ? (result.auditConfidence as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
            };

            if (reportId) {
                await prisma.aeoReport.update({
                    where: { id: reportId },
                    data: reportPayload,
                });
                return reportId;
            }

            const created = await prisma.aeoReport.create({
                data: {
                    siteId,
                    ...reportPayload,
                },
                select: { id: true },
            });
            return created.id;
        });

        await step.run("release-lock-and-snapshot", async () => {
            await redis.del(`aeo-audit-lock:${site.user.id}:${siteId}`).catch(() => { });
            await writeMetricSnapshot({
                siteId,
                aeoScore: result.score,
            });
        });

        await step.run("sync-entity-kg", async () => {
            const { syncEntityKnowledgeGraph } = await import("@/lib/aeo/entity-kg-sync");
            await syncEntityKnowledgeGraph(siteId, site.domain, result);
        });

        await step.run("refresh-visibility-forecast", async () => {
            const { generateVisibilityForecast } = await import("@/lib/aeo/visibility-forecast");
            const forecast = await generateVisibilityForecast(siteId);
            await redis.set(`forecast:${siteId}`, JSON.stringify(forecast), { ex: 60 * 60 * 24 * 7 });
        });

        await step.run("evaluate-self-healing", async () => {
            const dropInfo = await detectGsovDrop(siteId);
            if (dropInfo.dropped) {
                const actions = await generateHealingPlan(siteId, dropInfo.currentGsov, dropInfo.prevGsov);
                if (actions.length > 0) {
                    await executeHealing(siteId, actions);
                }
            }
        });

        await step.run("fire-aeo-webhook", async () => {
            await fireWhiteLabelWebhook(site.user.id, {
                event: "aeo.completed",
                siteId,
                domain: site.domain,
                timestamp: new Date().toISOString(),
                data: { reportId: savedReportId, score: result.score, grade: result.grade },
            });
        });

        return { success: true };
    }
);


export const runAeoRankJob = inngest.createFunction(
    {
        id: "run-aeo-rank",
        name: "Run AEO Topic Authority Check",
        concurrency: { limit: CONCURRENCY.aeo, key: "global-aeo-rank" },
        onFailure: async ({ event, error }) => {
            const reportId: string | undefined = ((event.data?.event?.data ?? {}) as Record<string, unknown>).reportId as string | undefined;
            logger.error(`[Inngest/AEO-Rank] Failed for report ${reportId}:`, { error: error?.message || error });
            if (!reportId) {
                logger.error("[Inngest/AEO-Rank] Could not resolve reportId from onFailure event — manual DB check required");
                return;
            }
            await prisma.aeoReport.updateMany({ where: { id: reportId }, data: { status: "FAILED" } });
        },
    
        triggers: [{ event: "aeo.rank.run" }],
    },
    async ({ event, step }) => {
        if (!process.env.GEMINI_API_KEY) throw new NonRetriableError("Missing GEMINI_API_KEY - dropping job to save retries");
        const { domain, keywords, reportId, brandName } = event.data;

        const result = await step.run("run-llm-queries", async () => {
            const { executeLlmQueries } = await import("@/app/actions/llmMentions");
            return await executeLlmQueries(domain, keywords, true, brandName ?? null);
        });

        await step.run("save-rank-report", async () => {
            await prisma.aeoReport.update({
                where: { id: reportId },
                data: {
                    status: "COMPLETED",
                    score: result.mentionRate,
                    grade: result.grade,
                    citationScore: result.mentionRate,
                    topRecommendations: result.recommendations,
                    schemaTypes: [],
                    checks: result.checks as unknown as object,
                },
            });
        });

        return { success: true };
    }
);


export const weeklyAeoTracker = inngest.createFunction(
    {
        id: "weekly-aeo-tracker",
        name: "Weekly AEO Tracker",
        retries: 1,
        concurrency: { limit: 1 },
    
        triggers: [{ cron: "0 8 * * 1" }],
    },
    async ({ step }) => {
        const sites = await step.run("fetch-sites", async () => {
            return prisma.site.findMany({
                select: { id: true, domain: true, userId: true },
                where: { user: { subscriptionTier: { in: ["STARTER", "PRO", "AGENCY"] } } },
            });
        });

        const weekKey = new Date().toISOString().slice(0, 10);

        await step.sendEvent(
            "fan-out-aeo-tracker",
            sites.map((site) => ({
                name: "aeo.tracker.check.site" as const,
                data: { siteId: site.id, domain: site.domain, userId: site.userId, weekKey },
            }))
        );

        return { processed: sites.length };
    }
);

export const processAeoSiteJob = inngest.createFunction(
    {
        id: "process-aeo-tracker-site",
        name: "Process Weekly AEO Site",
        concurrency: { limit: 5 },
        retries: 2,
        idempotency: "event.data.siteId + '-' + (event.data.weekKey || '')",
        triggers: [{ event: "aeo.tracker.check.site" }],
    },
    async ({ event, step }) => {
        const { siteId, domain } = event.data as { siteId: string; domain: string; userId: string; weekKey?: string };

        const previous = await step.run("fetch-previous-report", async () => {
            return prisma.aeoReport.findFirst({
                where: { siteId, status: "COMPLETED" },
                orderBy: { createdAt: "desc" },
                select: { score: true, createdAt: true },
            });
        });

        const result = await step.run("run-aeo-audit-lite", async () => {
            return runAeoAuditLite(domain, undefined, undefined, siteId);
        });

        const report = await step.run("save-report", async () => {
            return prisma.aeoReport.create({
                data: {
                    siteId,
                    score: result.score,
                    grade: result.grade,
                    citationScore: result.citationScore,
                    generativeShareOfVoice: result.generativeShareOfVoice,
                    citationLikelihood: result.citationLikelihood,
                    schemaTypes: result.schemaTypes,
                    topRecommendations: result.topRecommendations,
                    checks: result.checks as object,
                    status: "COMPLETED",
                    layerScores: result.layerScores as object ?? null,
                    diagnosis: result.diagnosis as object ?? null,
                    dimensions: result.dimensions ? (result.dimensions as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
                    auditConfidence: result.auditConfidence ? (result.auditConfidence as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
                },
                select: { id: true },
            });
        });

        await step.run("write-metric-snapshot", async () => {
            await writeMetricSnapshot({
                siteId,
                aeoScore: result.score,
            });
        });

        await step.run("sync-entity-kg", async () => {
            const { syncEntityKnowledgeGraph } = await import("@/lib/aeo/entity-kg-sync");
            await syncEntityKnowledgeGraph(siteId, domain, result);
        });

        await step.run("refresh-visibility-forecast", async () => {
            const { generateVisibilityForecast } = await import("@/lib/aeo/visibility-forecast");
            const forecast = await generateVisibilityForecast(siteId);
            await redis.set(`forecast:${siteId}`, JSON.stringify(forecast), { ex: 60 * 60 * 24 * 7 });
        });

        await step.run("evaluate-self-healing", async () => {
            const dropInfo = await detectGsovDrop(siteId);
            if (dropInfo.dropped || (previous && result.score < previous.score - 5)) {
                const actions = await generateHealingPlan(
                    siteId,
                    dropInfo.currentGsov || result.generativeShareOfVoice,
                    dropInfo.prevGsov || previous?.score || 0,
                );
                if (actions.length > 0) {
                    await executeHealing(siteId, actions);
                }
            }
        });

        if (previous && result.score < previous.score - 5) {
            await step.sendEvent("send-score-drop-alert", {
                name: "aeo.score.dropped" as const,
                data: {
                    siteId,
                    userId: event.data.userId,
                    domain,
                    previousScore: previous.score,
                    currentScore: result.score,
                    reportId: report.id,
                },
            });
        }

        return { siteId, score: result.score };
    }
);


export const aeoScoreDropAlert = inngest.createFunction(
    {
        id: "aeo-score-drop-alert",
        name: "AEO Score Drop Alert",
        retries: 2,
        concurrency: { limit: CONCURRENCY.aeo, key: "global-aeo-drop-alert" },
    
        triggers: [{ event: "aeo.score.dropped" }],
    },
    async ({ event, step }) => {
        const { userId, domain, previousScore, currentScore } = event.data;

        const user = await step.run("fetch-user", async () => {
            return prisma.user.findUnique({
                where: { id: userId },
                select: { email: true, name: true },
            });
        });

        if (!user?.email) return;

        await step.run("send-alert-email", async () => {
            const { sendAeoDropAlert } = await import("@/lib/email/aeo-alert");
            await sendAeoDropAlert(user.email!, {
                domain,
                previousScore,
                currentScore,
                dropAmount: previousScore - currentScore,
            });
        });
    }
);