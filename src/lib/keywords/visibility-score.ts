/**
 * src/lib/keywords/visibility-score.ts
 *
 * Visibility Score — the single number clients check every day.
 *
 * Formula mirrors Semrush's Visibility metric:
 *   score = Σ(CTR_weight[pos] × volume) / Σ(CTR_weight[1] × volume) × 100
 *
 * Range: 0–100. A score of 25 means you capture 25% of what you
 * would if every keyword was ranked #1.
 */

import prisma    from "@/lib/prisma";
import { logger } from "@/lib/logger";

const CTR_WEIGHT: Readonly<Record<number, number>> = {
    1: 1.000, 2: 0.555, 3: 0.407, 4: 0.295, 5: 0.223,
    6: 0.173, 7: 0.137, 8: 0.112, 9: 0.090, 10: 0.079,
};
const UNRANKED_WEIGHT = 0.005;

export interface VisibilityResult {
    score:           number;
    top3Pct:         number;
    top10Pct:        number;
    keywordsUsed:    number;
    trend:           "improving" | "stable" | "declining" | "insufficient_data";
    previousScore:   number | null;
    delta:           number | null;
}

export function computeVisibilityScore(snapshots: ReadonlyArray<{
    position:     number;
    searchVolume: number | null;
}>): Pick<VisibilityResult, "score" | "top3Pct" | "top10Pct" | "keywordsUsed"> {
    if (snapshots.length === 0) {
        return { score: 0, top3Pct: 0, top10Pct: 0, keywordsUsed: 0 };
    }

    let actualTraffic = 0;
    let maxTraffic    = 0;
    let top3  = 0;
    let top10 = 0;

    for (const s of snapshots) {
        const vol    = Math.max(s.searchVolume ?? 0, 100);
        const weight = s.position > 20
            ? UNRANKED_WEIGHT
            : (CTR_WEIGHT[s.position] ?? CTR_WEIGHT[10]);

        actualTraffic += weight * vol;
        maxTraffic    += CTR_WEIGHT[1] * vol;
        if (s.position <= 3)  top3++;
        if (s.position <= 10) top10++;
    }

    const n = snapshots.length;
    return {
        score:        maxTraffic > 0
            ? parseFloat(((actualTraffic / maxTraffic) * 100).toFixed(2))
            : 0,
        top3Pct:      parseFloat(((top3  / n) * 100).toFixed(1)),
        top10Pct:     parseFloat(((top10 / n) * 100).toFixed(1)),
        keywordsUsed: n,
    };
}

export async function getVisibilityScore(siteId: string): Promise<VisibilityResult> {
    const rows = await prisma.visibilitySnapshot.findMany({
        where:   { siteId },
        orderBy: { date: "desc" },
        take:    8,
        select:  { score: true, top3Pct: true, top10Pct: true, keywordsUsed: true, date: true },
    });

    if (rows.length === 0) {
        return {
            score: 0, top3Pct: 0, top10Pct: 0, keywordsUsed: 0,
            trend: "insufficient_data", previousScore: null, delta: null,
        };
    }

    const latest   = rows[0];
    const previous = rows[1] ?? null;
    const delta    = previous ? parseFloat((latest.score - previous.score).toFixed(2)) : null;

    const trend: VisibilityResult["trend"] = rows.length < 3 || delta === null
        ? "insufficient_data"
        : delta >  1 ? "improving"
        : delta < -1 ? "declining"
        : "stable";

    return { ...latest, trend, previousScore: previous?.score ?? null, delta };
}

export async function writeVisibilitySnapshot(
    siteId:    string,
    snapshots: ReadonlyArray<{ position: number; searchVolume: number | null }>,
): Promise<void> {
    const { score, top3Pct, top10Pct, keywordsUsed } = computeVisibilityScore(snapshots);
    const date = new Date().toISOString().slice(0, 10);

    try {
        await prisma.$executeRaw`
            INSERT INTO "VisibilitySnapshot" ("id","siteId","date","score","top3Pct","top10Pct","keywordsUsed")
            VALUES (gen_random_uuid()::text, ${siteId}, ${date}, ${score}, ${top3Pct}, ${top10Pct}, ${keywordsUsed})
            ON CONFLICT ("siteId","date")
            DO UPDATE SET
                "score"        = EXCLUDED."score",
                "top3Pct"      = EXCLUDED."top3Pct",
                "top10Pct"     = EXCLUDED."top10Pct",
                "keywordsUsed" = EXCLUDED."keywordsUsed"
        `;
    } catch (err: unknown) {
        logger.warn("[VisibilityScore] write failed", {
            siteId, error: (err as Error).message,
        });
    }
}
