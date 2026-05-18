/**
 * Backlink data access layer — DataForSEO-backed, Redis-cached.
 *
 * All public functions use the shared DataForSEO client (./client.ts)
 * and the Redis cache helper (./cache.ts) so every caller gets
 * deduplicated, rate-limited, cached data automatically.
 */

import { logger } from "@/lib/logger";
import { getReferringDomains } from "./referring-domains";
import { isConfigured, dataForSeoPost } from "./client";
import { withBacklinkCache, cacheKeys, BACKLINK_CACHE_TTL } from "./cache";
import type {
    BacklinkSummary,
    BacklinkDetail,
    BacklinkMetricGap,
    BacklinkGapReport,
} from "@/types/backlinks";
import { prisma } from "@/lib/prisma";

// Re-export shared types so existing import paths keep working
export type { BacklinkSummary, BacklinkDetail, BacklinkMetricGap, BacklinkGapReport };

// ─── Summary ──────────────────────────────────────────────────────────────────

const EMPTY_SUMMARY: BacklinkSummary = {
    totalBacklinks:   0,
    referringDomains: 0,
    domainRating:     0,
    drDelta30d:       null,
    newLastWeek:      0,
    lostLastWeek:     0,
    doFollowRatio:    0,
    topLinkedPage:    null,
    topAnchors:       [],
    brokenBacklinks:  0,
    toxicCount:       0,
    avgReferringDR:   null,
};

/**
 * Fetch a high-level backlink summary for `domain`.
 *
 * @param domain  - bare hostname, e.g. "acme.com"
 * @param siteId  - when provided, the real toxic count is read from the DB
 *                  (free of DataForSEO cost) and merged into the result.
 */
export async function getBacklinkSummary(
    domain: string,
    siteId?: string,
): Promise<BacklinkSummary> {
    if (!isConfigured()) {
        logger.warn("[Backlinks] DataForSEO credentials not configured — returning empty summary.");
        return { ...EMPTY_SUMMARY };
    }

    const liveData = await withBacklinkCache(
        cacheKeys.summary(domain),
        BACKLINK_CACHE_TTL.summary,
        async () => {
            try {
                const data = await dataForSeoPost<Record<string, unknown>>(
                    "/backlinks/summary/live",
                    [{ target: domain, include_subdomains: true }],
                );
                const result = (data as any)?.tasks?.[0]?.result?.[0];

                if (!result) throw new Error("Empty result from DataForSEO");

                return {
                    totalBacklinks:   result.backlinks          ?? 0,
                    referringDomains: result.referring_domains  ?? 0,
                    domainRating:     result.rank               ?? 0,
                    drDelta30d:       null,     // computed below from DB
                    newLastWeek:      result.new_backlinks_7d   ?? 0,
                    lostLastWeek:     result.lost_backlinks_7d  ?? 0,
                    doFollowRatio:    0,         // computed below from DB
                    topLinkedPage:    null,       // computed below from DB
                    topAnchors:       (result.anchors ?? []).slice(0, 10).map((a: any) => ({
                        anchor: a.anchor,
                        count:  a.backlinks,
                    })),
                    brokenBacklinks:  result.broken_backlinks   ?? 0,
                    toxicCount:       0,         // overwritten below if siteId provided
                    avgReferringDR:   null,       // computed below from DB
                } satisfies BacklinkSummary;
            } catch (err) {
                logger.error("[Backlinks] Failed to fetch backlink summary", {
                    domain, error: String(err),
                });
                return { ...EMPTY_SUMMARY };
            }
        },
    );

    // Pull enriched metrics from DB — zero DataForSEO cost, always fresh.
    if (siteId) {
        try {
            const [toxicCount, totalCount, doFollowCount, avgResult, topPage] = await Promise.all([
                prisma.backlinkDetail.count({ where: { siteId, isToxic: true } }),
                prisma.backlinkDetail.count({ where: { siteId } }),
                prisma.backlinkDetail.count({ where: { siteId, isDoFollow: true } }),
                prisma.backlinkDetail.aggregate({ where: { siteId, domainRating: { not: null } }, _avg: { domainRating: true } }),
                prisma.backlinkDetail.groupBy({
                    by: ["targetUrl"],
                    where: { siteId, targetUrl: { not: "" } },
                    _count: { id: true },
                    orderBy: { _count: { id: "desc" } },
                    take: 1,
                }),
            ]);

            liveData.toxicCount = toxicCount;
            liveData.doFollowRatio = totalCount > 0 ? Math.round((doFollowCount / totalCount) * 100) : 0;
            liveData.avgReferringDR = avgResult._avg.domainRating != null ? Math.round(avgResult._avg.domainRating) : null;
            liveData.topLinkedPage = topPage.length > 0 ? topPage[0].targetUrl : null;
        } catch (err) {
            logger.warn("[Backlinks] Failed to read enriched metrics from DB", { siteId, error: String(err) });
        }
    }

    return liveData;
}

