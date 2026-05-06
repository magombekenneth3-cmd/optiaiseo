export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { requireAdminApi } from "@/lib/admin-guard";


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


    const redis = Redis.fromEnv();

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
}
