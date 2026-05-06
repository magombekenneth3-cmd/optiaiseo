"use server";

import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit/check";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireTiers, getEffectiveTier, guardErrorToResult } from "@/lib/stripe/guards";
import { consumeCredits } from "@/lib/credits";
import { redis } from "@/lib/redis";
import { inngest } from "@/lib/inngest/client";
import { checkAeoLimit } from "@/lib/rate-limit";
import { extractBrandIdentity, isBrandCited } from "@/lib/aeo/brand-utils";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// Prisma uses cuid() for all PKs — validate as a non-empty string ≤ 50 chars
const uuidSchema = z.string().min(1).max(50);
const querySchema = z.string().min(1).max(500);

// ---------------------------------------------------------------------------
// Return types — discriminated unions so callers get proper type narrowing
// ---------------------------------------------------------------------------

type ActionError = { success: false; error: string; code?: string };

type RunAeoReportResult =
    | { success: true; reportId: string; status: "Queued" }
    | ActionError;

type AeoReportStatusResult =
    | { done: false }
    | {
        done: true;
        failed?: boolean;
        report: {
            score: number;
            grade: string;
            citationScore: number;
            generativeShareOfVoice: number;
            checks: Prisma.JsonValue;
            topRecommendations: string[];
            createdAt: Date;
        };
    };

type AeoHistoryResult =
    | { success: true; reports: AeoReport[]; domain: string; githubRepoUrl: string }
    | { success: false; reports: [] };

type AeoConversionMetricsResult =
    | {
        success: true;
        metrics: {
            totalConversions: number;
            totalRevenue: number;
            byIntent: Record<string, number>;
            topBlogs: TopBlog[];
            recentEvents: AeoEventWithBlog[];
        };
    }
    | { success: false; metrics: null };

type TestAeoQueryResult =
    | { success: true; cited: boolean; responseText: string; shareToken: string; shareUrl: string }
    | { success: false; cited: false; responseText: ""; error: string };

// ---------------------------------------------------------------------------
// Local types inferred from Prisma to avoid repeated `any` casts
// ---------------------------------------------------------------------------

type AeoReport = Prisma.AeoReportGetPayload<Record<string, never>>;

type AeoEventWithBlog = Prisma.AeoEventGetPayload<{
    include: { blog: { select: { title: true } } };
}>;

type TopBlog = {
    id: string;
    title: string;
    conversions: number;
    revenue: number;
};

// ---------------------------------------------------------------------------
// Shared auth helper — replaces the duplicated session+user lookup in every action
// ---------------------------------------------------------------------------

async function getAuthenticatedUser() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return null;
    return prisma.user.findUnique({ where: { email: session.user.email } });
}

// ---------------------------------------------------------------------------
// runAeoReport
// ---------------------------------------------------------------------------

