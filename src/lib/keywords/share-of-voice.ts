/**
 * src/lib/keywords/share-of-voice.ts
 *
 * Computes organic Share of Voice for the user's site vs tracked competitors
 * scoped to the intersection of tracked keywords.
 *
 * Security: siteId ownership is verified upstream in the server action.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

const CTR: Readonly<Record<number, number>> = {
    1: 0.278, 2: 0.154, 3: 0.113, 4: 0.082, 5: 0.062,
    6: 0.048, 7: 0.038, 8: 0.031, 9: 0.025, 10: 0.022,
};

export interface SovEntry {
    domain:       string;
    clicks:       number;
    sharePercent: number;
    isOwner:      boolean;
}

function ctrForPosition(pos: number | null | undefined): number {
    if (!pos || pos <= 0) return 0;
    const rounded = Math.round(pos);
    if (rounded <= 10) return CTR[rounded] ?? 0.022;
    if (rounded <= 20) return 0.008;
    return 0.002;
}

export async function computeShareOfVoice(
    siteId:     string,
    userDomain: string,
): Promise<SovEntry[]> {
    try {
        // 1. Load user's latest tracked keyword snapshots (one per keyword)
        const mySnapshots = await prisma.$queryRaw<
            Array<{ keyword: string; position: number; searchVolume: number | null }>
        >`
            SELECT DISTINCT ON (LOWER(keyword))
                keyword, position, "searchVolume"
            FROM "RankSnapshot"
            WHERE "siteId" = ${siteId}
              AND "trackedId" IS NOT NULL
            ORDER BY LOWER(keyword), "recordedAt" DESC
        `;

        if (mySnapshots.length === 0) return [];
        const trackedKeywords = new Set(mySnapshots.map((s) => s.keyword.toLowerCase()));
        const myVolumeByKeyword = new Map(
            mySnapshots.map((s) => [s.keyword.toLowerCase(), s.searchVolume ?? 0])
        );

        // 2. Load competitor positions for active (non-deleted) competitors, matched case-insensitively
        const allCompRows = await prisma.competitorKeyword.findMany({
            where: {
                competitor: { siteId, deletedAt: null },
            },
            orderBy: { fetchedAt: "desc" },
            select: {
                competitorId: true,
                keyword:      true,
                position:     true,
                searchVolume: true,
                competitor:   { select: { domain: true } },
            },
        });

        const seenCompKw = new Set<string>();
        const compRows = allCompRows.filter((row) => {
            const kwLower = row.keyword.toLowerCase();
            if (!trackedKeywords.has(kwLower)) return false;
            const dedupeKey = `${row.competitorId}::${kwLower}`;
            if (seenCompKw.has(dedupeKey)) return false;
            seenCompKw.add(dedupeKey);
            return true;
        });

        const hasAnyVolume =
            mySnapshots.some((s) => (s.searchVolume ?? 0) > 0) ||
            compRows.some((r) => (r.searchVolume ?? 0) > 0);

        // 3. Aggregate clicks per domain
        const clickMap = new Map<string, number>();

        for (const s of mySnapshots) {
            const vol    = hasAnyVolume ? Math.max(s.searchVolume ?? 0, 0) : 100;
            const weight = ctrForPosition(s.position);
            clickMap.set(userDomain, (clickMap.get(userDomain) ?? 0) + Math.round(vol * weight));
        }

        for (const row of compRows) {
            const kwLower = row.keyword.toLowerCase();
            const rawVol  = row.searchVolume ?? myVolumeByKeyword.get(kwLower) ?? 0;
            const vol     = hasAnyVolume ? Math.max(rawVol, 0) : 100;
            const weight  = ctrForPosition(row.position);
            const d       = row.competitor.domain;
            clickMap.set(d, (clickMap.get(d) ?? 0) + Math.round(vol * weight));
        }

        const total = [...clickMap.values()].reduce((a, b) => a + b, 0);
        if (total === 0) return [];

        return [...clickMap.entries()]
            .map(([domain, clicks]) => ({
                domain,
                clicks,
                sharePercent: parseFloat(((clicks / total) * 100).toFixed(1)),
                isOwner:      domain === userDomain,
            }))
            .sort((a, b) => b.clicks - a.clicks)
            .slice(0, 8);
    } catch (err: unknown) {
        logger.error("[ShareOfVoice] compute failed", {
            siteId, error: (err as Error).message,
        });
        return [];
    }
}
