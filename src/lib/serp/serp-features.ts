import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"

const KEYWORD_CAP = 20
const SERP_DELAY_MS = 400
const SERP_TIMEOUT_MS = 12_000

interface SerperResult {
    organic?: { link?: string; snippet?: string }[]
    answerBox?: object
    peopleAlsoAsk?: object[]
    localResults?: object
    videos?: object[]
    knowledgeGraph?: object
    aiOverview?: { text?: string; snippets?: { link?: string }[] }
}

export type SerpFeatureSummary = {
    keyword: string
    hasAiOverview: boolean
    hasSnippet: boolean
    hasPaa: boolean
    hasLocalPack: boolean
    hasVideo: boolean
    brandInAio: boolean
    capturedAt: Date
}

export async function fetchSerp(keyword: string): Promise<SerperResult | null> {
    const apiKey = process.env.SERPER_API_KEY
    if (!apiKey) return null

    try {
        const res = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
            body: JSON.stringify({ q: keyword, gl: "us", hl: "en", num: 10 }),
            signal: AbortSignal.timeout(SERP_TIMEOUT_MS),
        })

        return res.ok ? ((await res.json()) as SerperResult) : null
    } catch {
        return null
    }
}

function stripDomain(domain: string): string {
    return domain.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
}

export async function captureSerpFeatures(
    siteId: string,
    domain: string,
    keywords: string[]
): Promise<number> {
    const domainStripped = stripDomain(domain)
    let saved = 0

    const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: { userId: true },
    })
    const userId = site?.userId

    for (const keyword of keywords.slice(0, KEYWORD_CAP)) {
        const serp = await fetchSerp(keyword)
        if (!serp) continue

        const hasAiOverview = !!serp.aiOverview
        const brandInAio = hasAiOverview
            ? (serp.aiOverview?.snippets ?? []).some((s) => s.link?.includes(domainStripped))
            : false

        const answerBox = serp.answerBox as Record<string, string> | undefined;
        const snippetText = answerBox?.answer ?? answerBox?.snippet ?? null;
        const hasSnippet = !!serp.answerBox;
        const hasPaa = (serp.peopleAlsoAsk?.length ?? 0) > 0;
        const hasLocalPack = !!serp.localResults;
        const hasVideo = (serp.videos?.length ?? 0) > 0;

        // Fetch old state before updating
        const oldFeature = await prisma.serpFeature.findUnique({
            where: { siteId_keyword: { siteId, keyword } },
        })

        // Create historical snapshot record
        await prisma.serpFeatureSnapshot.create({
            data: {
                siteId,
                keyword,
                hasAiOverview,
                hasSnippet,
                snippetText,
                hasPaa,
                hasLocalPack,
                hasVideo,
                brandInAio,
            },
        })

        // Update the unique current feature record (upsert)
        await prisma.serpFeature.upsert({
            where: { siteId_keyword: { siteId, keyword } },
            create: {
                siteId,
                keyword,
                hasAiOverview,
                hasSnippet,
                snippetText,
                hasPaa,
                hasLocalPack,
                hasVideo,
                brandInAio,
            },
            update: {
                hasAiOverview,
                hasSnippet,
                snippetText,
                hasPaa,
                hasLocalPack,
                hasVideo,
                brandInAio,
                capturedAt: new Date(),
            },
        })

        // Check for lost features and alert
        if (oldFeature && userId) {
            const lostFeatures: string[] = []
            if (oldFeature.hasSnippet && !hasSnippet) {
                lostFeatures.push("Featured Snippet")
            }
            if (oldFeature.brandInAio && !brandInAio) {
                lostFeatures.push("Brand mention in AI Overview")
            }

            if (lostFeatures.length > 0) {
                try {
                    await prisma.notification.create({
                        data: {
                            userId,
                            type: "serp_feature_lost",
                            title: `Lost SERP Feature: ${keyword}`,
                            body: `Your site ${domain} lost the following feature(s) for the keyword "${keyword}": ${lostFeatures.join(", ")}.`,
                            href: `/dashboard/sites/${siteId}/seo`,
                            metadata: { keyword, lostFeatures },
                        },
                    })
                } catch (e: unknown) {
                    logger.error("[SerpFeatures] Failed to create notification", { error: (e as Error)?.message });
                }
            }
        }

        saved++
        await delay(SERP_DELAY_MS)
    }

    logger.info("[SerpFeatures] Captured keyword snapshots", { domain, saved })
    return saved
}

export async function getLatestSerpFeatures(
    siteId: string,
    limit = 20
): Promise<SerpFeatureSummary[]> {
    return prisma.serpFeature.findMany({
        where: { siteId },
        orderBy: { capturedAt: "desc" },
        take: limit,
        select: {
            keyword: true,
            hasAiOverview: true,
            hasSnippet: true,
            hasPaa: true,
            hasLocalPack: true,
            hasVideo: true,
            brandInAio: true,
            capturedAt: true,
        },
        distinct: ["keyword"],
    })
}