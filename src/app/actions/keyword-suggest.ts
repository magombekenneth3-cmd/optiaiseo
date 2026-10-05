"use server";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchGSCKeywords, normaliseSiteUrl } from "@/lib/gsc";
import { getUserGscToken } from "@/lib/gsc/token";
import { resolvePageExistenceBatch, type PageExistenceVerdict } from "@/lib/opportunity-engine/page-existence-resolver";
import { clusterGscQueries, inferQueryIntent, type GscTopicCluster, type RawGscKeyword } from "@/lib/gsc/topic-cluster";

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
            const raw = await fetchGSCKeywords(
                accessToken,
                normaliseSiteUrl(site.domain),
                90,
                500
            );
            // Sort by impressions descending before slicing to ensure high-value keywords are prioritized
            const gscKeywords: RawGscKeyword[] = [...raw]
                .sort((a, b) => b.impressions - a.impressions)
                .slice(0, 300);
            gscClusters = clusterGscQueries(gscKeywords).slice(0, 20);
        } catch (err) {
            const msg = (err as Error)?.message ?? "";
            if (!msg.includes("GSC_NOT_CONNECTED") && !msg.includes("GSC_REFRESH_TOKEN_MISSING")) {
                logger.warn("[KeywordSuggest] GSC fetch failed", { error: msg });
            }
        }

        try {
            competitorKeywords = await prisma.competitorKeyword.findMany({
                where: { competitor: { siteId: site.id } },
                orderBy: { searchVolume: "desc" },
                take: 20,
                select: { keyword: true, searchVolume: true, difficulty: true },
            });
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
            if (suggestions.length >= 12) break;
            const head = cluster.head;
            const key = head.keyword.toLowerCase().trim();
            const existence = existenceMap.get(key);
            if (!existence) continue;

            if (existence.verdict === "MISSING") {
                addSuggestion({
                    keyword: head.keyword.slice(0, 200),
                    impressions: head.impressions,
                    position: Math.round(head.position),
                    reason: `${head.impressions.toLocaleString()} GSC impressions (90d) — no page targets this topic cluster (${cluster.variants.length} query variants)`,
                    source: head.position > GSC_RULES.buriedPosition ? "gsc_gap" : "no_content",
                    clusterQueries: cluster.variants,
                    verdict: "MISSING",
                    recommendedAction: "CREATE_NEW_CONTENT",
                    existingPageUrl: null,
                    actionType: "CREATE_PAGE",
                    gscImpressions90d: head.impressions,
                    intent: cluster.intent,
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
                    gscImpressions90d: head.impressions,
                    intent: cluster.intent,
                });
            }
        }

        // Process Competitor Keywords
        for (const ck of competitorKeywords) {
            if (suggestions.length >= 10) break;
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