/**
 * GET /api/aeo/forecast?siteId=...[&refresh=1]
 *
 * Returns a 90-day AI visibility forecast for the given site.
 * Requires an authenticated user.
 *
 * Caching: results are cached in Redis for 15 minutes.
 * Pass ?refresh=1 to bust the cache and regenerate immediately.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { generateVisibilityForecast } from "@/lib/aeo/visibility-forecast";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";

const FORECAST_TTL_S = 900; // 15 minutes

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const siteId = req.nextUrl.searchParams.get("siteId");
    if (!siteId) {
        return NextResponse.json({ error: "siteId query param is required" }, { status: 400 });
    }

    const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";

    // Verify the site belongs to the requesting user
    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user.id },
        select: { id: true, domain: true },
    });

    if (!site) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const cacheKey = `aeo:forecast:${siteId}`;

    // Serve from cache unless ?refresh=1
    if (!forceRefresh) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                const data = typeof cached === "string" ? JSON.parse(cached) : cached;
                logger.debug("[Forecast] Cache hit", { siteId });
                return NextResponse.json(data, {
                    headers: { "X-Cache": "HIT" },
                });
            }
        } catch {
            // Redis miss — continue to generate
        }
    }

    try {
        const forecast = await generateVisibilityForecast(siteId);

        // Flatten: panel expects the VisibilityForecast fields at the top level
        // (siteId + domain are bonus top-level fields the panel ignores but
        //  callers may use for labelling without needing a separate request).
        const response = {
            ...forecast,
            siteId,
            domain: site.domain,
        };

        // Cache for 15 min; fire-and-forget
        redis
            .set(cacheKey, JSON.stringify(response), { ex: FORECAST_TTL_S })
            .catch(() => undefined);

        return NextResponse.json(response, {
            headers: { "X-Cache": "MISS" },
        });
    } catch (err: unknown) {
        return NextResponse.json(
            { error: "Forecast generation failed", detail: (err as Error)?.message },
            { status: 500 },
        );
    }
}
