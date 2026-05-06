export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";
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

    // Pull AEO tracking events from the last 90 days
    const since = new Date();
    since.setDate(since.getDate() - 90);

    const events = await prisma.aeoEvent.findMany({
        where: { siteId, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 500,
    });

    const records: MentionRecord[] = events.map((e: { metadata: unknown; createdAt: Date }) => ({
         
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        keyword:               (e.metadata as any)?.keyword      ?? "",
         
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mentioned:             (e.metadata as any)?.mentioned    ?? false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        competitorsMentioned:  (e.metadata as any)?.competitors  ?? [],
        queriedAt:             e.createdAt,
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
