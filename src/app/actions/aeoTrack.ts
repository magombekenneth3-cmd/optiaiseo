"use server";

import { logger } from "@/lib/logger";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkPerplexityCitation } from "@/lib/aeo/perplexity-citation-check";
import { checkChatGptMention } from "@/lib/aeo/openai-check";
import { checkClaudeMention } from "@/lib/aeo/claude-check";
import pLimit from "p-limit";
import { z } from "zod";


const MAX_KEYWORDS = 10;

const CHECK_CONCURRENCY = 2;

const FREQUENCY_HOURS: Record<"high" | "medium" | "low", number> = {
    high: 24,
    medium: 72,
    low: 168,
};

const uuidSchema = z.string().min(1).max(50);

type ActionError = { success: false; error: string };

type RunAeoShareOfVoiceResult =
    | { success: true; message: string; trackedCount: number }
    | ActionError;

type DailyChartPoint = {
    date: string;
    score: number;
    totalQueries: number;
    brandMentions: number;
};

type KeywordBreakdownEntry = {
    keyword: string;
    mentionRate: number;
    totalQueries: number;
    topCompetitors: { name: string; count: number }[];
};

type GetAeoShareOfVoiceMetricsResult =
    | {
        success: true;
        chartData: DailyChartPoint[];
        keywordBreakdown: KeywordBreakdownEntry[];
    }
    | ActionError;

async function getAuthenticatedUserId(): Promise<string | null> {
    const session = await getServerSession(authOptions);
    return session?.user?.id ?? null;
}

function frequencyHours(priority: number | null): number {
    if (!priority || priority >= 0.7) return FREQUENCY_HOURS.high;
    if (priority >= 0.4) return FREQUENCY_HOURS.medium;
    return FREQUENCY_HOURS.low;
}

async function isWithinCooldown(
    siteId: string,
    keyword: string,
    priority: number | null,
): Promise<boolean> {
    const hours = frequencyHours(priority);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const existing = await prisma.aiShareOfVoice.findFirst({
        where: { siteId, keyword, recordedAt: { gte: cutoff } },
        select: { id: true },
    });
    return existing !== null;
}

/**
 * Run one keyword against all configured AI models in parallel.
 * Returns one row per model — each written to AiShareOfVoice with the
 * correct modelName so charts and filters reflect real data sources.
 */
async function runMultiModelCheck(
    keyword: string,
    domain: string,
    coreServices: string | null | undefined,
): Promise<{ modelName: string; brandMentioned: boolean; competitors: string[] }[]> {
    const [plx, gpt, cld] = await Promise.allSettled([
        checkPerplexityCitation(keyword, domain),
        checkChatGptMention(domain, coreServices),
        checkClaudeMention(domain, coreServices),
    ]);

    const rows: { modelName: string; brandMentioned: boolean; competitors: string[] }[] = [];

    if (plx.status === "fulfilled") {
        const r = plx.value;
        rows.push({
            modelName: "perplexity",
            brandMentioned: r.cited || r.textMentionScore > 30,
            competitors: r.competitorsCited,
        });
    }
    if (gpt.status === "fulfilled") {
        const r = gpt.value;
        rows.push({
            modelName: "chatgpt",
            brandMentioned: r.mentioned,
            competitors: [],
        });
    }
    if (cld.status === "fulfilled") {
        const r = cld.value;
        rows.push({
            modelName: "claude",
            brandMentioned: r.mentioned,
            competitors: [],
        });
    }

    return rows;
}

