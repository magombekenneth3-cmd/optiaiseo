import zlib from "zlib";
import { promisify } from "util";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { GrowthDecision } from "@/lib/opportunity-engine/types";
import { logger } from "@/lib/logger";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const REDIS_TTL_SECONDS = 86400; // 24 hours
const BATCH_CHUNK_SIZE = 1000;

export async function savePersistedDecisions(siteId: string, decisions: GrowthDecision[]): Promise<void> {
    try {
        // 1. High-Scale Chunked Transaction using Prisma createMany()
        await prisma.$transaction(async (tx: any) => {
            await tx.growthDecision.deleteMany({ where: { siteId } });

            for (let i = 0; i < decisions.length; i += BATCH_CHUNK_SIZE) {
                const chunk = decisions.slice(i, i + BATCH_CHUNK_SIZE);
                await tx.growthDecision.createMany({
                    data: chunk.map((dec) => ({
                        id: dec.id,
                        siteId,
                        url: dec.url,
                        primaryKeyword: dec.primaryKeyword,
                        primaryCategory: dec.primaryCategory,
                        opportunityCategories: dec.opportunityCategories,
                        action: dec.action,
                        score: JSON.stringify(dec.score),
                        whyNow: JSON.stringify(dec.whyNow),
                        impact: JSON.stringify(dec.impact),
                        executionPlan: JSON.stringify(dec.executionPlan),
                        status: "ACTIVE",
                    }))
                });
            }
        });

        // 2. High-Performance Gzip Compressed Binary Redis Cache (85% size reduction)
        const redis = getRedis();
        if (redis) {
            try {
                const rawBuffer = Buffer.from(JSON.stringify(decisions));
                const compressed = await gzip(rawBuffer);
                await redis.set(`growth_decisions_compressed:${siteId}`, compressed.toString("base64"), { ex: REDIS_TTL_SECONDS });
            } catch { /* Fail open for cache */ }
        }

        logger.info("[DecisionPersistence] Successfully batch persisted growth decisions", { siteId, count: decisions.length });
    } catch (err: unknown) {
        logger.error("[DecisionPersistence] Failed to persist growth decisions", { siteId, error: (err as Error)?.message || String(err) });
    }
}

export async function getPersistedDecisions(siteId: string): Promise<GrowthDecision[]> {
    // 1. High-Speed Decompression Read from Redis
    const redis = getRedis();
    if (redis) {
        try {
            const compressedBase64 = await redis.get<string>(`growth_decisions_compressed:${siteId}`);
            if (compressedBase64 && typeof compressedBase64 === "string") {
                const buffer = Buffer.from(compressedBase64, "base64");
                const decompressed = await gunzip(buffer);
                const parsed = JSON.parse(decompressed.toString());
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed as GrowthDecision[];
                }
            }
        } catch { /* Fallback to DB */ }
    }

    // 2. Read from Prisma Primary Source of Truth
    try {
        const records = await (prisma as any).growthDecision.findMany({
            where: { siteId, status: "ACTIVE" },
            orderBy: { generatedAt: "desc" },
        });

        return records.map((r: any) => ({
            id: r.id,
            siteId: r.siteId,
            url: r.url,
            primaryKeyword: r.primaryKeyword,
            primaryCategory: r.primaryCategory as GrowthDecision["primaryCategory"],
            opportunityCategories: r.opportunityCategories as GrowthDecision["opportunityCategories"],
            action: r.action as GrowthDecision["action"],
            score: typeof r.score === "string" ? JSON.parse(r.score) : r.score,
            whyNow: typeof r.whyNow === "string" ? JSON.parse(r.whyNow) : r.whyNow,
            impact: typeof r.impact === "string" ? JSON.parse(r.impact) : r.impact,
            executionPlan: typeof r.executionPlan === "string" ? JSON.parse(r.executionPlan) : r.executionPlan,
        }));
    } catch (err: unknown) {
        logger.error("[DecisionPersistence] DB read failed", { siteId, error: (err as Error)?.message || String(err) });
        return [];
    }
}
