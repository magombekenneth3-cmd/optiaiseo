/**
 * Backlink data access layer — DataForSEO-backed and Redis-cached.
 *
 * Provider parsing lives in provider.ts. This module only combines documented
 * summary fields with the richer link-level facts held in our own database.
 */

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { classifyError, type ProviderStatus } from "@/lib/aeo/provider-result";
import { getReferringDomains } from "./referring-domains";
import { isConfigured, dataForSeoPost } from "./client";
import { withBacklinkCache, cacheKeys, BACKLINK_CACHE_TTL } from "./cache";
import { normaliseBacklinkDomain } from "./domain";
import {
    getDataForSeoFirstResult,
    parseDataForSeoBacklink,
    parseDataForSeoSummary,
} from "./provider";
import type {
    BacklinkSummary,
    BacklinkDetail,
    BacklinkMetricGap,
    BacklinkGapReport,
} from "@/types/backlinks";

export type { BacklinkSummary, BacklinkDetail, BacklinkMetricGap, BacklinkGapReport };

const EMPTY_SUMMARY: BacklinkSummary = {
    totalBacklinks: 0,
    referringDomains: 0,
    domainRating: 0,
    drDelta30d: null,
    newLastWeek: 0,
    lostLastWeek: 0,
    doFollowRatio: null,
    topLinkedPage: null,
    topAnchors: [],
    brokenBacklinks: 0,
    toxicCount: 0,
    avgReferringDR: null,
    providerStatus: "NO_API_KEY",
};

function statusForError(error: unknown): ProviderStatus {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Circuit is OPEN") ? "CIRCUIT_OPEN" : classifyError(error);
}

function boundedLimit(limit: number): number {
    if (!Number.isFinite(limit)) return 100;
    return Math.max(1, Math.min(1000, Math.floor(limit)));
}

/**
 * Fetch a high-level backlink summary for a domain. Summary does not expose
 * anchors, weekly changes, or dofollow ratio; those values are calculated from
 * persisted link observations when a siteId is supplied.
 */
export async function getBacklinkSummary(
    inputDomain: string,
    siteId?: string,
): Promise<BacklinkSummary> {
    const domain = normaliseBacklinkDomain(inputDomain);
    if (!domain) {
        logger.warn("[Backlinks] Invalid domain supplied for summary", { inputDomain });
        return { ...EMPTY_SUMMARY, providerStatus: "PROVIDER_ERROR" };
    }

    let liveData: BacklinkSummary = { ...EMPTY_SUMMARY };
    if (!isConfigured()) {
        logger.warn("[Backlinks] DataForSEO credentials not configured — using stored enrichment only.");
    } else {
        try {
            liveData = await withBacklinkCache(
                cacheKeys.summary(domain),
                BACKLINK_CACHE_TTL.summary,
                async () => {
                    const data = await dataForSeoPost<unknown>(
                        "/backlinks/summary/live",
                        [{
                            target: domain,
                            include_subdomains: true,
                            rank_scale: "one_hundred",
                        }],
                    );
                    const result = getDataForSeoFirstResult(data);
                    if (!result) throw new Error("Empty result from DataForSEO");

                    const parsed = parseDataForSeoSummary(result);
                    return {
                        ...EMPTY_SUMMARY,
                        ...parsed,
                        providerStatus: "SUCCESS",
                    };
                },
            );
        } catch (error) {
            logger.error("[Backlinks] Failed to fetch backlink summary", {
                domain,
                error: error instanceof Error ? error.message : String(error),
            });
            liveData = { ...EMPTY_SUMMARY, providerStatus: statusForError(error) };
        }
    }

    if (!siteId) return liveData;

    try {
        const active = { siteId, status: "active" };
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const [toxicCount, totalCount, doFollowCount, avgResult, topPage, topAnchors, alertGroups] = await Promise.all([
            prisma.backlinkDetail.count({ where: { ...active, isToxic: true } }),
            prisma.backlinkDetail.count({ where: active }),
            prisma.backlinkDetail.count({ where: { ...active, isDoFollow: true } }),
            prisma.backlinkDetail.aggregate({
                where: { ...active, domainRating: { not: null } },
                _avg: { domainRating: true },
            }),
            prisma.backlinkDetail.groupBy({
                by: ["targetUrl"],
                where: { ...active, targetUrl: { not: "" } },
                _count: { id: true },
                orderBy: { _count: { id: "desc" } },
                take: 1,
            }),
            prisma.backlinkDetail.groupBy({
                by: ["anchorText"],
                where: { ...active, anchorText: { not: "" } },
                _count: { id: true },
                orderBy: { _count: { id: "desc" } },
                take: 10,
            }),
            prisma.backlinkAlert.groupBy({
                by: ["type"],
                where: { siteId, detectedAt: { gte: weekAgo } },
                _count: { id: true },
            }),
        ]);

        const changes = new Map(alertGroups.map((group) => [group.type, group._count.id]));
        liveData.toxicCount = toxicCount;
        liveData.doFollowRatio = totalCount > 0
            ? Math.round((doFollowCount / totalCount) * 100)
            : null;
        liveData.avgReferringDR = avgResult._avg.domainRating != null
            ? Math.round(avgResult._avg.domainRating)
            : null;
        liveData.topLinkedPage = topPage[0]?.targetUrl ?? null;
        liveData.topAnchors = topAnchors.map((anchor) => ({
            anchor: anchor.anchorText,
            count: anchor._count.id,
        }));
        liveData.newLastWeek = changes.get("gained") ?? 0;
        liveData.lostLastWeek = changes.get("lost") ?? 0;
    } catch (error) {
        logger.warn("[Backlinks] Failed to read stored backlink enrichments", {
            siteId,
            error: error instanceof Error ? error.message : String(error),
        });
    }

    return liveData;
}