export async function runAeoReport(siteId: string): Promise<RunAeoReportResult> {
    const traceId = crypto.randomUUID();

    try {
        // --- Input validation ---
        if (!uuidSchema.safeParse(siteId).success) {
            return { success: false, error: "Invalid site ID." };
        }

        // --- Auth ---
        const user = await getAuthenticatedUser();
        if (!user) return { success: false, error: "Unauthorized" };

        if (user.role !== "AGENCY_ADMIN") {
        try {
            await requireTiers(user.id, ["PRO", "AGENCY"]);
        } catch (err) {
            return guardErrorToResult(err);
        }
    }

        // --- Rate limiting ---
        const burstLimited = await rateLimit("aeoCheck", user.id);
        if (burstLimited) {
            const body = await burstLimited.json();
            return { success: false, error: body.error ?? "Too many requests. Please wait a moment." };
        }

        const effectiveTier = await getEffectiveTier(user.id);
        const limitRes = await checkAeoLimit(user.id, effectiveTier);
        if (!limitRes.allowed) {
            return {
                success: false,
                error: `AEO Audit limit reached for this period. Limits reset at ${limitRes.resetAt.toLocaleDateString()}.`,
            };
        }

        // --- Site ownership check ---
        const site = await prisma.site.findUnique({
            where: { id: siteId, userId: user.id },
        });
        if (!site) return { success: false, error: "Site not found" };

        // --- Idempotency: reuse an existing pending report ---
        const existingPending = await prisma.aeoReport.findFirst({
            where: { siteId: site.id, status: "PENDING" },
            orderBy: { createdAt: "desc" },
        });
        if (existingPending) {
            return { success: true, reportId: existingPending.id, status: "Queued" };
        }

        // --- Distributed lock (300s TTL — audit takes up to 3 min) ---
        const lockKey = `aeo-audit-lock:${user.id}:${site.id}`;
        const acquired = await redis.set(lockKey, "1", { ex: 300, nx: true });
        if (!acquired) {
            return {
                success: false,
                error: "An AEO audit is already queuing or running for this site.",
            };
        }

        logger.info("[AEO] starting audit", { traceId, siteId: site.id, userId: user.id });

        try {
            // --- Create the pending report row ---
            const report = await prisma.aeoReport.create({
                data: {
                    siteId: site.id,
                    status: "PENDING",
                    score: 0,
                    grade: "Pending",
                    citationScore: 0,
                    generativeShareOfVoice: 0,
                    citationLikelihood: 0,
                    schemaTypes: [],
                    checks: {
                        status:
                            "A deep audit is currently running in the background. This usually takes 1-2 minutes.",
                    } as object,
                    topRecommendations: ["Audit in progress..."],
                },
            });

            // --- Deduct credits before dispatch ---
            // If Inngest dispatch fails we refund below.
            // If the job itself fails after retries, the Inngest failure handler must refund.
            const creditResult = await consumeCredits(user.id, "aeo_check");
            if (!creditResult.allowed) {
                // Clean up the pending report we just created
                await prisma.aeoReport.delete({ where: { id: report.id } }).catch(() => { });
                await redis.del(lockKey).catch(() => { });
                return {
                    success: false,
                    error: `Insufficient credits. You need 5 credits for an AEO audit. You have ${creditResult.remaining}.`,
                    code: "insufficient_credits",
                };
            }

            // --- Dispatch background job ---
            try {
                await inngest.send({
                    name: "aeo.audit.run",
                    data: { siteId: site.id, reportId: report.id, userId: user.id, traceId },
                });

                // Lock TTL cleans itself up after 300s — do NOT release here.
                return { success: true, reportId: report.id, status: "Queued" };
            } catch (inngestErr: unknown) {
                logger.warn("[AEO] Inngest unavailable — refunding credits", {
                    traceId,
                    error: (inngestErr as Error)?.message,
                });

                // Refund credits: job never started
                await prisma.user
                    .update({
                        where: { id: user.id },
                        data: { credits: { increment: creditResult.cost } },
                    })
                    .catch(() => { });

                await prisma.aeoReport
                    .update({
                        where: { id: report.id },
                        data: {
                            status: "FAILED",
                            grade: "F",
                            topRecommendations: [
                                "Background job unavailable — please retry in a moment.",
                            ],
                        },
                    })
                    .catch(() => { });

                await redis.del(lockKey).catch(() => { });

                return {
                    success: false,
                    error: "Background job service unavailable. Please try again in a moment.",
                };
            }
        } catch (innerErr: unknown) {
            await redis.del(lockKey).catch(() => { });
            throw innerErr;
        }
    } catch (error: unknown) {
        logger.error("[AEO] runAeoReport error", {
            traceId,
            error: (error as Error)?.message || String(error),
        });
        return { success: false, error: "Failed to run AEO audit." };
    }
}

// ---------------------------------------------------------------------------
// getAeoReportStatus
// ---------------------------------------------------------------------------

export async function getAeoReportStatus(
    reportId: string
): Promise<AeoReportStatusResult> {
    try {
        if (!uuidSchema.safeParse(reportId).success) return { done: false };

        const user = await getAuthenticatedUser();
        if (!user) return { done: false };

        const report = await prisma.aeoReport.findFirst({
            where: { id: reportId, site: { userId: user.id } },
            select: {
                score: true,
                grade: true,
                status: true,
                citationScore: true,
                generativeShareOfVoice: true,
                checks: true,
                topRecommendations: true,
                createdAt: true,
            },
        });

        if (!report) return { done: false };

        // Use the dedicated status field — not grade overloading
        if (report.status === "FAILED") {
            return {
                done: true,
                failed: true,
                report: {
                    ...report,
                    topRecommendations: report.topRecommendations?.length
                        ? report.topRecommendations
                        : ["Deep audit failed — please try again in a few minutes."],
                },
            };
        }

        if (report.status === "PENDING") return { done: false };

        return { done: true, report };
    } catch (error: unknown) {
        logger.error("[AEO] getAeoReportStatus error", {
            error: (error as Error)?.message || String(error),
        });
        return { done: false };
    }
}

// ---------------------------------------------------------------------------
// getAeoHistory
// ---------------------------------------------------------------------------

export async function getAeoHistory(siteId: string): Promise<AeoHistoryResult> {
    try {
        if (!uuidSchema.safeParse(siteId).success) {
            return { success: false, reports: [] };
        }

        const user = await getAuthenticatedUser();
        if (!user) return { success: false, reports: [] };

        const site = await prisma.site.findFirst({
            where: { id: siteId, userId: user.id },
        });
        if (!site) return { success: false, reports: [] };

        const reports = await prisma.aeoReport.findMany({
            where: { siteId: site.id },
            orderBy: { createdAt: "desc" },
            take: 10,
        });

        return {
            success: true,
            reports,
            domain: site.domain,
            githubRepoUrl: site.githubRepoUrl ?? "",
        };
    } catch (error: unknown) {
        logger.error("[AEO] getAeoHistory error", {
            error: (error as Error)?.message || String(error),
        });
        return { success: false, reports: [] };
    }
}

// ---------------------------------------------------------------------------
// getAeoConversionMetrics
// ---------------------------------------------------------------------------

