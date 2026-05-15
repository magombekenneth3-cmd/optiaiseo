import { logger } from "@/lib/logger";
import { inngest } from "../client";
import { NonRetriableError } from "inngest";
import { prisma } from "@/lib/prisma";
import { checkAeoLimit } from "@/lib/rate-limit";
import { runAeoAudit, runAeoAuditLite } from "@/lib/aeo";
import { CREDIT_COSTS } from "@/lib/credits";
import { CONCURRENCY } from "../concurrency";


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

            logger.error(`[Inngest/AEO-Audit] Failed for report ${reportId}:`, { error: error?.message || error });

            if (!reportId) {
                logger.error("[Inngest/AEO-Audit] Could not resolve reportId from onFailure event — manual DB check required");
                return;
            }

            await prisma.aeoReport.updateMany({ where: { id: reportId }, data: { grade: "F", status: "FAILED" } });

            // Refund the 5 credits that were deducted pre-dispatch
            if (userId) {
                const refundAmount = CREDIT_COSTS.aeo_check;
                await prisma.user.update({
                    where: { id: userId },
                    data: { credits: { increment: refundAmount } },
                }).catch((e: unknown) => logger.error("[Inngest/AEO-Audit] Credit refund failed", { userId, error: (e as Error).message }));
                logger.info(`[Inngest/AEO-Audit] Refunded ${refundAmount} credits to user ${userId}`);
            } else {
                logger.warn("[Inngest/AEO-Audit] userId missing from failure event — cannot refund credits");
            }
        },
    
        triggers: [{ event: "aeo.audit.run" }],
    },
    async ({ event, step }) => {
        if (!process.env.GEMINI_API_KEY) throw new NonRetriableError("Missing GEMINI_API_KEY - dropping job to save retries");
        const { siteId, reportId } = event.data;

        const site = await step.run("fetch-site", async () => {
            const s = await prisma.site.findUnique({
                where: { id: siteId },
                include: { user: { select: { id: true, subscriptionTier: true } } }
            });
            if (!s) throw new Error("Site not found");
            return s;
        });

        const allowed = await step.run("check-rate-limit", async () => {
            const result = await checkAeoLimit(site.user.id, site.user?.subscriptionTier ?? "FREE");
            if (!result.allowed) {
                await prisma.aeoReport.updateMany({ where: { id: reportId }, data: { status: "FAILED" } });
                return false;
            }
            return true;
        });
        if (!allowed) return { skipped: true, reason: "rate_limit" };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await step.run("run-audit", async () => await runAeoAudit(site.domain, site.coreServices, false, site.brandName ?? null)) as any;

        await step.run("save-report", async () => {
            await prisma.aeoReport.update({
                where: { id: reportId },
                data: {
                    status: "COMPLETED",
                    score: result.score,
                    grade: result.grade,
                    citationScore: result.citationScore,
                    generativeShareOfVoice: result.generativeShareOfVoice,
                    citationLikelihood: result.citationLikelihood,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    multiEngineScore: result.multiEngineScore as any,
                    schemaTypes: result.schemaTypes,
                    checks: result.checks as unknown as object,
                    topRecommendations: result.topRecommendations,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    multiModelResults: result.modelCitationResults as any,
                    layerScores: result.layerScores as object ?? null,
                    diagnosis: result.diagnosis as object ?? null,
                },
            });
        });

        // 2.2: Sync entity Knowledge Graph — extract entities into BrandFact table
        await step.run("sync-entity-kg", async () => {
            const { syncEntityKnowledgeGraph } = await import("@/lib/aeo/entity-kg-sync");
            await syncEntityKnowledgeGraph(siteId, site.domain, result);
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
        concurrency: { limit: 1 }, // cron orchestrator — one run at a time
    
        triggers: [{ cron: "0 8 * * 1" }],
    },
    async ({ step }) => {
        const sites = await step.run("fetch-sites", async () => {
            return prisma.site.findMany({
                select: { id: true, domain: true, userId: true },
                where: { user: { subscriptionTier: { in: ["PRO", "AGENCY"] } } },
            });
        });

        await step.sendEvent(
            "fan-out-aeo-tracker",
            sites.map((site) => ({
                name: "aeo.tracker.check.site" as const,
                data: { siteId: site.id, domain: site.domain, userId: site.userId },
            }))
        );

        return { processed: sites.length };
    }
);

export const processAeoSiteJob = inngest.createFunction(
    { id: "process-aeo-tracker-site", name: "Process Weekly AEO Site", concurrency: { limit: 5 }, retries: 2, idempotency: "event.data.siteId",
        triggers: [{ event: "aeo.tracker.check.site" }],
    },
    async ({ event, step }) => {
        const { siteId, domain } = event.data as { siteId: string; domain: string; userId: string };

        const previous = await step.run("fetch-previous-report", async () => {
            return prisma.aeoReport.findFirst({
                where: { siteId },
                orderBy: { createdAt: "desc" },
                select: { score: true, createdAt: true },
            });
        });

        const result = await step.run("run-aeo-audit-lite", async () => {
            return runAeoAuditLite(domain);
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
                },
                select: { id: true },
            });
        });

        await step.run("sync-entity-kg", async () => {
            const { syncEntityKnowledgeGraph } = await import("@/lib/aeo/entity-kg-sync");
            await syncEntityKnowledgeGraph(siteId, domain, result);
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