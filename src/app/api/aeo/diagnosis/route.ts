export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { diagnoseAeoData, MentionRecord } from "@/lib/aeo/diagnosis";

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const siteId = new URL(req.url).searchParams.get("siteId");
    if (!siteId)
        return NextResponse.json({ error: "Missing siteId" }, { status: 400 });

    // Verify ownership — also fetch brandName and domain to build explicit brand hints
    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user.id },
        select: { id: true, domain: true, brandName: true },
    });
    if (!site)
        return NextResponse.json({ error: "Not found" }, { status: 404 });

    const since = new Date();
    since.setDate(since.getDate() - 90);

    const trackingRows = await prisma.aiShareOfVoice.findMany({
        where: { siteId, recordedAt: { gte: since } },
        orderBy: { recordedAt: "desc" },
        take: 500,
        select: {
            keyword: true,
            brandMentioned: true,
            competitorsMentioned: true,
            recordedAt: true,
        },
    });

    const records: MentionRecord[] = trackingRows.map((row) => ({
        keyword: row.keyword,
        mentioned: row.brandMentioned,
        competitorsMentioned: Array.isArray(row.competitorsMentioned)
            ? (row.competitorsMentioned as string[])
            : [],
        queriedAt: row.recordedAt,
    }));

    // Build explicit brand name hints from the stored brand name and domain slug.
    // e.g. domain "optiaiseo.online" + brandName "OptiAISEO" →
    //      ["OptiAISEO", "optiaiseo"]
    const domainSlug = site.domain.replace(/\..+$/, ""); // strip TLD
    const brandHints = [
        ...(site.brandName ? [site.brandName] : []),
        domainSlug,
    ].filter(Boolean);

    const diagnosis = diagnoseAeoData(records, /* unrelatedSignals */ [], brandHints);
    return NextResponse.json(diagnosis);
}
