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

export async function computeShareOfVoice(
    siteId:     string,
    userDomain: string,
): Promise<SovEntry[]> {
    try {
        // 1. Load user's latest tracked keyword snapshots (one per keyword)
        const mySnapshots = await prisma.$queryRaw<
            Array<{ keyword: string; position: number; searchVolume: number | null }>
        >`
            SELECT DISTINCT ON (keyword)
                keyword, position, "searchVolume"
            FROM "RankSnapshot"
            WHERE "siteId" = ${siteId}
              AND "trackedId" IS NOT NULL
            ORDER BY keyword, "recordedAt" DESC
        `;

        if (mySnapshots.length === 0) return [];
        const trackedKeywords = new Set(mySnapshots.map((s) => s.keyword.toLowerCase()));

        // 2. Load competitor positions for the same keyword set
        const compRows = await prisma.competitorKeyword.findMany({
            where: {
                competitor:  { siteId },
                keyword:     { in: [...trackedKeywords] },
            },
            select: {
                keyword:      true,
                position:     true,
                searchVolume: true,
                competitor:   { select: { domain: true } },
            },
        });

        // 3. Aggregate clicks per domain
        const clickMap = new Map<string, number>();

        for (const s of mySnapshots) {
            const vol    = Math.max(s.searchVolume ?? 0, 100);
            const weight = CTR[Math.min(s.position, 10)] ?? CTR[10];
            clickMap.set(userDomain, (clickMap.get(userDomain) ?? 0) + Math.round(vol * weight));
        }

        for (const row of compRows) {
            const vol    = Math.max(row.searchVolume ?? 0, 100);
            const weight = CTR[Math.min(row.position ?? 20, 10)] ?? 0.005;
            const d      = row.competitor.domain;
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
