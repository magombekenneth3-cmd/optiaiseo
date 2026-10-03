import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

interface TrendingKeyword {
    keyword: string;
    volume?: number;
}

interface NewsItem {
    title?: string;
    snippet?: string;
    link?: string;
    source?: string;
    /** Relative date string from Serper, e.g. "3 hours ago" */
    date?: string;
}

interface SerperResponse {
    news?: NewsItem[];
}

/** A real, citable news headline observed for a niche. */
export interface NewsHeadline {
    title: string;
    snippet: string;
    url: string | null;
    /** Publishing outlet, e.g. "TechCrunch" */
    outlet: string | null;
    /** Relative publish date as reported by Serper (e.g. "2 days ago") */
    publishedLabel: string | null;
}

export interface TrendSignals {
    /** Where the signal came from */
    source: "Serper News";
    observedAt: Date;
    headlines: NewsHeadline[];
    /** Most frequent significant terms across the headlines */
    terms: string[];
}

const STOP_WORDS = new Set([
    "the", "a", "an", "is", "in", "on", "at", "to", "for", "of", "and", "or",
    "with", "by", "from", "this", "that", "it", "be", "are", "was", "were",
    "has", "have", "had", "will", "would", "could", "should", "may", "might",
]);

const KEYWORD_LIMIT = 15;
const NEWS_FETCH_COUNT = 10;
const API_TIMEOUT_MS = 10_000;

function sanitizeInput(value: string): string {
    return value.replace(/[^a-zA-Z0-9\s\-_]/g, "").trim().slice(0, 100);
}

function extractKeywords(newsItems: NewsItem[]): string[] {
    const freq = new Map<string, number>();

    for (const item of newsItems) {
        const text = `${item.title ?? ""} ${item.snippet ?? ""}`;
        const words = text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

        for (const word of words) {
            freq.set(word, (freq.get(word) ?? 0) + 1);
        }
    }

    return [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, KEYWORD_LIMIT)
        .map(([word]) => word);
}

function getStartOfDay(): Date {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
}

async function upsertTrendingTopic(
    industry: string,
    country: string,
    keywords: string[],
    newsItems: NewsItem[]
): Promise<void> {
    const existing = await prisma.trendingTopic.findFirst({
        where: {
            industry,
            country,
            fetchedAt: { gte: getStartOfDay() },
        },
        select: { id: true },
    });

    if (!existing) {
        await prisma.trendingTopic.create({
            data: {
                country,
                industry,
                keywords,
                newsData: newsItems as object[],
                fetchedAt: new Date(),
            },
        });
    }
}

/**
 * Fetches real news headlines for a niche from Serper News.
 * Returns null when the API is unavailable — callers must treat that as
 * "no trend evidence", never as an invitation to fabricate trends.
 */
export async function fetchTrendSignals(
    industry: string,
    country: string
): Promise<TrendSignals | null> {
    const apiKey = process.env.SERPER_API_KEY;

    if (!apiKey) {
        logger.warn("[Trending] SERPER_API_KEY not configured");
        return null;
    }

    const safeIndustry = sanitizeInput(industry);
    const safeCountry = sanitizeInput(country);

    if (!safeIndustry || !safeCountry) {
        logger.warn("[Trending] Invalid industry or country input");
        return null;
    }

    const gl = safeCountry.toLowerCase().slice(0, 2);

    try {
        const res = await fetch("https://google.serper.dev/news", {
            method: "POST",
            headers: {
                "X-API-KEY": apiKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                q: `${safeIndustry} latest trends ${new Date().getFullYear()}`,
                gl,
                num: NEWS_FETCH_COUNT,
            }),
            signal: AbortSignal.timeout(API_TIMEOUT_MS),
        });

        if (!res.ok) {
            throw new Error(`Serper responded with status ${res.status}`);
        }

        const data: SerperResponse = await res.json();
        const newsItems: NewsItem[] = data.news ?? [];
        const terms = extractKeywords(newsItems);

        await upsertTrendingTopic(safeIndustry, safeCountry, terms, newsItems);

        logger.info("[Trending] Signals fetched", {
            industry: safeIndustry,
            country: safeCountry,
            headlines: newsItems.length,
        });

        return {
            source: "Serper News",
            observedAt: new Date(),
            terms,
            headlines: newsItems
                .filter((n) => n.title)
                .map((n) => ({
                    title: n.title!,
                    snippet: n.snippet ?? "",
                    url: n.link ?? null,
                    outlet: n.source ?? null,
                    publishedLabel: n.date ?? null,
                })),
        };
    } catch (error: unknown) {
        logger.error("[Trending] Failed to fetch signals", {
            industry: safeIndustry,
            country: safeCountry,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

/**
 * Legacy helper — returns the most frequent terms in recent niche news.
 * Prefer fetchTrendSignals(), which keeps headline provenance.
 */
export async function fetchTrendingTopics(
    industry: string,
    country: string
): Promise<TrendingKeyword[]> {
    const signals = await fetchTrendSignals(industry, country);
    return (signals?.terms ?? []).map((keyword) => ({ keyword }));
}