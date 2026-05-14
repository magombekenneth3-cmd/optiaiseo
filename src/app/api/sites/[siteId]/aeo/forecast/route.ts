export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { generateVisibilityForecast } from "@/lib/aeo/visibility-forecast";
import { redis } from "@/lib/redis";

const CACHE_TTL = 60 * 60 * 24; // 24 hours

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ siteId: string }> }
) {
    try {
        const { siteId } = await params;
        const user = await getAuthUser(req);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const site = await prisma.site.findFirst({
            where: { id: siteId, userId: user.id },
            select: { id: true },
        });
        if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });

        // Check Redis cache first
        const cacheKey = `aeo:forecast:${siteId}`;
        try {
            const cached = await redis?.get<string>(cacheKey);
            if (cached) {
                const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
                return NextResponse.json(parsed);
            }
        } catch {
            // Cache miss — continue to generate
        }

        const forecast = await generateVisibilityForecast(siteId);

        // Write to cache (fire-and-forget)
        try {
            await redis?.set(cacheKey, JSON.stringify(forecast), { ex: CACHE_TTL });
        } catch {
            // Non-fatal
        }

        return NextResponse.json(forecast);
    } catch {
        return NextResponse.json({ error: "Forecast unavailable" }, { status: 500 });
    }
}