// ─── Details ─────────────────────────────────────────────────────────────────

/**
 * Fetch individual backlink records for `domain`.
 * Results are cached for 6 hours — callers should not call this on every request.
 */
export async function getBacklinkDetails(
    domain: string,
    limit = 100,
): Promise<BacklinkDetail[]> {
    if (!isConfigured()) {
        logger.warn("[Backlinks] DataForSEO credentials not configured — returning empty list.");
        return [];
    }

    return withBacklinkCache(
        cacheKeys.details(domain),
        BACKLINK_CACHE_TTL.details,
        async () => {
            try {
                const data = await dataForSeoPost<Record<string, unknown>>(
                    "/backlinks/backlinks/live",
                    [{
                        target:      domain,
                        limit,
                        order_by:    ["rank,desc"],
                        filters:     ["dofollow,=,true"],
                    }],
                );
                const items = (data as any)?.tasks?.[0]?.result?.[0]?.items ?? [];

                return items.map((item: any): BacklinkDetail => ({
                    sourceUrl:    item.url_from   ?? "",
                    targetUrl:    item.url_to     ?? "",
                    anchorText:   item.anchor     ?? "",
                    domainRating: item.rank       ?? 0,
                    firstSeen:    item.first_seen ?? "",
                    isToxic:      (item.spam_score ?? 0) > 60,
                }));
            } catch (err) {
                logger.error("[Backlinks] Failed to fetch backlink details", {
                    domain, error: String(err),
                });
                return [];
            }
        },
    );
}

// ─── Competitor gap ───────────────────────────────────────────────────────────

/**
 * Compare the backlink profile of `yourDomain` against `competitorDomain`.
 * Fetches both summaries concurrently, then finds referring domains the
 * competitor has that you don't — warm outreach targets.
 *
 * Returns a full BacklinkGapReport even when DataForSEO is unconfigured
 * (all metrics will be zero — callers should check you.totalBacklinks > 0).
 */
export async function getCompetitorBacklinkGap(
    yourDomain: string,
    competitorDomain: string,
    maxOpportunities = 20,
): Promise<BacklinkGapReport> {
    const [you, competitor] = await Promise.all([
        getBacklinkSummary(yourDomain),
        getBacklinkSummary(competitorDomain),
    ]);

    let opportunityDomains: { domain: string; dr: number }[] = [];

    if (isConfigured()) {
        try {
            const [yourRD, competitorRD] = await Promise.all([
                getReferringDomains(yourDomain),
                getReferringDomains(competitorDomain),
            ]);

            const yourSet = new Set(yourRD.map((r) => r.srcDomain.toLowerCase()));

            opportunityDomains = competitorRD
                .filter((r) => !yourSet.has(r.srcDomain.toLowerCase()))
                .sort((a, b) => b.dr - a.dr)
                .slice(0, maxOpportunities)
                .map((r) => ({ domain: r.srcDomain, dr: r.dr }));  // Bug 5: include DR
        } catch (err) {
            // Non-fatal: gap report still returns with gap metrics intact.
            logger.warn("[Backlinks] getCompetitorBacklinkGap — referring domain fetch failed", {
                yourDomain, competitorDomain, error: (err as Error).message,
            });
        }
    }

    const gap: BacklinkMetricGap = {
        totalBacklinks:    competitor.totalBacklinks   - you.totalBacklinks,
        referringDomains:  competitor.referringDomains - you.referringDomains,
        domainRating:      competitor.domainRating     - you.domainRating,
        opportunityDomains,
    };

    logger.info("[Backlinks] Gap report computed", {
        yourDomain,
        competitorDomain,
        yourRD:       you.referringDomains,
        competitorRD: competitor.referringDomains,
        gapRD:        gap.referringDomains,
        opportunities: opportunityDomains.length,
    });

    return {
        yourDomain,
        competitorDomain,
        you,
        competitor,
        gap,
        fetchedAt: new Date().toISOString(),
    };
}