"use server";

import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
    fetchGSCKeywords,
    fetchGSCSites,
    categoriseKeywords,
    findOpportunities,
    buildRankingSummary,
    normaliseSiteUrl,
    detectCannibalization,
    type KeywordRow,
    type KeywordOpportunity,
    type CategorisedKeywords,
    type RankingSummary,
    type CannibalizationIssue,
} from "@/lib/gsc";
import { clusterKeywords, type EnrichedKeyword, type KeywordCluster } from "@/lib/keywords";
import { getUserGscToken } from "@/lib/gsc/token";
import { generateBlogFromKeywordGap } from "@/lib/blog";
import { computeShareOfVoice, type SovEntry } from "@/lib/keywords/share-of-voice";
import { limiters } from "@/lib/rate-limit";
import { requireTiers, guardErrorToResult } from "@/lib/stripe/guards";
import { checkBlogLimit } from "@/lib/rate-limit";

type EnrichedKeywordRow = KeywordRow & {
    positionHistory: Array<{ date: string; position: number }>;
    difficulty:      number | null;
    intent:          string | null;
};

const SITE_SELECT = {
    id: true,
    domain: true,
    userId: true,
} as const;

async function getSessionUserId(): Promise<string | null> {
    const session = await getServerSession(authOptions);
    return session?.user?.id ?? null;
}

async function resolveGscToken(userId: string): Promise<{ token: string } | { error: string }> {
    try {
        const token = await getUserGscToken(userId);
        return { token };
    } catch (e: unknown) {
        const msg = (e as Error)?.message;
        if (msg === "GSC_NOT_CONNECTED") {
            return { error: "Connect Google Search Console to see keyword data." };
        }
        if (msg === "GSC_REFRESH_TOKEN_MISSING" || msg === "GSC_TOKEN_REFRESH_FAILED") {
            return { error: "Your Google connection expired. Please reconnect GSC." };
        }
        logger.error("[Keywords] GSC token error:", { error: msg || String(e) });
        return { error: "Failed to connect to Google Search Console." };
    }
}

function gscUrlCandidates(domain: string): string[] {
    const clean = domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "");
    return [
        `https://www.${clean}/`,
        `https://${clean}/`,
        `sc-domain:${clean}`,
    ];
}

async function resolveGscPropertyUrl(token: string, domain: string): Promise<string | null> {
    try {
        const sites = await fetchGSCSites(token);
        const candidates = gscUrlCandidates(domain);
        for (const candidate of candidates) {
            if (sites.some((s) => s.toLowerCase() === candidate.toLowerCase())) {
                return candidate;
            }
        }
        const bare = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
        return sites.find((s) => s.includes(bare)) ?? null;
    } catch {
        return null;
    }
}

function getCachedGscKeywords(userId: string, siteId: string, domain: string) {
    return unstable_cache(
        async () => {
            const tokenResult = await resolveGscToken(userId);
            if ("error" in tokenResult) throw new Error(tokenResult.error);
            const primaryUrl = normaliseSiteUrl(domain);
            try {
                return await fetchGSCKeywords(tokenResult.token, primaryUrl, 90, 300);
            } catch (firstErr: unknown) {
                const msg = (firstErr as Error)?.message ?? "";
                if (!msg.includes("403")) throw firstErr;
                logger.warn(`[Keywords] 403 for ${primaryUrl} — auto-detecting GSC property`, { siteId });
                const resolved = await resolveGscPropertyUrl(tokenResult.token, domain);
                if (!resolved || resolved === primaryUrl) {
                    throw new Error(
                        "GSC 403: Your site is not verified in Google Search Console, or this account doesn't have access to it. " +
                        "Add and verify your property at search.google.com/search-console then reconnect."
                    );
                }
                logger.info(`[Keywords] Resolved GSC property: ${resolved}`, { siteId });
                return await fetchGSCKeywords(tokenResult.token, resolved, 90, 300);
            }
        },
        [`gsc-keywords-${siteId}`],
        { revalidate: 300, tags: [`gsc-keywords-${siteId}`] }
    )();
}

/**
 * Bust the unstable_cache entry for a site's GSC keywords.
 * Call this whenever the user reconnects GSC, switches the active site,
 * or explicitly requests a data refresh.
 */
export async function bustGscKeywordsCache(siteId: string): Promise<void> {
    revalidateTag(`gsc-keywords-${siteId}`);
}

