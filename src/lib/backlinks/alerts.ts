/**
 * Referring-domain inventory reconciliation.
 *
 * Alerts are based on a complete domain inventory, never the bounded list of
 * link details. A partial provider page is useful for gap analysis but cannot
 * establish a baseline or prove that an existing domain was lost.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { ReferringDomainSnapshot } from "./referring-domains";

type AlertType = "gained" | "lost";

export interface BacklinkAlertReconciliation {
    /** Newly persisted transition events, not merely transitions re-observed on a retry. */
    gained: number;
    lost: number;
    /** True when this was the first complete inventory for the site. */
    baseline: boolean;
    /** True when the provider result exceeded the configured inventory cap. */
    partial: boolean;
    gainedDomains: { domain: string; dr: number | null }[];
    lostDomains: { domain: string; dr: number | null }[];
}

function emptyResult(overrides: Partial<BacklinkAlertReconciliation> = {}): BacklinkAlertReconciliation {
    return {
        gained: 0,
        lost: 0,
        baseline: false,
        partial: false,
        gainedDomains: [],
        lostDomains: [],
        ...overrides,
    };
}

function validDate(value: string | null | undefined, fallback: Date): Date {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date;
}

/**
 * A domain may be gained, lost, and gained again. Its previous active
 * observation is a stable identifier for that particular status transition;
 * it stays constant on an Inngest retry but changes after the domain returns.
 */
function transitionEventKey(type: AlertType, domain: string, priorActiveSeenAt: Date): string {
    return `${type}:${domain}:${priorActiveSeenAt.toISOString()}`;
}

/**
 * Store a complete referring-domain inventory and write durable transition
 * events. First complete scan establishes a baseline, including an empty
 * profile. The separate BacklinkInventory record is required because an empty
 * inventory otherwise cannot be distinguished from a site never scanned.
 */
export async function reconcileBacklinkAlerts(
    siteId: string,
    snapshot: ReferringDomainSnapshot,
    observedAt = new Date(),
): Promise<BacklinkAlertReconciliation> {
    if (!snapshot.isComplete) {
        logger.info("[Backlinks/Alerts] Partial inventory ignored for transitions", {
            siteId,
            observed: snapshot.rows.length,
            totalCount: snapshot.totalCount,
        });
        return emptyResult({ partial: true });
    }

    const [inventory, existing] = await Promise.all([
        prisma.backlinkInventory.findUnique({
            where: { siteId },
            select: { siteId: true },
        }),
        prisma.backlinkReferringDomain.findMany({
            where: { siteId },
            select: {
                id: true,
                domain: true,
                domainRating: true,
                lastSeen: true,
                status: true,
            },
        }),
    ]);

    const baseline = inventory === null;
    const existingByDomain = new Map(existing.map((row) => [row.domain.toLowerCase(), row]));
    const activeByDomain = new Map(
        existing
            .filter((row) => row.status === "active")
            .map((row) => [row.domain.toLowerCase(), row]),
    );
    const freshByDomain = new Map(
        snapshot.rows.map((row) => [row.srcDomain.toLowerCase(), row]),
    );
    const freshRows = [...freshByDomain.values()];

    const gainedCandidates = baseline
        ? []
        : freshRows
            .filter((row) => !activeByDomain.has(row.srcDomain))
            .map((row) => {
                const previous = existingByDomain.get(row.srcDomain);
                const priorActiveSeenAt = previous?.lastSeen
                    ?? validDate(row.firstSeen, observedAt);
                return {
                    siteId,
                    eventKey: transitionEventKey("gained", row.srcDomain, priorActiveSeenAt),
                    type: "gained" as const,
                    domain: row.srcDomain,
                    url: "",
                    dr: row.domainRating,
                    detectedAt: observedAt,
                };
            });

    const lostRecords = baseline
        ? []
        : [...activeByDomain.entries()]
            .filter(([domain]) => !freshByDomain.has(domain))
            .map(([, row]) => row);
    const lostCandidates = lostRecords.map((row) => ({
        siteId,
        eventKey: transitionEventKey("lost", row.domain, row.lastSeen),
        type: "lost" as const,
        domain: row.domain,
        url: "",
        dr: row.domainRating,
        detectedAt: observedAt,
    }));

    // An active observation refreshes lastSeen. For a lost domain we leave it
    // untouched: it means "last seen active" and also makes the loss key stable.
    for (let offset = 0; offset < freshRows.length; offset += 50) {
        const chunk = freshRows.slice(offset, offset + 50);
        await Promise.all(chunk.map((row) =>
            prisma.backlinkReferringDomain.upsert({
                where: { siteId_domain: { siteId, domain: row.srcDomain } },
                create: {
                    siteId,
                    domain: row.srcDomain,
                    domainRating: row.domainRating,
                    backlinks: row.backlinks,
                    spamScore: row.spamScore,
                    firstSeen: validDate(row.firstSeen, observedAt),
                    lastSeen: observedAt,
                    status: "active",
                },
                update: {
                    domainRating: row.domainRating,
                    backlinks: row.backlinks,
                    spamScore: row.spamScore,
                    lastSeen: observedAt,
                    status: "active",
                },
            }),
        ));
    }

    if (lostRecords.length > 0) {
        await prisma.backlinkReferringDomain.updateMany({
            where: { id: { in: lostRecords.map((row) => row.id) } },
            data: { status: "lost" },
        });
    }

    await prisma.backlinkInventory.upsert({
        where: { siteId },
        create: {
            siteId,
            initializedAt: observedAt,
            lastCompletedAt: observedAt,
            totalDomains: snapshot.totalCount,
        },
        update: {
            lastCompletedAt: observedAt,
            totalDomains: snapshot.totalCount,
        },
    });

    if (baseline) {
        logger.info("[Backlinks/Alerts] Complete baseline stored", {
            siteId,
            observed: freshRows.length,
            totalCount: snapshot.totalCount,
        });
        return emptyResult({ baseline: true });
    }

    const candidates = [...gainedCandidates, ...lostCandidates];
    const existingEventKeys = candidates.length === 0
        ? new Set<string>()
        : new Set((await prisma.backlinkAlert.findMany({
            where: { siteId, eventKey: { in: candidates.map((event) => event.eventKey) } },
            select: { eventKey: true },
        })).map((event) => event.eventKey));
    const newEvents = candidates.filter((event) => !existingEventKeys.has(event.eventKey));

    if (newEvents.length > 0) {
        await prisma.backlinkAlert.createMany({
            data: newEvents,
            skipDuplicates: true,
        });
    }

    const gainedDomains = newEvents
        .filter((event) => event.type === "gained")
        .map((event) => ({ domain: event.domain, dr: event.dr }));
    const lostDomains = newEvents
        .filter((event) => event.type === "lost")
        .map((event) => ({ domain: event.domain, dr: event.dr }));

    logger.info("[Backlinks/Alerts] Reconciled complete domain inventory", {
        siteId,
        gained: gainedDomains.length,
        lost: lostDomains.length,
        observed: freshRows.length,
    });
    return {
        gained: gainedDomains.length,
        lost: lostDomains.length,
        baseline: false,
        partial: false,
        gainedDomains,
        lostDomains,
    };
}
