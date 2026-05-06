import prisma    from "@/lib/prisma";
import { logger } from "@/lib/logger";

function currentMonth(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function upsertTrafficSnapshot(
    competitorId: string,
    estimatedVisits: number,
    organicKeywords?: number,
): Promise<void> {
    const month = currentMonth();
    try {
        await prisma.$executeRaw`
            INSERT INTO "CompetitorTrafficSnapshot"
                ("id", "competitorId", "month", "estimatedVisits", "organicKeywords", "dataSource")
            VALUES
                (gen_random_uuid()::text, ${competitorId}, ${month},
                 ${estimatedVisits}, ${organicKeywords ?? null}, 'ctr-estimate')
            ON CONFLICT ("competitorId", "month")
            DO UPDATE SET
                "estimatedVisits" = GREATEST(EXCLUDED."estimatedVisits", "CompetitorTrafficSnapshot"."estimatedVisits"),
                "organicKeywords" = COALESCE(EXCLUDED."organicKeywords",  "CompetitorTrafficSnapshot"."organicKeywords")
        `;
    } catch (err: unknown) {
        logger.warn("[CompetitorSnapshots] upsert failed", {
            competitorId,
            error: (err as Error).message,
        });
    }
}

export async function getTrafficTrend(
    competitorId: string,
    months = 6,
): Promise<Array<{ month: string; estimatedVisits: number }>> {
    const rows = await prisma.$queryRaw<
        Array<{ month: string; estimatedVisits: number }>
    >`
        SELECT month, "estimatedVisits"
        FROM "CompetitorTrafficSnapshot"
        WHERE "competitorId" = ${competitorId}
        ORDER BY month DESC
        LIMIT ${months}
    `;
    return rows.reverse();
}
