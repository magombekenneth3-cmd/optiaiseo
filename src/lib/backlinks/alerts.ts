/**
 * Backlink alert detector — compares fresh referring-domain data from DataForSEO
 * against what was last stored in BacklinkDetail, then writes gained/lost alerts.
 *
 * Called from the backlinkCheckSite Inngest function (see functions/backlinks.ts).
 */

import { prisma } from "@/lib/prisma";
import { getReferringDomains } from "./referring-domains";
import { logger } from "@/lib/logger";

export async function detectBacklinkAlerts(
    siteId: string,
    domain: string,
): Promise<{ gained: number; lost: number }> {
    const [fresh, stored] = await Promise.all([
        getReferringDomains(domain),
        prisma.backlinkDetail.findMany({
            where:  { siteId },
            select: { srcDomain: true, domainRating: true },
        }),
    ]);

    const freshSet  = new Map(fresh.map(r  => [r.srcDomain.toLowerCase(), r.dr]));
    const storedSet = new Map(stored.map(r => [r.srcDomain.toLowerCase(), r.domainRating]));

    const gained = [...freshSet.entries()].filter(([d]) => !storedSet.has(d));
    const lost   = [...storedSet.entries()].filter(([d]) => !freshSet.has(d));

    const alerts = [
        ...gained.map(([domain, dr]) => ({
            siteId,
            type:   "gained" as const,
            domain,
            dr:     dr ?? null,
        })),
        ...lost.map(([domain, dr]) => ({
            siteId,
            type:   "lost" as const,
            domain,
            dr:     typeof dr === "number" ? dr : null,
        })),
    ];

    if (alerts.length > 0) {
        await prisma.backlinkAlert.createMany({
            data:           alerts,
            skipDuplicates: true,
        });
        logger.info("[Backlinks/Alerts] Detected changes", {
            siteId,
            gained: gained.length,
            lost:   lost.length,
        });
    }

    return { gained: gained.length, lost: lost.length };
}