export async function getKeywordRankingsFast(siteId?: string): Promise<{
    success: boolean;
    data?: {
        keywords: EnrichedKeywordRow[];
        categorised: CategorisedKeywords;
        summary: RankingSummary;
        opportunities: KeywordOpportunity[];
        cannibalization: CannibalizationIssue[];
        siteId: string;
    };
    error?: string;
}> {
    try {
        const userId = await getSessionUserId();
        if (!userId) return { success: false, error: "Not authenticated" };

        const site = await prisma.site.findFirst({
            where: siteId ? { id: siteId, userId } : { userId },
            select: SITE_SELECT,
            orderBy: { createdAt: "desc" },
        });
        if (!site) return { success: false, error: "Register a site first before checking keyword rankings" };

        let keywords: KeywordRow[];
        try {
            keywords = await getCachedGscKeywords(userId, site.id, site.domain);
        } catch (e: unknown) {
            const msg = (e as Error)?.message ?? "";
            if (msg.includes("403")) {
                return { success: false, error: "Search Console access denied. Make sure your site is verified in Google Search Console and try reconnecting." };
            }
            return { success: false, error: msg || "Failed to fetch keyword rankings. Try again." };
        }

        // Dedup: keep the best-ranking row per (keyword, url) pair.
        // normalizeKeyword already ran inside fetchGSCKeywords so kw.keyword
        // is already clean — we don't need to re-normalise here, which
        // previously caused distinct GSC verbatim-operator rows to be
        // collapsed under the same key and lose one URL entirely.
        const kwMap = new Map<string, KeywordRow>();
        for (const row of keywords) {
            // Composite key: cleaned keyword + best-ranking URL preserves
            // cross-URL data while still deduplicating true duplicates.
            const mapKey = `${row.keyword}\x00${row.url}`;
            const existing = kwMap.get(mapKey);
            if (!existing) {
                kwMap.set(mapKey, { ...row });
            } else {
                // Same keyword+URL appeared in multiple GSC result pages —
                // sum metrics and keep the better position.
                kwMap.set(mapKey, {
                    ...existing,
                    clicks:      existing.clicks      + row.clicks,
                    impressions: existing.impressions  + row.impressions,
                    position:    Math.min(existing.position, row.position),
                });
            }
        }

        // Collapse to per-keyword best row (pick URL with lowest position,
        // summing clicks/impressions across all URLs for that keyword).
        const perKeyword = new Map<string, KeywordRow>();
        for (const row of kwMap.values()) {
            const existing = perKeyword.get(row.keyword);
            if (!existing || row.position < existing.position) {
                perKeyword.set(row.keyword, {
                    ...row,
                    clicks:      (existing?.clicks      ?? 0) + row.clicks,
                    impressions: (existing?.impressions  ?? 0) + row.impressions,
                });
            } else {
                perKeyword.set(row.keyword, {
                    ...existing,
                    clicks:      existing.clicks      + row.clicks,
                    impressions: existing.impressions  + row.impressions,
                });
            }
        }
        const dedupedKeywords: KeywordRow[] = Array.from(perKeyword.values())
            .map(kw => ({
                ...kw,
                ctr: kw.impressions > 0
                    ? parseFloat(((kw.clicks / kw.impressions) * 100).toFixed(2))
                    : 0,
            }))
            .sort((a, b) => b.impressions - a.impressions);

        const SIX_WEEKS_AGO = new Date(Date.now() - 42 * 24 * 60 * 60 * 1000);
        const rawHistory = await prisma.rankSnapshot.findMany({
            where:   { siteId: site.id, recordedAt: { gte: SIX_WEEKS_AGO } },
            select:  { keyword: true, position: true, recordedAt: true },
            orderBy: { recordedAt: "asc" },
            take:    10_000,
        });
        const historyMap = new Map<string, Array<{ date: string; position: number }>>();
        for (const snap of rawHistory) {
            const key  = snap.keyword.toLowerCase();
            const list = historyMap.get(key) ?? [];
            list.push({
                date:     snap.recordedAt.toISOString().slice(0, 10),
                position: snap.position,
            });
            historyMap.set(key, list);
        }

        const WEEK_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const metaSnaps = await prisma.rankSnapshot.findMany({
            where:   { siteId: site.id, recordedAt: { gte: WEEK_AGO } },
            select:  { keyword: true, difficulty: true, intent: true },
            orderBy: { recordedAt: "desc" },
            take:    2000,
        });
        const metaMap = new Map<string, { difficulty: number | null; intent: string | null }>();
        for (const r of metaSnaps) {
            if (!metaMap.has(r.keyword.toLowerCase())) {
                metaMap.set(r.keyword.toLowerCase(), {
                    difficulty: r.difficulty ?? null,
                    intent:     r.intent     ?? null,
                });
            }
        }

        const enrichedKeywords: EnrichedKeywordRow[] = dedupedKeywords.map((kw) => {
            const key  = kw.keyword.toLowerCase();
            const meta = metaMap.get(key);
            return {
                ...kw,
                positionHistory: historyMap.get(key) ?? [],
                difficulty:      meta?.difficulty ?? null,
                intent:          meta?.intent     ?? null,
            };
        });

        const categorised     = categoriseKeywords(dedupedKeywords);
        const summary         = buildRankingSummary(dedupedKeywords);
        const opportunities   = findOpportunities(dedupedKeywords, 20);
        const cannibalization = detectCannibalization(dedupedKeywords);

        return { success: true, data: { keywords: enrichedKeywords, categorised, summary, opportunities, cannibalization, siteId: site.id } };
    } catch (error: unknown) {
        logger.error("[Keywords] getKeywordRankingsFast failed:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to fetch keyword rankings. Try again." };
    }
}

