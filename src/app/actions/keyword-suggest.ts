"use server";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchGSCKeywords, normaliseSiteUrl } from "@/lib/gsc";
import { getUserGscToken } from "@/lib/gsc/token";
import { resolvePageExistenceBatch, type PageExistenceVerdict } from "@/lib/opportunity-engine/page-existence-resolver";
import {
    clusterGscQueries,
    inferQueryIntent,
    isViableGscTopicQuery,
    formatRecommendedActionLabel,
    formatUrlPathForDisplay,
    scoreKeywordOpportunity,
    type GscTopicCluster,
    type RawGscKeyword,
} from "@/lib/gsc/topic-cluster";

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
    gscImpressions90d?: number;
    searchVolume?: number;
    difficulty?: number;
    intent?: "Informational" | "Commercial" | "Transactional" | "Navigational";
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

        // Gather all candidates for batch page existence resolution
        let gscClusters: GscTopicCluster[] = [];
        let competitorKeywords: { keyword: string; searchVolume: number | null; difficulty: number | null }[] = [];

        try {
            const accessToken = await getUserGscToken(userId);
            const { resolveGscProperty } = await import("@/lib/gsc/property-resolver");
            const resolution = await resolveGscProperty(userId, accessToken, site.domain);
            const propertyUrl = resolution?.property ?? normaliseSiteUrl(site.domain);
            const raw = await fetchGSCKeywords(
                accessToken,
                propertyUrl,
                90,
                500
            );
            // Filter out operator dorks, URLs, gibberish, and self-brand queries before clustering
            const gscKeywords: RawGscKeyword[] = [...raw]
                .filter((k) => isViableGscTopicQuery(k.keyword, site.domain))
                .sort((a, b) => b.impressions - a.impressions)
                .slice(0, 300);
            gscClusters = clusterGscQueries(gscKeywords).slice(0, 25);
        } catch (err) {
            const msg = (err as Error)?.message ?? "";
            if (!msg.includes("GSC_NOT_CONNECTED") && !msg.includes("GSC_REFRESH_TOKEN_MISSING")) {
                logger.warn("[KeywordSuggest] GSC fetch failed", { error: msg });
            }
        }

        try {
            const rawCompetitorKeywords = await prisma.competitorKeyword.findMany({
                where: { competitor: { siteId: site.id, deletedAt: null } },
                orderBy: { searchVolume: "desc" },
                take: 30,
                select: { keyword: true, searchVolume: true, difficulty: true },
            });
            competitorKeywords = rawCompetitorKeywords
                .filter((ck) => isViableGscTopicQuery(ck.keyword, site.domain))
                .slice(0, 20);
        } catch (err) {
            logger.warn("[KeywordSuggest] Competitor fetch failed", { error: (err as Error)?.message });
        }

        // Build single topics payload for zero-N+1 batch resolution
        const batchTopicsPayload = [
            ...gscClusters.map((c) => ({ keyword: c.head.keyword, clusterQueries: c.variants })),
            ...competitorKeywords.map((ck) => ({ keyword: ck.keyword, clusterQueries: [ck.keyword] })),
        ];

        // 1 Batch DB Call
        const existenceMap = await resolvePageExistenceBatch(site.id, batchTopicsPayload);

        // Process GSC Clusters
        for (const cluster of gscClusters) {
            if (suggestions.length >= 16) break;
            const head = cluster.head;
            const key = head.keyword.toLowerCase().trim();
            const existence = existenceMap.get(key);
            if (!existence) continue;

            const wordCount = head.keyword.trim().split(/\s+/).length;
            const clusterImpressions = cluster.totalImpressions || head.impressions;
            const roundedPos = Math.max(1, Math.round(cluster.avgPosition || head.position));

            if (existence.verdict === "MISSING") {
                // Skip queries already ranking #1-#3 on tiny impressions or ambiguous 1-word micro-queries
                if (roundedPos <= 3 && clusterImpressions < 30) continue;
                if (wordCount === 1 && clusterImpressions < 15) continue;

                const variantSuffix =
                    cluster.variants.length > 1
                        ? ` · Covers ${cluster.variants.length} related queries`
                        : "";
                addSuggestion({
                    keyword: head.keyword.slice(0, 200),
                    impressions: clusterImpressions,
                    position: roundedPos,
                    reason: `No dedicated page targets this topic yet${variantSuffix}`,
                    source: roundedPos > GSC_RULES.buriedPosition ? "gsc_gap" : "no_content",
                    clusterQueries: cluster.variants,
                    verdict: "MISSING",
                    recommendedAction: "CREATE_NEW_CONTENT",
                    existingPageUrl: null,
                    actionType: "CREATE_PAGE",
                    gscImpressions90d: clusterImpressions,
                    intent: cluster.intent,
                });
            } else if (
                existence.verdict === "EXISTING_NEEDS_FIX" ||
                existence.verdict === "EXISTING_CANNIBALIZED"
            ) {
                const actionLabel = formatRecommendedActionLabel(existence.recommendedAction, "UPDATE_PAGE");
                const pathLabel = formatUrlPathForDisplay(existence.existingPage?.url) || "existing page";
                addSuggestion({
                    keyword: head.keyword.slice(0, 200),
                    impressions: clusterImpressions,
                    position: roundedPos,
                    reason: `${actionLabel} on ${pathLabel}`,
                    source: "gsc_gap",
                    clusterQueries: cluster.variants,
                    verdict: existence.verdict,
                    recommendedAction: existence.recommendedAction,
                    existingPageUrl: existence.existingPage?.url || null,
                    actionType: "UPDATE_PAGE",
                    gscImpressions90d: clusterImpressions,
                    intent: cluster.intent,
                });
            }
        }

        // Process Competitor Keywords
        for (const ck of competitorKeywords) {
            if (suggestions.length >= 20) break;
            const key = ck.keyword.toLowerCase().trim();
            const existence = existenceMap.get(key);
            if (existence?.verdict === "MISSING") {
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
                    searchVolume: ck.searchVolume ?? undefined,
                    difficulty: ck.difficulty ?? undefined,
                    intent: inferQueryIntent(ck.keyword),
                });
            }
        }

        const ordered = [...suggestions]
            .sort((a, b) => {
                const scoreA = scoreKeywordOpportunity({
                    impressions: a.gscImpressions90d ?? a.impressions,
                    position: a.position,
                    searchVolume: a.searchVolume,
                    actionType: a.actionType,
                    wordCount: a.keyword.trim().split(/\s+/).length,
                });
                const scoreB = scoreKeywordOpportunity({
                    impressions: b.gscImpressions90d ?? b.impressions,
                    position: b.position,
                    searchVolume: b.searchVolume,
                    actionType: b.actionType,
                    wordCount: b.keyword.trim().split(/\s+/).length,
                });
                return scoreB - scoreA;
            })
            .slice(0, 12);

        return { success: true, suggestions: ordered };
    } catch (error: unknown) {
        logger.error("[KeywordSuggest] Failed:", { error: (error as Error)?.message || String(error) });
        return { success: false, suggestions: [], error: "Failed to fetch keyword suggestions" };
    }
}