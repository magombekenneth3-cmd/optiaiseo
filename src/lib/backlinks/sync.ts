/**
 * One canonical backlink synchronization pipeline used by both the dashboard
 * refresh and the scheduled worker.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isConfigured } from "./client";
import { bustBacklinkCache } from "./cache";
import { normaliseBacklinkDomain } from "./domain";
import { getBacklinkDetails } from "./index";
import { getReferringDomainSnapshot } from "./referring-domains";
import { analyseAndStoreBacklinks } from "./quality-analysis";
import { reconcileBacklinkAlerts, type BacklinkAlertReconciliation } from "./alerts";

const DEFAULT_DETAIL_LIMIT = 1000;
// Referring domains are paged by the provider. Five pages is a useful default
// for monitoring while keeping weekly provider spend bounded; deployments with
// larger profiles can raise this cap deliberately.
const configuredReferringDomainLimit = Number(
    process.env.BACKLINK_REFERRING_DOMAIN_SYNC_LIMIT ?? 5000,
);
const DEFAULT_REFERRING_DOMAIN_LIMIT = Number.isFinite(configuredReferringDomainLimit)
    ? Math.max(1, Math.min(20_000, Math.floor(configuredReferringDomainLimit)))
    : 5000;

function boundedDetailLimit(value: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1, Math.min(1000, Math.floor(value)));
}

function boundedReferringDomainLimit(value: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1, Math.min(20_000, Math.floor(value)));
}

export interface BacklinkSyncOptions {
    detailLimit?: number;
    referringDomainLimit?: number;
    targetKeyword?: string | null;
    observedAt?: Date;
}

export interface BacklinkSyncResult {
    domain: string;
    detailsFetched: number;
    detailsStored: number;
    toxic: number;
    alerts: BacklinkAlertReconciliation;
    providerConfigured: boolean;
}

/**
 * Fetch fresh provider observations, save link-level details, then reconcile a
 * separate referring-domain inventory. Cache eviction is deliberate: a user
 * clicking Refresh and a weekly monitor must not analyse an old cached page.
 */
export async function syncBacklinkProfile(
    siteId: string,
    inputDomain: string,
    options: BacklinkSyncOptions = {},
): Promise<BacklinkSyncResult> {
    const domain = normaliseBacklinkDomain(inputDomain);
    if (!domain) throw new Error("A valid domain is required for backlink sync.");

    if (!isConfigured()) {
        return {
            domain,
            detailsFetched: 0,
            detailsStored: 0,
            toxic: 0,
            alerts: {
                gained: 0,
                lost: 0,
                baseline: false,
                partial: true,
                gainedDomains: [],
                lostDomains: [],
            },
            providerConfigured: false,
        };
    }

    const observedAt = options.observedAt ?? new Date();
    const [site, ignored] = await Promise.all([
        options.targetKeyword === undefined
            ? prisma.site.findUnique({
                where: { id: siteId },
                select: { targetKeyword: true },
            })
            : Promise.resolve(null),
        bustBacklinkCache(domain),
    ]);
    void ignored;

    const [details, referringDomains] = await Promise.all([
        getBacklinkDetails(
            domain,
            boundedDetailLimit(options.detailLimit ?? DEFAULT_DETAIL_LIMIT, DEFAULT_DETAIL_LIMIT),
        ),
        getReferringDomainSnapshot(
            domain,
            boundedReferringDomainLimit(
                options.referringDomainLimit ?? DEFAULT_REFERRING_DOMAIN_LIMIT,
                DEFAULT_REFERRING_DOMAIN_LIMIT,
            ),
        ),
    ]);

    const stored = await analyseAndStoreBacklinks(
        siteId,
        details.map((detail) => ({
            srcDomain: detail.sourceDomain,
            sourceUrl: detail.sourceUrl,
            targetUrl: detail.targetUrl,
            anchorText: detail.anchorText,
            domainRating: detail.domainRating,
            isDoFollow: detail.isDoFollow,
            spamScore: detail.spamScore,
            firstSeen: detail.firstSeen ? new Date(detail.firstSeen) : undefined,
            lastSeen: detail.lastSeen ? new Date(detail.lastSeen) : undefined,
            status: detail.status,
        })),
        {
            targetKeyword: options.targetKeyword ?? site?.targetKeyword ?? null,
            observedAt,
        },
    );
    const alerts = await reconcileBacklinkAlerts(siteId, referringDomains, observedAt);

    logger.info("[Backlinks] Sync complete", {
        siteId,
        domain,
        detailsFetched: details.length,
        detailsStored: stored.total,
        toxic: stored.toxic,
        gained: alerts.gained,
        lost: alerts.lost,
        partialDomainInventory: alerts.partial,
    });

    return {
        domain,
        detailsFetched: details.length,
        detailsStored: stored.total,
        toxic: stored.toxic,
        alerts,
        providerConfigured: true,
    };
}