export async function getKeywordClusters(siteId: string): Promise<{
    success: boolean;
    clusters?: KeywordCluster[];
    error?: string;
}> {
    try {
        if (!siteId || siteId.length > 50) return { success: false, error: "Invalid site ID" };

        const userId = await getSessionUserId();
        if (!userId) return { success: false, error: "Not authenticated" };

        const site = await prisma.site.findFirst({
            where: { id: siteId, userId },
            select: SITE_SELECT,
        });
        if (!site) return { success: false, error: "Site not found" };

        let keywords: KeywordRow[];
        try {
            keywords = await getCachedGscKeywords(userId, site.id, site.domain);
        } catch (e: unknown) {
            return { success: false, error: (e as Error)?.message || "Failed to connect to Google Search Console." };
        }

        const seen = new Map<string, KeywordRow>();
        for (const kw of keywords) {
            const key = kw.keyword.toLowerCase().trim();
            if (!seen.has(key)) seen.set(key, kw);
        }
        const deduped = Array.from(seen.values());

        const enriched: EnrichedKeyword[] = deduped.map(kw => ({
            keyword:        kw.keyword,
            gscPosition:    kw.position,
            gscClicks:      kw.clicks,
            gscImpressions: kw.impressions,
            gscCtr:         kw.ctr,
            gscUrl:         kw.url,
            opportunityScore: 0,
            recommendation: "",
        }));

        const clusters = await clusterKeywords(enriched, site.id);
        return { success: true, clusters };
    } catch (error: unknown) {
        logger.error("[Keywords] getKeywordClusters failed:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to fetch keyword clusters." };
    }
}

export async function getKeywordOpportunities(siteId?: string): Promise<{
    success: boolean;
    opportunities?: KeywordOpportunity[];
    error?: string;
}> {
    try {
        const userId = await getSessionUserId();
        if (!userId) return { success: false, error: "Not authenticated" };

        const site = await prisma.site.findFirst({
            where: siteId ? { id: siteId, userId } : { userId },
            select: SITE_SELECT,
            orderBy: { createdAt: "desc" },
        });
        if (!site) return { success: false, error: "No site registered" };

        let keywords: KeywordRow[];
        try {
            keywords = await getCachedGscKeywords(userId, site.id, site.domain);
        } catch (e: unknown) {
            return { success: false, error: (e as Error)?.message || "Failed to connect to Google Search Console." };
        }

        const opportunities = findOpportunities(keywords, 20);
        return { success: true, opportunities };
    } catch (error: unknown) {
        logger.error("[Keywords] getKeywordOpportunities failed:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to fetch opportunities." };
    }
}

