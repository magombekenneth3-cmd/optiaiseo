import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";

export const NICHES = ["saas", "ecommerce", "local", "agency", "blog", "other"] as const;
export type Niche = (typeof NICHES)[number];

export const NICHE_META: Record<Niche, { label: string; description: string; slug: string }> = {
    saas:      { label: "SaaS tools",      description: "Software-as-a-service products and developer tools", slug: "saas" },
    ecommerce: { label: "E-commerce",       description: "Online stores, marketplaces, and retail brands",     slug: "ecommerce" },
    local:     { label: "Local businesses", description: "Local services, restaurants, and physical stores",   slug: "local" },
    agency:    { label: "Digital agencies", description: "Marketing, design, and development agencies",        slug: "agency" },
    blog:      { label: "Content & blogs",  description: "Publishers, media sites, and content creators",      slug: "blog" },
    other:     { label: "General websites", description: "Websites that span multiple categories",             slug: "other" },
};

export interface LeaderboardEntry {
    rank: number;
    domain: string;
    niche: Niche;
    aeoScore: number;
    grade: string;
    generativeShareOfVoice: number;
    citationLikelihood: number;
    perplexityScore: number;
    chatgptScore: number;
    claudeScore: number;
    googleAioScore: number;
    weeklyChange: number | null;
    snapshotDate: Date;
    isNew: boolean;
}

export interface NicheLeaderboard {
    niche: Niche;
    nicheLabel: string;
    nicheDescription: string;
    entries: LeaderboardEntry[];
    totalSitesTracked: number;
    medianAeoScore: number;
    lastUpdated: Date;
}

export interface LeaderboardIndex {
    niches: {
        niche: Niche;
        nicheLabel: string;
        topEntry: LeaderboardEntry | null;
        totalSites: number;
        medianScore: number;
    }[];
    totalSitesAcrossAllNiches: number;
    lastUpdated: Date;
}

const CACHE_TTL = 60 * 60;
const EMPTY_CACHE_TTL = 5 * 60; // 5 minutes for confirmed empty datasets so new sites index quickly

export type NicheLeaderboardResult =
    | { status: "success"; data: NicheLeaderboard }
    | { status: "empty"; data: null }
    | { status: "error"; error: string; data: null };

async function cacheGet<T>(key: string): Promise<T | null> {
    try {
        const raw = await redis.get<string>(key);
        if (!raw) return null;
        return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
    } catch { return null; }
}

async function cacheSet<T>(key: string, value: T, ttl: number = CACHE_TTL): Promise<void> {
    try {
        await redis.setex(key, ttl, JSON.stringify(value));
    } catch { /* non-fatal */ }
}

