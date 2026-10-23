export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-guard";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";


const LIMITER_PREFIXES = [
    "rl:auth",
    "rl:password-reset",
    "rl:api",
    "rl:blog-generate",
    "rl:aeo-check",
    "rl:voice-session",
    "rl:audit-run",
    "rl:competitor-fetch",
    "rl:github-pr",
    "rl:indexing-submit",
    "rl:webhook",
    "rl:edge",
    "rl:tier:FREE",
    "rl:tier:PRO",
    "rl:tier:AGENCY",
];

export async function GET(req: NextRequest) {
    const guard = await requireAdminApi(req);
    if (guard instanceof NextResponse) return guard;


    const redis = getRedis();
    if (!redis) {
        return NextResponse.json({ error: "Rate-limit statistics are unavailable." }, { status: 503 });
    }

    try {
        const stats = await Promise.all(
            LIMITER_PREFIXES.map(async (prefix) => {
                const [allowed, blocked] = await Promise.all([
                    redis.get<number>(`${prefix}:analytics:allowed`).then((v) => v ?? 0),
                    redis.get<number>(`${prefix}:analytics:blocked`).then((v) => v ?? 0),
                ]);

                const total = allowed + blocked;
                const blockRate = total > 0
                    ? Math.round((blocked / total) * 100)
                    : 0;

                return {
                    limiter: prefix.replace("rl:", ""),
                    allowed,
                    blocked,
                    total,
                    blockRate,
                };
            })
        );

        return NextResponse.json({
            stats,
            generatedAt: new Date().toISOString(),
        });
    } catch (error: unknown) {
        const errorCode = typeof error === "object" && error !== null && "code" in error
            ? String((error as { code?: unknown }).code ?? "redis_error")
            : "redis_error";
        logger.warn("[Admin/RateLimits] Redis read failed", { errorCode });
        return NextResponse.json({ error: "Rate-limit statistics are temporarily unavailable." }, { status: 503 });
    }
}
