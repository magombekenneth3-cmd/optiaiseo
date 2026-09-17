/**
 * Referring-domain fetcher for gap analysis and change detection.
 *
 * The referring-domains endpoint is domain-level data. It intentionally does
 * not manufacture anchor text or dofollow state, which only exist on individual
 * backlink records.
 */

import { logger } from "@/lib/logger";
import { isConfigured, dataForSeoPost } from "./client";
import { withBacklinkCache, cacheKeys, BACKLINK_CACHE_TTL } from "./cache";
import { normaliseBacklinkDomain } from "./domain";
import {
    getDataForSeoFirstResult,
    parseDataForSeoReferringDomain,
    type ReferringDomainRow,
} from "./provider";

export type { ReferringDomainRow };

export interface ReferringDomainSnapshot {
    rows: ReferringDomainRow[];
    totalCount: number;
    /**
     * We only emit gained/lost alerts from a complete inventory. A ranked
     * first-page sample is useful for gap analysis, but unsafe for loss alerts.
     */
    isComplete: boolean;
}

const PROVIDER_PAGE_LIMIT = 1000;
const MAX_RESULT_LIMIT = 20_000;

/**
 * `limit` is the maximum number of domains the caller is prepared to retrieve,
 * not the provider's per-request page size. DataForSEO permits pages of 1000
 * plus an offset, so monitoring can obtain a real inventory while a gap preview
 * can deliberately remain a one-page sample.
 */
function boundedResultLimit(limit: number): number {
    if (!Number.isFinite(limit)) return PROVIDER_PAGE_LIMIT;
    return Math.max(1, Math.min(MAX_RESULT_LIMIT, Math.floor(limit)));
}

/**
 * Fetch a bounded referring-domain inventory. The provider is paged in chunks
 * of 1000; `isComplete` is false when the configured cap was reached, and that
 * result must never be used to infer losses.
 */
export async function getReferringDomainSnapshot(
    inputDomain: string,
    requestedLimit = 1000,
): Promise<ReferringDomainSnapshot> {
    const domain = normaliseBacklinkDomain(inputDomain);
    if (!domain) throw new Error("A valid domain is required for backlink lookup.");

    if (!isConfigured()) {
        logger.warn("[Backlinks] DataForSEO not configured — referring-domain lookup skipped.");
        return { rows: [], totalCount: 0, isComplete: false };
    }

    const resultLimit = boundedResultLimit(requestedLimit);
    return withBacklinkCache(
        cacheKeys.referringDomains(domain, resultLimit),
        BACKLINK_CACHE_TTL.referringDomains,
        async () => {
            try {
                const rowsByDomain = new Map<string, ReferringDomainRow>();
                let totalCount: number | null = null;

                for (let offset = 0; offset < resultLimit; offset += PROVIDER_PAGE_LIMIT) {
                    const pageSize = Math.min(PROVIDER_PAGE_LIMIT, resultLimit - offset);
                    const data = await dataForSeoPost<unknown>(
                        "/backlinks/referring_domains/live",
                        [{
                            target: domain,
                            include_subdomains: true,
                            exclude_internal_backlinks: true,
                            backlinks_status_type: "live",
                            limit: pageSize,
                            offset,
                            order_by: ["rank,desc"],
                            rank_scale: "one_hundred",
                        }],
                    );

                    const result = getDataForSeoFirstResult(data);
                    if (!result) throw new Error("Empty result from DataForSEO");

                    const items = Array.isArray(result.items) ? result.items : [];
                    const pageRows = items
                        .map((item) => parseDataForSeoReferringDomain(
                            item !== null && typeof item === "object" && !Array.isArray(item)
                                ? item as Record<string, unknown>
                                : {},
                        ))
                        .filter((item) => item.srcDomain.length > 0);
                    for (const row of pageRows) rowsByDomain.set(row.srcDomain, row);

                    if (totalCount === null) {
                        totalCount = typeof result.total_count === "number" && Number.isFinite(result.total_count)
                            ? result.total_count
                            : pageRows.length;
                    }

                    if (rowsByDomain.size >= totalCount || items.length < pageSize) break;
                }

                const rows = [...rowsByDomain.values()];
                const resolvedTotalCount = totalCount ?? rows.length;

                return {
                    rows,
                    totalCount: resolvedTotalCount,
                    isComplete: resolvedTotalCount <= rows.length,
                };
            } catch (error) {
                logger.error("[Backlinks] Referring-domain lookup failed", {
                    domain,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        },
    );
}

/** Convenience view for gap analysis, where a ranked sample is acceptable. */
export async function getReferringDomains(
    domain: string,
    limit = 1000,
): Promise<ReferringDomainRow[]> {
    return (await getReferringDomainSnapshot(domain, limit)).rows;
}
