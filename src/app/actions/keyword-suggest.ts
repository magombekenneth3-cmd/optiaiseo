"use server";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchGSCKeywords, normaliseSiteUrl } from "@/lib/gsc";
import { getUserGscToken } from "@/lib/gsc/token";
import { resolvePageExistence, type PageExistenceVerdict } from "@/lib/opportunity-engine/page-existence-resolver";

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
    // Canonical GSC Topic Intelligence & Page Existence Resolver Integration
    clusterQueries?: string[];
    verdict?: PageExistenceVerdict;
    recommendedAction?: string;
    existingPageUrl?: string | null;
    actionType?: "CREATE_PAGE" | "UPDATE_PAGE";
}

interface RawGscKeyword {
    keyword: string;
    impressions: number;
    clicks: number;
    position: number;
}

/**
 * Cluster raw GSC queries by intent and token overlap.
 */
function clusterGscQueries(rawQueries: RawGscKeyword[]): { head: RawGscKeyword; variants: string[] }[] {
    const clusters: { head: RawGscKeyword; variants: string[] }[] = [];
    const STOP_WORDS = new Set([
        "a", "an", "the", "and", "or", "in", "on", "at", "to", "for", "of", "with", "by", "from", "is", "are", "best", "top", "online", "how", "what", "which", "where"
    ]);

    function tokenize(text: string): Set<string> {
        return new Set(
            text
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, " ")
                .split(/\s+/)
                .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
        );
    }

    const sorted = [...rawQueries].sort((a, b) => b.impressions - a.impressions);

    for (const q of sorted) {
        const tokens = tokenize(q.keyword);
        if (tokens.size === 0) continue;

        let merged = false;
        for (const cluster of clusters) {
            const headTokens = tokenize(cluster.head.keyword);
            const intersection = [...tokens].filter((t) => headTokens.has(t));
            const overlapRatio = intersection.length / Math.min(tokens.size, headTokens.size);

            if (overlapRatio >= 0.6) {
                cluster.variants.push(q.keyword);
                merged = true;
                break;
            }
        }

        if (!merged) {
            clusters.push({ head: q, variants: [q.keyword] });
        }
    }

    return clusters;
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

        const seen = new Set<string>();
        const suggestions: KeywordSuggestion[] = [];

        function addSuggestion(s: KeywordSuggestion) {
            const key = s.keyword.toLowerCase().trim();
            if (seen.has(key)) return;
            seen.add(key);
            suggestions.push(s);
        }

        try {
            const accessToken = await getUserGscToken(userId);
            const raw = await fetchGSCKeywords(
                accessToken,
                normaliseSiteUrl(site.domain),
                90,
                500
            );
            const gscKeywords: RawGscKeyword[] = raw.slice(0, 300);

            // 1. Semantic Query Clustering
            const clusters = clusterGscQueries(gscKeywords);

            // 2. Pass each cluster through Page Existence Resolver
            for (const cluster of clusters) {
                if (suggestions.length >= 12) break;

                const head = cluster.head;
                const headKey = head.keyword.toLowerCase().trim();

                // Run Page Existence Resolver
                const existence = await resolvePageExistence(site.id, head.keyword, cluster.variants);

                if (existence.verdict === "MISSING") {
                    addSuggestion({
                        keyword: head.keyword.slice(0, 200),
                        impressions: head.impressions,
                        position: Math.round(head.position),
                        reason: `${head.impressions.toLocaleString()} searches/mo — no page exists targeting this topic cluster (${cluster.variants.length} query variants)`,
                        source: head.position > GSC_RULES.buriedPosition ? "gsc_gap" : "no_content",
                        clusterQueries: cluster.variants,
                        verdict: "MISSING",
                        recommendedAction: "CREATE_NEW_CONTENT",
                        existingPageUrl: null,
                        actionType: "CREATE_PAGE",
                    });
                } else if (
                    existence.verdict === "EXISTING_NEEDS_FIX" ||
                    existence.verdict === "EXISTING_CANNIBALIZED"
                ) {
                    addSuggestion({
                        keyword: head.keyword.slice(0, 200),
                        impressions: head.impressions,
                        position: Math.round(head.position),
                        reason: `Existing page (${existence.existingPage?.url || "matched"}) ranks #${head.position} — recommend: ${existence.recommendedAction || "OPTIMIZE"}`,
                        source: "gsc_gap",
                        clusterQueries: cluster.variants,
                        verdict: existence.verdict,
                        recommendedAction: existence.recommendedAction,
                        existingPageUrl: existence.existingPage?.url || null,
                        actionType: "UPDATE_PAGE",
                    });
                }
            }
        } catch (err) {
            const msg = (err as Error)?.message ?? "";
            if (!msg.includes("GSC_NOT_CONNECTED") && !msg.includes("GSC_REFRESH_TOKEN_MISSING")) {
                logger.warn("[KeywordSuggest] GSC fetch/resolver failed", { error: msg });
            }
        }

        // Fallback: Competitor Keyword Gaps
        if (suggestions.length < 8) {
            try {
                const compKeywords = await prisma.competitorKeyword.findMany({
                    where: { competitor: { siteId: site.id } },
                    orderBy: { searchVolume: "desc" },
                    take: 20,
                    select: { keyword: true, searchVolume: true, difficulty: true },
                });

                for (const ck of compKeywords) {
                    const existence = await resolvePageExistence(site.id, ck.keyword, []);
                    if (existence.verdict === "MISSING") {
                        addSuggestion({
                            keyword: ck.keyword.slice(0, 200),
                            impressions: ck.searchVolume ?? 0,
                            position: 0,
                            reason: "Competitor ranks for this topic — no page on your site targets it yet",
                            source: "competitor_gap",
                            clusterQueries: [ck.keyword],
                            verdict: "MISSING",
                            recommendedAction: "CREATE_NEW_CONTENT",
                            existingPageUrl: null,
                            actionType: "CREATE_PAGE",
                        });
                    }

                    if (suggestions.length >= 10) break;
                }
            } catch (err) {
                logger.warn("[KeywordSuggest] Competitor fetch failed", { error: (err as Error)?.message });
            }
        }

        const ordered = [
            ...suggestions.filter((s) => s.actionType === "CREATE_PAGE" && s.source === "gsc_gap"),
            ...suggestions.filter((s) => s.actionType === "CREATE_PAGE" && s.source === "no_content"),
            ...suggestions.filter((s) => s.actionType === "UPDATE_PAGE"),
            ...suggestions.filter((s) => s.source === "competitor_gap"),
        ].slice(0, 10);

        return { success: true, suggestions: ordered };
    } catch (error: unknown) {
        logger.error("[KeywordSuggest] Failed:", { error: (error as Error)?.message || String(error) });
        return { success: false, suggestions: [], error: "Failed to fetch keyword suggestions" };
    }
}