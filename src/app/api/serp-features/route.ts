// GET /api/serp-features?siteId=...
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";
import { getLatestSerpFeatures, captureSerpFeatures } from "@/lib/serp/serp-features";

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const siteId = req.nextUrl.searchParams.get("siteId");
    if (!siteId)
        return NextResponse.json({ error: "siteId required" }, { status: 400 });

    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user.id },
        select: { id: true },
    });
    if (!site)
        return NextResponse.json({ error: "Site not found" }, { status: 404 });

    const features = await getLatestSerpFeatures(siteId, 20);
    return NextResponse.json({ features }, {
        headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=60" },
    });
}

// POST — trigger a fresh SERP scan
export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { siteId } = await req.json();
    if (!siteId)
        return NextResponse.json({ error: "siteId required" }, { status: 400 });

    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user.id },
        select: {
            id: true,
            domain: true,
            rankSnapshots: {
                distinct: ["keyword"],
                orderBy:  { recordedAt: "desc" },
                take:     20,
                select:   { keyword: true },
            },
        },
    });
    if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });

    const keywords = site.rankSnapshots.map(r => r.keyword);
    const saved = await captureSerpFeatures(siteId, site.domain, keywords);

    return NextResponse.json({ captured: saved }, { status: 201 });
}