export async function generateBlogForKeyword(
    keyword: string,
    position: number,
    impressions: number,
    siteId?: string,
    intent?: string
): Promise<{ success: boolean; blog?: Record<string, unknown>; error?: string }> {
    try {
        if (!keyword || keyword.length > 200) {
            return { success: false, error: "Invalid keyword." };
        }

        const safeKeyword = keyword.replace(/[^\w\s-]/g, "").trim();
        if (!safeKeyword) return { success: false, error: "Invalid keyword." };

        const userId = await getSessionUserId();
        if (!userId) return { success: false, error: "Unauthorized" };

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, subscriptionTier: true },
        });
        if (!user) return { success: false, error: "User not found" };

        try {
        await requireTiers(user.id, ["PRO", "AGENCY"]);
    } catch (err) {
        return guardErrorToResult(err);
    }

        const site = siteId
            ? await prisma.site.findFirst({ where: { id: siteId, userId }, select: SITE_SELECT })
            : await prisma.site.findFirst({ where: { userId }, select: SITE_SELECT, orderBy: { createdAt: "desc" } });

        if (!site) {
            return {
                success: false,
                error: siteId ? "Site not found or you do not have access to it." : "Register a site first before generating blogs.",
            };
        }

        const rateCheck = await checkBlogLimit(user.id, user.subscriptionTier);
        if (!rateCheck.allowed) {
            return {
                success: false,
                error: `You have reached your blog generation limit. Upgrade to Pro for unlimited. Resets on ${rateCheck.resetAt.toLocaleDateString()}.`,
            };
        }

        logger.debug(`[Keywords] Generating blog for keyword: "${safeKeyword}" (intent: ${intent ?? "unknown"})`);
        const post = await generateBlogFromKeywordGap(safeKeyword, position, impressions, { name: site.domain }, site.domain, intent);

        const blog = await prisma.blog.create({
            data: {
                siteId: site.id,
                pipelineType: "GSC_GAP",
                title: post.title,
                slug: post.slug,
                targetKeywords: post.targetKeywords,
                content: post.content,
                metaDescription: post.metaDescription,
                status: "DRAFT",
            },
        });

        revalidatePath("/dashboard/blogs");
        return { success: true, blog: blog as Record<string, unknown> };
    } catch (error: unknown) {
        logger.error("[Keywords] generateBlogForKeyword failed:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to generate blog. Check server logs." };
    }
}

export async function getCannibalizationIssues(siteId: string): Promise<{
    success: boolean;
    issues?: CannibalizationIssue[];
    error?: string;
}> {
    try {
        if (!siteId || siteId.length > 50) return { success: false, error: "Invalid site ID" };

        const userId = await getSessionUserId();
        if (!userId) return { success: false, error: "Unauthorized" };

        const rl = await limiters.cannibalizationScan.limit(`cannibalization:${userId}`);
        if (!rl.success) return { success: false, error: "Too many requests — try again later" };

        const site = await prisma.site.findFirst({
            where: { id: siteId, userId },
            select: SITE_SELECT,
        });
        if (!site) return { success: false, error: "Site not found or access denied" };

        let keywords: KeywordRow[];
        try {
            keywords = await getCachedGscKeywords(userId, site.id, site.domain);
        } catch (e: unknown) {
            return { success: false, error: (e as Error)?.message || "Failed to connect to Google Search Console." };
        }

        const issues = detectCannibalization(keywords);
        issues.sort((a, b) => b.totalImpressions - a.totalImpressions);

        return { success: true, issues: issues.slice(0, 50) };
    } catch (error: unknown) {
        logger.error("[Keywords] getCannibalizationIssues failed:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to scan for cannibalization." };
    }
}

export async function getShareOfVoice(siteId: string): Promise<{
    success:  boolean;
    entries?: SovEntry[];
    error?:   string;
}> {
    try {
        if (!siteId || siteId.length > 50) return { success: false, error: "Invalid site ID" };

        const userId = await getSessionUserId();
        if (!userId) return { success: false, error: "Unauthorized" };

        const rl = await limiters.api.limit(`sov:${userId}`);
        if (!rl.success) return { success: false, error: "Too many requests" };

        const site = await prisma.site.findFirst({
            where: { id: siteId, userId },
            select: SITE_SELECT,
        });
        if (!site) return { success: false, error: "Site not found or access denied" };

        const entries = await computeShareOfVoice(siteId, site.domain);
        return { success: true, entries };
    } catch (error: unknown) {
        logger.error("[Keywords] getShareOfVoice failed:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Server error" };
    }
}