/**
 * Fetch individual backlink records for a domain. The request explicitly uses
 * the 0–100 rank scale and retains both dofollow and nofollow links.
 */
export async function getBacklinkDetails(
    inputDomain: string,
    requestedLimit = 100,
): Promise<BacklinkDetail[]> {
    const domain = normaliseBacklinkDomain(inputDomain);
    if (!domain) throw new Error("A valid domain is required for backlink lookup.");

    if (!isConfigured()) {
        logger.warn("[Backlinks] DataForSEO credentials not configured — returning no backlink details.");
        return [];
    }

    const limit = boundedLimit(requestedLimit);
    return withBacklinkCache(
        cacheKeys.details(domain, limit),
        BACKLINK_CACHE_TTL.details,
        async () => {
            try {
                const data = await dataForSeoPost<unknown>(
                    "/backlinks/backlinks/live",
                    [{
                        target: domain,
                        include_subdomains: true,
                        exclude_internal_backlinks: true,
                        backlinks_status_type: "live",
                        limit,
                        order_by: ["domain_from_rank,desc"],
                        rank_scale: "one_hundred",
                    }],
                );
                const result = getDataForSeoFirstResult(data);
                if (!result) throw new Error("Empty result from DataForSEO");

                const items = Array.isArray(result.items) ? result.items : [];
                return items
                    .map((item) => parseDataForSeoBacklink(
                        item !== null && typeof item === "object" && !Array.isArray(item)
                            ? item as Record<string, unknown>
                            : {},
                    ))
                    .filter((item) => item.sourceDomain.length > 0);
            } catch (error) {
                logger.error("[Backlinks] Failed to fetch backlink details", {
                    domain,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        },
    );
}

/**
 * Compare profiles and return high-authority domains that link to the
 * competitor but not to the current site.
 */
export async function getCompetitorBacklinkGap(
    yourInputDomain: string,
    competitorInputDomain: string,
    maxOpportunities = 20,
): Promise<BacklinkGapReport> {
    const yourDomain = normaliseBacklinkDomain(yourInputDomain);
    const competitorDomain = normaliseBacklinkDomain(competitorInputDomain);
    if (!yourDomain || !competitorDomain) {
        throw new Error("Enter valid domains for backlink gap analysis.");
    }

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
            const yourSet = new Set(yourRD.map((row) => row.srcDomain));
            const maximum = Math.max(1, Math.min(100, Math.floor(maxOpportunities)));

            opportunityDomains = competitorRD
                .filter((row) => !yourSet.has(row.srcDomain))
                .sort((left, right) => right.domainRating - left.domainRating)
                .slice(0, maximum)
                .map((row) => ({ domain: row.srcDomain, dr: row.domainRating }));
        } catch (error) {
            logger.warn("[Backlinks] Referring-domain gap lookup failed", {
                yourDomain,
                competitorDomain,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    const gap: BacklinkMetricGap = {
        totalBacklinks: competitor.totalBacklinks - you.totalBacklinks,
        referringDomains: competitor.referringDomains - you.referringDomains,
        domainRating: competitor.domainRating - you.domainRating,
        opportunityDomains,
    };

    return {
        yourDomain,
        competitorDomain,
        you,
        competitor,
        gap,
        fetchedAt: new Date().toISOString(),
    };
}