export async function runAeoShareOfVoiceCheck(
    siteId: string,
): Promise<RunAeoShareOfVoiceResult> {
    if (!uuidSchema.safeParse(siteId).success) {
        return { success: false, error: "Invalid site ID." };
    }

    const enabledModels = [
        process.env.PERPLEXITY_API_KEY && "Perplexity",
        process.env.OPENAI_API_KEY     && "ChatGPT",
        process.env.ANTHROPIC_API_KEY  && "Claude",
    ].filter(Boolean);

    if (enabledModels.length === 0) {
        return {
            success: false,
            error: "No AI model API keys configured. Add PERPLEXITY_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY to enable real-model tracking.",
        };
    }

    try {
        const userId = await getAuthenticatedUserId();
        if (!userId) return { success: false, error: "Unauthorized" };

        const site = await prisma.site.findFirst({
            where: { id: siteId, userId },
            select: { id: true, domain: true, coreServices: true },
        });
        if (!site) return { success: false, error: "Site not found" };

        let seedKeywords = await prisma.seedKeyword.findMany({
            where: { siteId: site.id },
            orderBy: { addedAt: "desc" },
            take: MAX_KEYWORDS,
        });

        if (seedKeywords.length === 0) {
            const { discoverKeywordsWithAI, addSeedKeyword } = await import(
                "@/app/actions/keywordDiscovery"
            );
            const discoveryResult = await discoverKeywordsWithAI(site.id);
            if (!discoveryResult.success) {
                return {
                    success: false,
                    error: "No seed keywords found and auto-discovery failed: " + discoveryResult.error,
                };
            }

            const candidates = (
                discoveryResult.keywords as Array<{ keyword: string; intent: string; priority?: number }>
            )
                .filter((k) => ["commercial", "transactional", "informational"].includes(k.intent))
                .slice(0, 5);

            for (const kw of candidates) {
                await addSeedKeyword(site.id, kw.keyword, kw.intent, 1, "Auto-generated for AEO tracking");
            }

            seedKeywords = await prisma.seedKeyword.findMany({
                where: { siteId: site.id },
                orderBy: { addedAt: "desc" },
                take: MAX_KEYWORDS,
            });

            if (seedKeywords.length === 0) {
                return { success: false, error: "Failed to load auto-generated seed keywords." };
            }
        }

        const cooldownChecks = await Promise.all(
            seedKeywords.map(async (sk) => ({
                sk,
                skip: await isWithinCooldown(site.id, sk.keyword, null),
            })),
        );
        const due = cooldownChecks.filter((c) => !c.skip).map((c) => c.sk);

        if (due.length === 0) {
            return {
                success: true,
                trackedCount: 0,
                message: "All keywords are within their tracking cooldown. Nothing to run.",
            };
        }

        const limit = pLimit(CHECK_CONCURRENCY);
        let trackedCount = 0;

        await Promise.allSettled(
            due.map((sk) =>
                limit(async () => {
                    let modelRows: { modelName: string; brandMentioned: boolean; competitors: string[] }[];
                    try {
                        modelRows = await runMultiModelCheck(sk.keyword, site.domain, site.coreServices);
                    } catch (err: unknown) {
                        logger.error("[AEO Track] Multi-model check failed", {
                            keyword: sk.keyword,
                            error: (err as Error)?.message,
                        });
                        return;
                    }

                    await Promise.allSettled(
                        modelRows.map(async (row) => {
                            try {
                                await prisma.aiShareOfVoice.create({
                                    data: {
                                        siteId: site.id,
                                        keyword: sk.keyword,
                                        modelName: row.modelName,
                                        brandMentioned: row.brandMentioned,
                                        competitorsMentioned: row.competitors,
                                    },
                                });
                                trackedCount++;
                            } catch (err: unknown) {
                                logger.error("[AEO Track] DB write failed", {
                                    keyword: sk.keyword,
                                    modelName: row.modelName,
                                    error: (err as Error)?.message,
                                });
                            }
                        }),
                    );
                }),
            ),
        );

        return {
            success: true,
            trackedCount,
            message: `Completed tracking run: ${trackedCount} data point${trackedCount !== 1 ? "s" : ""} recorded across ${enabledModels.join(", ")}.`,
        };
    } catch (error: unknown) {
        logger.error("[AEO Track] Action failed", {
            error: (error as Error)?.message ?? String(error),
        });
        return { success: false, error: "Failed to run AEO Share of Voice check." };
    }
}

export async function getAeoShareOfVoiceMetrics(
    siteId: string,
): Promise<GetAeoShareOfVoiceMetricsResult> {
    if (!uuidSchema.safeParse(siteId).success) {
        return { success: false, error: "Invalid site ID." };
    }

    try {
        const userId = await getAuthenticatedUserId();
        if (!userId) return { success: false, error: "Unauthorized" };

        const site = await prisma.site.findFirst({
            where: { id: siteId, userId },
            select: { id: true },
        });
        if (!site) return { success: false, error: "Site not found" };

        const records = await prisma.aiShareOfVoice.findMany({
            where: { siteId: site.id },
            orderBy: { recordedAt: "desc" },
            take: 100,
            select: {
                keyword: true,
                brandMentioned: true,
                competitorsMentioned: true,
                recordedAt: true,
            },
        });

        const dailyMap = new Map<
            string,
            { totalQueries: number; brandMentions: number }
        >();

        for (const row of records) {
            const date = row.recordedAt.toISOString().split("T")[0];
            const existing = dailyMap.get(date) ?? { totalQueries: 0, brandMentions: 0 };
            existing.totalQueries++;
            if (row.brandMentioned) existing.brandMentions++;
            dailyMap.set(date, existing);
        }

        const chartData: DailyChartPoint[] = [...dailyMap.entries()]
            .map(([date, data]) => ({
                date,
                score: Math.round((data.brandMentions / data.totalQueries) * 100),
                ...data,
            }))
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const kwMap = new Map<
            string,
            {
                totalQueries: number;
                brandMentions: number;
                competitors: Map<string, number>;
            }
        >();

        for (const row of records) {
            const kw = row.keyword;
            if (!kwMap.has(kw)) {
                kwMap.set(kw, {
                    totalQueries: 0,
                    brandMentions: 0,
                    competitors: new Map(),
                });
            }
            const entry = kwMap.get(kw)!;
            entry.totalQueries++;
            if (row.brandMentioned) entry.brandMentions++;

            for (const comp of row.competitorsMentioned as string[]) {
                entry.competitors.set(comp, (entry.competitors.get(comp) ?? 0) + 1);
            }
        }

        const keywordBreakdown: KeywordBreakdownEntry[] = [...kwMap.entries()]
            .map(([keyword, data]) => ({
                keyword,
                mentionRate: Math.round((data.brandMentions / data.totalQueries) * 100),
                totalQueries: data.totalQueries,
                topCompetitors: [...data.competitors.entries()]
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 3)
                    .map(([name, count]) => ({ name, count })),
            }))
            .sort((a, b) => a.mentionRate - b.mentionRate); // worst first = highest priority

        return { success: true, chartData, keywordBreakdown };
    } catch (error: unknown) {
        logger.error("[AEO Metrics] Failed", {
            error: (error as Error)?.message ?? String(error),
        });
        return { success: false, error: "Failed to load metrics." };
    }
}