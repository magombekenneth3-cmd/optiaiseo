"use server";

import { logger } from "@/lib/logger";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { callGemini as _callGemini } from "@/lib/gemini";
import { extractBrandIdentity, isBrandCited } from "@/lib/aeo/brand-utils";
import pLimit from "p-limit";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max keywords to process per tracking run. */
const MAX_KEYWORDS = 10;

/** How many keywords to bundle into a single Gemini call. */
const BATCH_SIZE = 4;

/** Max concurrent Gemini calls. */
const GEMINI_CONCURRENCY = 2;

/**
 * Frequency thresholds (in hours) per keyword priority tier.
 * High-priority keywords are re-checked daily; low-priority weekly.
 */
const FREQUENCY_HOURS: Record<"high" | "medium" | "low", number> = {
    high: 24,
    medium: 72,
    low: 168,
};

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

// Prisma uses cuid() for all PKs — validate as a non-empty string ≤ 50 chars
const uuidSchema = z.string().min(1).max(50);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BatchResult {
    keyword: string;
    mentionedBrands: string[];
}

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

// ---------------------------------------------------------------------------
// Shared auth helper
// ---------------------------------------------------------------------------

async function getAuthenticatedUserId(): Promise<string | null> {
    const session = await getServerSession(authOptions);
    return session?.user?.id ?? null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function callGemini(prompt: string): Promise<string> {
    const text = await _callGemini(prompt, {
        maxOutputTokens: 1024,
        temperature: 0.1,
    });
    if (!text) throw new Error("Gemini returned empty response");
    return text;
}

function parseJson<T>(text: string): T | null {
    try {
        const clean = text
            .replace(/^```(?:json)?\s*/im, "")
            .replace(/```\s*$/im, "")
            .trim();
        const match = clean.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        return match ? (JSON.parse(match[0]) as T) : null;
    } catch {
        return null;
    }
}

function frequencyHours(priority: number | null): number {
    if (!priority || priority >= 0.7) return FREQUENCY_HOURS.high;
    if (priority >= 0.4) return FREQUENCY_HOURS.medium;
    return FREQUENCY_HOURS.low;
}

/**
 * Returns true if this keyword was already tracked within its cooldown window.
 */
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
 * Calls Gemini once with a batch of keywords and returns brand mentions per keyword.
 * Only extracts brand names — does NOT generate full answers (huge token saving).
 */
async function fetchBrandMentionsBatch(
    keywords: string[],
): Promise<BatchResult[]> {
    const numbered = keywords.map((kw, i) => `${i + 1}. ${kw}`).join("\n");

    const prompt = `You are a search analyst. For each query below, list the brand names, tools, or service providers that are most commonly recommended or cited for that topic.

Do NOT write explanatory text. Return ONLY a JSON object in this exact shape:
{
  "results": [
    { "keyword": "<exact keyword>", "mentionedBrands": ["Brand A", "Brand B"] }
  ]
}

Queries:
${numbered}`;

    const text = await callGemini(prompt);
    const parsed = parseJson<{ results: BatchResult[] }>(text);
    return parsed?.results ?? [];
}

/**
 * Splits an array into chunks of a given size.
 */
function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

// ---------------------------------------------------------------------------
// Action 1: Run tracking
// ---------------------------------------------------------------------------

export async function runAeoShareOfVoiceCheck(
    siteId: string,
): Promise<RunAeoShareOfVoiceResult> {
    // --- Input validation ---
    if (!uuidSchema.safeParse(siteId).success) {
        return { success: false, error: "Invalid site ID." };
    }

    try {
        const userId = await getAuthenticatedUserId();
        if (!userId) return { success: false, error: "Unauthorized" };

        const site = await prisma.site.findFirst({
            where: { id: siteId, userId },
            select: { id: true, domain: true },
        });
        if (!site) return { success: false, error: "Site not found" };

        // --- Load seed keywords, auto-discover if none exist ---
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
                    error:
                        "No seed keywords found and auto-discovery failed: " +
                        discoveryResult.error,
                };
            }

            // Only auto-add commercial / transactional keywords — informational
            // queries rarely indicate AEO opportunity worth tracking.
            const candidates = (
                discoveryResult.keywords as Array<{
                    keyword: string;
                    intent: string;
                    priority?: number;
                }>
            )
                .filter(
                    (k) => ["commercial", "transactional", "informational"].includes(k.intent),
                )
                .slice(0, 5);

            for (const kw of candidates) {
                await addSeedKeyword(
                    site.id,
                    kw.keyword,
                    kw.intent,
                    1,
                    "Auto-generated for AEO tracking",
                );
            }

            seedKeywords = await prisma.seedKeyword.findMany({
                where: { siteId: site.id },
                orderBy: { addedAt: "desc" },
                take: MAX_KEYWORDS,
            });

            if (seedKeywords.length === 0) {
                return {
                    success: false,
                    error: "Failed to load auto-generated seed keywords.",
                };
            }
        }

        const brandIdentity = extractBrandIdentity(site.domain);

        // --- Filter to keywords not within their cooldown window ---
        // Run cooldown checks in parallel — one DB query per keyword but
        // all fired concurrently, which is fine at MAX_KEYWORDS = 10.
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
                message:
                    "All keywords are within their tracking cooldown. Nothing to run.",
            };
        }

        // --- Batch processing with concurrency cap ---
        const limit = pLimit(GEMINI_CONCURRENCY);
        let trackedCount = 0;

        await Promise.allSettled(
            chunk(due, BATCH_SIZE).map((batch) =>
                limit(async () => {
                    let results: BatchResult[] = [];

                    try {
                        results = await fetchBrandMentionsBatch(
                            batch.map((sk) => sk.keyword),
                        );
                    } catch (err: unknown) {
                        logger.error("[AEO Track] Batch LLM call failed", {
                            keywords: batch.map((s) => s.keyword),
                            error: (err as Error)?.message,
                        });
                        return;
                    }

                    // Persist each result — fire DB writes concurrently within the batch
                    await Promise.allSettled(
                        results.map(async (result) => {
                            const mentioned = result.mentionedBrands ?? [];
                            const mentionedText = mentioned.join(" ");
                            const isBrandMentioned = isBrandCited(mentionedText, brandIdentity);

                            const competitors = mentioned.filter(
                                (name) => !isBrandCited(name, brandIdentity),
                            );

                            try {
                                await prisma.aiShareOfVoice.create({
                                    data: {
                                        siteId: site.id,
                                        keyword: result.keyword,
                                        modelName: "gemini-2.0-flash",
                                        brandMentioned: isBrandMentioned,
                                        competitorsMentioned: competitors,
                                    },
                                });
                                trackedCount++;
                            } catch (err: unknown) {
                                logger.error("[AEO Track] DB write failed", {
                                    keyword: result.keyword,
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
            message: `Completed tracking run: ${trackedCount} keyword${trackedCount !== 1 ? "s" : ""} recorded.`,
        };
    } catch (error: unknown) {
        logger.error("[AEO Track] Action failed", {
            error: (error as Error)?.message ?? String(error),
        });
        return { success: false, error: "Failed to run AEO Share of Voice check." };
    }
}

// ---------------------------------------------------------------------------
// Action 2: Read metrics
// ---------------------------------------------------------------------------

export async function getAeoShareOfVoiceMetrics(
    siteId: string,
): Promise<GetAeoShareOfVoiceMetricsResult> {
    // --- Input validation ---
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
            // Only select the columns we actually use — avoid pulling competitorsMentioned
            // (a JSON array) into memory for every row unless we need it.
            select: {
                keyword: true,
                brandMentioned: true,
                competitorsMentioned: true,
                recordedAt: true,
            },
        });

        // --- Daily chart data ---
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

        // --- Keyword-level breakdown ---
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