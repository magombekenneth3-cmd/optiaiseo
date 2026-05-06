/**
 * Referring-domain fetcher — used by the gap analysis and cron alert detector.
 * Uses the shared DataForSEO client (./client.ts) and Redis cache (./cache.ts).
 */

import { logger } from "@/lib/logger";
import { isConfigured, dataForSeoPost } from "./client";
import { withBacklinkCache, cacheKeys, BACKLINK_CACHE_TTL } from "./cache";

export interface BacklinkRow {
    srcDomain:  string;
    anchorText: string;
    dr:         number;
    doFollow:   boolean;
    firstSeen:  Date;
    lastSeen:   Date;
}

export async function getReferringDomains(domain: string): Promise<BacklinkRow[]> {
    if (!isConfigured()) {
        logger.warn("[Backlinks] DataForSEO not configured — returning empty referring domains.");
        return [];
    }

    return withBacklinkCache(
        cacheKeys.referringDomains(domain),
        BACKLINK_CACHE_TTL.referringDomains,
        async () => {
            try {
                const data = await dataForSeoPost<Record<string, unknown>>(
                    "/backlinks/referring_domains/live",
                    [{
                        target:             domain,
                        include_subdomains: true,
                        limit:              200,
                        order_by:           ["rank,desc"],
                        filters:            [["is_dofollow", "=", true]],
                    }],
                );

                const items: Record<string, unknown>[] =
                    (data as any)?.tasks?.[0]?.result?.[0]?.items ?? [];

                return items.map((item): BacklinkRow => ({
                    srcDomain:  String(item.domain   ?? ""),
                    anchorText: String(item.anchor   ?? ""),
                    dr:         Number(item.rank     ?? 0),
                    doFollow:   Boolean(item.is_dofollow ?? true),
                    firstSeen:  new Date(String(item.first_seen ?? new Date())),
                    lastSeen:   new Date(String(item.last_seen  ?? new Date())),
                }));
            } catch (err) {
                logger.error("[Backlinks] getReferringDomains failed", {
                    domain, error: (err as Error).message,
                });
                return [];
            }
        },
    );
}