export async function getAeoConversionMetrics(
    siteId: string
): Promise<AeoConversionMetricsResult> {
    try {
        if (!uuidSchema.safeParse(siteId).success) {
            return { success: false, metrics: null };
        }

        const user = await getAuthenticatedUser();
        if (!user) return { success: false, metrics: null };

        const site = await prisma.site.findFirst({
            where: { id: siteId, userId: user.id },
        });
        if (!site) return { success: false, metrics: null };

        // Push aggregations to the DB instead of loading 500 rows into JS memory
        const [totalConversions, revenueAgg, byIntentRaw, topBlogsRaw, recentEvents] =
            await Promise.all([
                prisma.aeoEvent.count({ where: { siteId: site.id } }),

                prisma.aeoEvent.aggregate({
                    where: { siteId: site.id },
                    _sum: { revenue: true },
                }),

                prisma.aeoEvent.groupBy({
                    by: ["intent"],
                    where: { siteId: site.id },
                    _count: { intent: true },
                }),

                prisma.aeoEvent.groupBy({
                    by: ["blogId"],
                    where: { siteId: site.id, blogId: { not: null } },
                    _count: { blogId: true },
                    _sum: { revenue: true },
                    orderBy: { _sum: { revenue: "desc" } },
                    take: 5,
                }),

                prisma.aeoEvent.findMany({
                    where: { siteId: site.id },
                    include: { blog: { select: { title: true } } },
                    orderBy: { createdAt: "desc" },
                    take: 10,
                }),
            ]);

        const totalRevenue = revenueAgg._sum.revenue ?? 0;

        const byIntent = byIntentRaw.reduce<Record<string, number>>((acc, row) => {
            acc[row.intent ?? "unknown"] = row._count.intent;
            return acc;
        }, {});

        // Resolve blog titles for the top-5 grouped rows
        const blogIds = topBlogsRaw
            .map((r) => r.blogId)
            .filter((id): id is string => id !== null);

        const blogs = await prisma.blog.findMany({
            where: { id: { in: blogIds } },
            select: { id: true, title: true },
        });

        const blogTitleMap = new Map(blogs.map((b) => [b.id, b.title]));

        const topBlogs: TopBlog[] = topBlogsRaw.map((r) => ({
            id: r.blogId as string,
            title: blogTitleMap.get(r.blogId as string) ?? "Deleted Blog",
            conversions: r._count.blogId,
            revenue: r._sum.revenue ?? 0,
        }));

        return {
            success: true,
            metrics: {
                totalConversions,
                totalRevenue,
                byIntent,
                topBlogs,
                recentEvents,
            },
        };
    } catch (error: unknown) {
        logger.error("[AEO] getAeoConversionMetrics error", {
            error: (error as Error)?.message || String(error),
        });
        return { success: false, metrics: null };
    }
}

// ---------------------------------------------------------------------------
// testAeoQuery
// ---------------------------------------------------------------------------

export async function testAeoQuery(
    siteId: string,
    query: string
): Promise<TestAeoQueryResult> {
    const fail = (error: string): TestAeoQueryResult => ({
        success: false,
        cited: false,
        responseText: "",
        error,
    });

    try {
        // --- Input validation ---
        if (!uuidSchema.safeParse(siteId).success) return fail("Invalid site ID.");
        if (!querySchema.safeParse(query).success) return fail("Query must be 1–500 characters.");

        const user = await getAuthenticatedUser();
        if (!user) return fail("Unauthorized");

        const site = await prisma.site.findFirst({
            where: { id: siteId, userId: user.id },
        });
        if (!site) return fail("Site not found");

        // --- Rate limit: 10 test queries per user per hour (atomic pipeline) ---
        const rateLimitKey = `aeo-test-query:${user.id}`;
        const pipeline = redis.pipeline();
        pipeline.incr(rateLimitKey);
        pipeline.expire(rateLimitKey, 3600);
        const [[, count]] = (await pipeline.exec()) as [[null, number], unknown];
        if (count > 10) return fail("Rate limit: 10 test queries per hour");

        // --- Query Gemini ---
        const { callGemini } = await import("@/lib/gemini");
        const prompt = [
            query,
            "",
            "Answer this question helpfully and specifically.",
            "If any tools, platforms, websites, or services are relevant to the answer,",
            "name them explicitly by their brand name or website.",
        ].join("\n");

        const responseText = await callGemini(prompt, {
            maxOutputTokens: 1024,
            temperature: 0.4,
            timeoutMs: 12000,
        });

        // Robust domain citation check: handles www, trailing slash, subdomains
        const rawDomain = site.domain
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "")
            .replace(/\/$/, "");

        const brandIdentity = extractBrandIdentity(site.domain);
        const cited = isBrandCited(responseText, brandIdentity);

        const siteUrl = (process.env.NEXTAUTH_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");
        const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
        const proof = await prisma.aeoProof.create({
            data: { siteId: site.id, query, responseText, cited, expiresAt },
        });

        return {
            success: true,
            cited,
            responseText,
            shareToken: proof.shareToken,
            shareUrl: `${siteUrl}/proof/${proof.shareToken}`,
        };
    } catch (error: unknown) {
        logger.error("[AEO] testAeoQuery error", {
            error: (error as Error)?.message || String(error),
        });
        return fail("Failed to test query");
    }
}