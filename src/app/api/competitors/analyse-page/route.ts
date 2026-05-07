export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { rateLimit } from "@/lib/rate-limit/check";

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Gap 6.2: Check feature gate BEFORE rate limit to prevent bypass via stale tier data.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tier = (user as any)?.subscriptionTier ?? "FREE";
    const { hasFeature } = await import("@/lib/stripe/plans");
    if (!hasFeature(tier, "competitor")) {
        return NextResponse.json(
            { error: "Competitor tracking requires a Pro or Agency plan.", upgradeUrl: "/billing" },
            { status: 403 }
        );
    }

    // Rate limit: max 10 competitor page analyses per user per hour
    const limited = await rateLimit("competitorAnalyse", user!.id);
    if (limited) return limited;


    const body = await req.json();
    const { url, keyword, siteId } = body as {
        url?: string;
        keyword?: string;
        siteId?: string;
    };

    if (!url || !keyword || !siteId)
        return NextResponse.json({ error: "Missing url, keyword or siteId" }, { status: 400 });

    // Verify site ownership before dispatch
    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user!.id },
        select: { domain: true },
    });
    if (!site)
        return NextResponse.json({ error: "Site not found" }, { status: 404 });

    // Persist a pending record so the frontend can poll for the result
    const record = await prisma.competitorPageAnalysis.create({
        data: {
            siteId,
            userId: user!.id,
            url,
            keyword,
            status: "pending",
        },
    });

    // Dispatch to Inngest — returns immediately, analysis runs in the background
    await inngest.send({
        name: "competitor/analyse-page",
        data: {
            analysisId: record.id,
            url,
            keyword,
            domain: site.domain,
        },
    });

    return NextResponse.json({ analysisId: record.id, status: "pending" }, { status: 202 });
}
