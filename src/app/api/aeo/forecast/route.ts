/**
 * GET /api/aeo/forecast?siteId=...
 *
 * Returns a 90-day AI visibility forecast for the given site.
 * Requires an authenticated user.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { generateVisibilityForecast } from "@/lib/aeo/visibility-forecast";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user!.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const siteId = req.nextUrl.searchParams.get("siteId");
    if (!siteId) {
        return NextResponse.json({ error: "siteId query param is required" }, { status: 400 });
    }

    // Verify the site belongs to the requesting user
    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user!.id },
        select: { id: true, domain: true },
    });

    if (!site) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    try {
        const forecast = await generateVisibilityForecast(siteId);
        return NextResponse.json({
            siteId,
            domain: site.domain,
            forecast,
        });
    } catch (err: unknown) {
        return NextResponse.json(
            { error: "Forecast generation failed", detail: (err as Error)?.message },
            { status: 500 }
        );
    }
}