export async function getNicheLeaderboardResult(niche: Niche): Promise<NicheLeaderboardResult> {
    const cacheKey = `leaderboard:${niche}`;
    const cached = await cacheGet<NicheLeaderboardResult | NicheLeaderboard>(cacheKey);

    if (cached) {
        if ("status" in cached) {
            if (cached.status === "success" && cached.data) {
                return {
                    status: "success",
                    data: {
                        ...cached.data,
                        lastUpdated: new Date(cached.data.lastUpdated),
                        entries: cached.data.entries.map((e) => ({
                            ...e,
                            snapshotDate: new Date(e.snapshotDate),
                        })),
                    },
                };
            }
            if (cached.status === "empty") {
                return cached;
            }
        } else if ("entries" in cached) {
            // Legacy cache format migration
            return {
                status: "success",
                data: {
                    ...cached,
                    lastUpdated: new Date(cached.lastUpdated),
                    entries: cached.entries.map((e) => ({
                        ...e,
                        snapshotDate: new Date(e.snapshotDate),
                    })),
                },
            };
        }
    }

    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const sites = await prisma.site.findMany({
            where: {
                niche,
                operatingMode: "FULL_ACCESS",
                hideFromLeaderboard: { not: true },
                aeoSnapshots: { some: { createdAt: { gte: thirtyDaysAgo } } },
            },
            select: {
                id: true,
                domain: true,
                aeoSnapshots: {
                    orderBy: { createdAt: "desc" },
                    take: 2,
                    select: {
                        score: true,
                        grade: true,
                        generativeShareOfVoice: true,
                        citationLikelihood: true,
                        perplexityScore: true,
                        chatgptScore: true,
                        claudeScore: true,
                        googleAioScore: true,
                        createdAt: true,
                    },
                },
            },
        });

        if (sites.length === 0) {
            const emptyResult: NicheLeaderboardResult = { status: "empty", data: null };
            await cacheSet(cacheKey, emptyResult, EMPTY_CACHE_TTL);
            return emptyResult;
        }

        const rawEntries = sites
            .map((site) => {
                const latest = site.aeoSnapshots[0];
                const previous = site.aeoSnapshots[1] ?? null;
                if (!latest) return null;

                const weeklyChange = previous ? latest.score - previous.score : null;
                const wasInTopLastWeek = previous && new Date(previous.createdAt) > sevenDaysAgo;

                return {
                    domain: site.domain,
                    niche,
                    aeoScore: latest.score,
                    grade: latest.grade,
                    generativeShareOfVoice: latest.generativeShareOfVoice,
                    citationLikelihood: latest.citationLikelihood,
                    perplexityScore: latest.perplexityScore,
                    chatgptScore: latest.chatgptScore,
                    claudeScore: latest.claudeScore,
                    googleAioScore: latest.googleAioScore,
                    weeklyChange,
                    snapshotDate: latest.createdAt,
                    isNew: !wasInTopLastWeek,
                };
            })
            .filter((e): e is NonNullable<typeof e> => e !== null)
            .sort((a, b) => b.aeoScore - a.aeoScore);

        const entries: LeaderboardEntry[] = rawEntries.slice(0, 10).map((e, i) => ({ ...e, rank: i + 1 }));
        const allScores = rawEntries.map((e) => e.aeoScore).sort((a, b) => a - b);
        const medianAeoScore = allScores[Math.floor(allScores.length / 2)] ?? 0;

        const result: NicheLeaderboard = {
            niche,
            nicheLabel: NICHE_META[niche].label,
            nicheDescription: NICHE_META[niche].description,
            entries,
            totalSitesTracked: sites.length,
            medianAeoScore,
            lastUpdated: new Date(),
        };

        const successResult: NicheLeaderboardResult = { status: "success", data: result };
        await cacheSet(cacheKey, successResult, CACHE_TTL);
        return successResult;
    } catch (err: unknown) {
        const errorMsg = (err as Error)?.message ?? "Database error";
        logger.error("[Leaderboard] getNicheLeaderboard failed", { niche, error: errorMsg });
        return { status: "error", error: errorMsg, data: null };
    }
}

export async function getNicheLeaderboard(niche: Niche): Promise<NicheLeaderboard | null> {
    const result = await getNicheLeaderboardResult(niche);
    return result.status === "success" ? result.data : null;
}

export async function getLeaderboardIndex(): Promise<LeaderboardIndex> {
    const cacheKey = "leaderboard:index";
    const cached = await cacheGet<LeaderboardIndex>(cacheKey);
    if (cached) return cached;

    const nicheData = await Promise.all(
        NICHES.map(async (niche) => {
            const lb = await getNicheLeaderboard(niche);
            return {
                niche,
                nicheLabel: NICHE_META[niche].label,
                topEntry: lb?.entries[0] ?? null,
                totalSites: lb?.totalSitesTracked ?? 0,
                medianScore: lb?.medianAeoScore ?? 0,
            };
        })
    );

    const result: LeaderboardIndex = {
        niches: nicheData.filter((n) => n.totalSites > 0),
        totalSitesAcrossAllNiches: nicheData.reduce((s, n) => s + n.totalSites, 0),
        lastUpdated: new Date(),
    };

    await cacheSet(cacheKey, result);
    return result;
}

export async function bustLeaderboardCache(): Promise<void> {
    const keys = ["leaderboard:index", ...NICHES.map((n) => `leaderboard:${n}`)];
    await Promise.all(keys.map((k) => redis.del(k).catch(() => null)));
    logger.info("[Leaderboard] Cache busted");
}

export async function getSiteLeaderboardPosition(
    siteId: string
): Promise<{ rank: number; totalSites: number; niche: Niche } | null> {
    try {
        const site = await prisma.site.findUnique({
            where: { id: siteId },
            select: { niche: true, domain: true },
        });

        if (!site?.niche || !NICHES.includes(site.niche as Niche)) return null;

        const niche = site.niche as Niche;
        const lb = await getNicheLeaderboard(niche);
        if (!lb) return null;

        const entry = lb.entries.find((e) => e.domain === site.domain);
        if (!entry) return { rank: lb.entries.length + 1, totalSites: lb.totalSitesTracked, niche };

        return { rank: entry.rank, totalSites: lb.totalSitesTracked, niche };
    } catch { return null; }
}
