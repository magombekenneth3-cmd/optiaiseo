"use server";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchGSCKeywords, normaliseSiteUrl } from "@/lib/gsc";

const GSC_RULES = {
    buriedPosition: 20,
    minImpressions: 50,
    noClicksMinImpressions: 100,
    maxClicks: 2,
    minPosition: 10,
};

export interface KeywordSuggestion {
    keyword: string;
    impressions: number;
    position: number;
    reason: string;
    source: "gsc_gap" | "competitor_gap" | "no_content";
}

export async function getSiteKeywordSuggestions(
    siteId: string
): Promise<{ success: boolean; suggestions: KeywordSuggestion[]; error?: string }> {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return { success: false, suggestions: [], error: "Unauthorized" };
        }

        const userId = session.user.id;

        if (!siteId || siteId.length > 50) {
            return { success: false, suggestions: [], error: "Invalid site ID" };
        }

        const site = await prisma.site.findFirst({
            where: { id: siteId, userId },
            select: { id: true, domain: true },
        });
        if (!site) {
            return { success: false, suggestions: [], error: "Site not found" };
        }

        const existingBlogs = await prisma.blog.findMany({
            where: { siteId: site.id },
            select: { targetKeywords: true },
            take: 500,
        });

        const coveredKeywords = new Set<string>(
            existingBlogs
                .flatMap((b: { targetKeywords: string[] }) => b.targetKeywords)
                .map((k: string) => k.toLowerCase().trim())
        );

        const seen = new Set<string>();
        const suggestions: KeywordSuggestion[] = [];

        function addSuggestion(s: KeywordSuggestion) {
            const key = s.keyword.toLowerCase().trim();
            if (seen.has(key)) return;
            seen.add(key);
            suggestions.push(s);
        }

        try {
            const gscToken = await prisma.account.findFirst({
                where: { userId, provider: "google" },
                select: { access_token: true },
            });

            if (gscToken?.access_token) {
                const raw = await fetchGSCKeywords(
                    gscToken.access_token,
                    normaliseSiteUrl(site.domain),
                    90,
                    500
                );
                const gscKeywords = raw.slice(0, 300);

                const buried = gscKeywords
                    .filter(
                        (kw) =>
                            kw.position > GSC_RULES.buriedPosition &&
                            kw.impressions >= GSC_RULES.minImpressions &&
                            !coveredKeywords.has(kw.keyword.toLowerCase().trim())
                    )
                    .sort((a, b) => b.impressions - a.impressions)
                    .slice(0, 5);

                for (const kw of buried) {
                    addSuggestion({
                        keyword: kw.keyword.slice(0, 200),
                        impressions: kw.impressions,
                        position: Math.round(kw.position),
                        reason: `${kw.impressions.toLocaleString()} searches/month — ranking #${Math.round(kw.position)}, a dedicated post could reach page 1`,
                        source: "gsc_gap",
                    });
                }

                const noClicks = gscKeywords
                    .filter(
                        (kw) =>
                            kw.impressions >= GSC_RULES.noClicksMinImpressions &&
                            kw.clicks <= GSC_RULES.maxClicks &&
                            kw.position > GSC_RULES.minPosition &&
                            !coveredKeywords.has(kw.keyword.toLowerCase().trim())
                    )
                    .sort((a, b) => b.impressions - a.impressions)
                    .slice(0, 3);

                for (const kw of noClicks) {
                    addSuggestion({
                        keyword: kw.keyword.slice(0, 200),
                        impressions: kw.impressions,
                        position: Math.round(kw.position),
                        reason: `${kw.impressions.toLocaleString()} searches, only ${kw.clicks} clicks — no dedicated page for this yet`,
                        source: "no_content",
                    });
                }
            }
        } catch (err) {
            logger.warn("[KeywordSuggest] GSC fetch failed", { error: (err as Error)?.message });
        }

        if (suggestions.length < 8) {
            try {
                const compKeywords = await prisma.competitorKeyword.findMany({
                    where: { competitor: { siteId: site.id } },
                    orderBy: { searchVolume: "desc" },
                    take: 20,
                    select: { keyword: true, searchVolume: true, difficulty: true },
                });

                for (const ck of compKeywords) {
                    if (coveredKeywords.has(ck.keyword.toLowerCase().trim())) continue;

                    addSuggestion({
                        keyword: ck.keyword.slice(0, 200),
                        impressions: ck.searchVolume ?? 0,
                        position: 0,
                        reason: "Your competitor ranks for this — you have no content targeting it",
                        source: "competitor_gap",
                    });

                    if (suggestions.length >= 10) break;
                }
            } catch (err) {
                logger.warn("[KeywordSuggest] Competitor fetch failed", { error: (err as Error)?.message });
            }
        }

        const ordered = [
            ...suggestions.filter((s) => s.source === "gsc_gap"),
            ...suggestions.filter((s) => s.source === "no_content"),
            ...suggestions.filter((s) => s.source === "competitor_gap"),
        ].slice(0, 10);

        return { success: true, suggestions: ordered };
    } catch (error: unknown) {
        logger.error("[KeywordSuggest] Failed:", { error: (error as Error)?.message || String(error) });
        return { success: false, suggestions: [], error: "Failed to fetch keyword suggestions" };
    }
}