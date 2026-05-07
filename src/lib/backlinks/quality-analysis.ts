/**
 * Backlink quality analysis — goes beyond count to flag toxic links.
 *
 * Toxic link detection criteria (any one triggers isToxic):
 *   1. Exact-match anchor text > 30% of all anchors for this site
 *   2. domainRating < 10 AND srcDomain appears > 5 times
 *   3. Anchor text contains gambling, pharma, or adult keywords
 *
 * Upsert key: siteId + srcDomain + anchorText  (covers multi-anchor scenarios)
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

const TOXIC_KEYWORDS = [
    "casino", "poker", "slots", "bet", "gambling", "lottery",
    "viagra", "cialis", "pharmacy", "pills", "medication", "drug",
    "porn", "adult", "xxx", "sex", "escort", "nude",
];

interface RawBacklink {
    srcDomain:    string;
    anchorText:   string;
    domainRating?: number;
    isDoFollow?:  boolean;
    targetUrl?:   string;   // stored when available
    firstSeen?:   Date;     // Bug 2: preserve DataForSEO first_seen date
}

/** Runs toxic detection and upserts BacklinkDetail rows for a site */
export async function analyseAndStoreBacklinks(
    siteId: string,
    backlinks: RawBacklink[],
): Promise<{ total: number; toxic: number }> {
    if (backlinks.length === 0) return { total: 0, toxic: 0 };

    // Count anchor occurrences across all links
    const anchorCounts = new Map<string, number>();
    for (const bl of backlinks) {
        const key = bl.anchorText.toLowerCase().trim();
        anchorCounts.set(key, (anchorCounts.get(key) ?? 0) + 1);
    }

    // Count how many times each srcDomain appears
    const domainCounts = new Map<string, number>();
    for (const bl of backlinks) {
        const key = bl.srcDomain.toLowerCase();
        domainCounts.set(key, (domainCounts.get(key) ?? 0) + 1);
    }

    const total = backlinks.length;
    let toxic = 0;

    for (const bl of backlinks) {
        const anchorLower = bl.anchorText.toLowerCase().trim();
        const domainLower = bl.srcDomain.toLowerCase();
        const anchorCount = anchorCounts.get(anchorLower) ?? 1;

        let isToxic = false;
        let toxicReason: string | undefined;

        // Rule 1: Exact-match anchor > 30% of all anchors
        // Only apply the ratio rule when we have enough data (≥15 links);
        // small sites with 1-2 links would always hit 100% on any anchor.
        if (total >= 15 && anchorCount / total > 0.30) {
            isToxic = true;
            toxicReason = "exact_match_anchor";
        }

        // Rule 2: Low-DR spam (DR < 10 AND domain appears > 5 times)
        if (!isToxic && bl.domainRating != null && bl.domainRating < 10) {
            const domainCount = domainCounts.get(domainLower) ?? 1;
            if (domainCount > 5) {
                isToxic = true;
                toxicReason = "low_dr_spam";
            }
        }

        // Rule 3: Toxic keyword in anchor
        if (!isToxic && TOXIC_KEYWORDS.some(kw => anchorLower.includes(kw))) {
            isToxic = true;
            toxicReason = "toxic_keyword";
        }

        if (isToxic) toxic++;

        try {
            await prisma.backlinkDetail.upsert({
                where: {
                    // New compound key: srcDomain + anchorText per site
                    // Preserves multi-anchor data from the same referring domain
                    siteId_srcDomain_anchorText: {
                        siteId,
                        srcDomain:  bl.srcDomain,
                        anchorText: bl.anchorText,
                    },
                },
                create: {
                    siteId,
                    srcDomain:    bl.srcDomain,
                    anchorText:   bl.anchorText,
                    domainRating: bl.domainRating ?? null,
                    isDoFollow:   bl.isDoFollow   ?? true,
                    isToxic,
                    toxicReason:  toxicReason ?? null,
                    firstSeen:    bl.firstSeen ?? new Date(),  // Bug 2: real date from DataForSEO
                    lastSeen:     new Date(),
                },
                update: {
                    domainRating: bl.domainRating ?? undefined,
                    isToxic,
                    toxicReason:  toxicReason ?? null,
                    lastSeen:     new Date(),
                },
            });
        } catch (e: unknown) {
            logger.warn("[BacklinkDetail] upsert failed", {
                error: (e as Error)?.message,
                siteId,
                srcDomain: bl.srcDomain,
            });
        }
    }

    logger.info(
        `[BacklinkDetail] Processed ${total} backlinks, ${toxic} flagged as toxic for site ${siteId}`,
    );
    return { total, toxic };
}

/** Fetch backlink quality summary for dashboard display */
export async function getBacklinkQualitySummary(siteId: string) {
    const [total, toxic, doFollow, byReason] = await Promise.all([
        prisma.backlinkDetail.count({ where: { siteId } }),
        prisma.backlinkDetail.count({ where: { siteId, isToxic: true } }),
        prisma.backlinkDetail.count({ where: { siteId, isDoFollow: true } }),
        prisma.backlinkDetail.groupBy({
            by:    ["toxicReason"],
            where: { siteId, isToxic: true },
            _count: { id: true },
        }),
    ]);

    return {
        total,
        toxic,
        doFollow,
        nofollow:     total - doFollow,
        toxicReasons: byReason.map(r => ({ reason: r.toxicReason, count: r._count.id })),
    };
}
