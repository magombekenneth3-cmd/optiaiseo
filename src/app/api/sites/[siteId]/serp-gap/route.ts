/**
 * src/app/api/sites/[siteId]/serp-gap/route.ts
 *
 * POST /api/sites/:siteId/serp-gap
 *   Body: { keyword, clientUrl, clientPosition }
 *   → Creates a SerpGapAnalysis record, fires Inngest job, returns analysisId
 *
 * GET /api/sites/:siteId/serp-gap
 *   → Returns all gap analyses for this site, paginated
 *
 * GET /api/sites/:siteId/serp-gap/:analysisId
 *   → Returns a single completed analysis
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { z } from "zod";

const PostSchema = z.object({
    keyword: z.string().min(2).max(200),
    clientUrl: z.string().url(),
    clientPosition: z.number().int().min(1).max(200),
});

// ─── POST — trigger new analysis ─────────────────────────────────────────────

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ siteId: string }> }
) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { siteId } = await params;

    // Verify site ownership
    const site = await prisma.site.findFirst({
        where: { id: siteId, userId },
        select: { id: true, domain: true },
    });
    if (!site) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    // Validate body
    let body: z.infer<typeof PostSchema>;
    try {
        body = PostSchema.parse(await req.json());
    } catch (err) {
        return NextResponse.json({ error: "Invalid request body", details: err }, { status: 400 });
    }

    // Check tier — Free users get 1 analysis, Pro 20/month, Agency unlimited
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { subscriptionTier: true, credits: true },
    });

    const tier = (user?.subscriptionTier ?? "FREE").toUpperCase();
    if (tier === "FREE") {
        const existing = await prisma.serpGapAnalysis.count({ where: { userId } });
        if (existing >= 1) {
            return NextResponse.json(
                { error: "Free plan includes 1 gap analysis. Upgrade to Pro for unlimited access." },
                { status: 402 }
            );
        }
    }

    if ((user?.credits ?? 0) < 5) {
        return NextResponse.json(
            { error: "Insufficient credits. Gap analysis costs 5 credits." },
            { status: 402 }
        );
    }

    // Create the analysis record (status: PENDING)
    const analysis = await prisma.serpGapAnalysis.create({
        data: {
            siteId,
            userId,
            keyword: body.keyword,
            clientUrl: body.clientUrl,
            clientPosition: body.clientPosition,
            status: "PENDING",
        },
    });

    // Fire Inngest job
    await inngest.send({
        name: "serp-gap/requested",
        data: {
            siteId,
            userId,
            keyword: body.keyword,
            clientUrl: body.clientUrl,
            clientPosition: body.clientPosition,
            analysisId: analysis.id,
        },
    });

    return NextResponse.json({
        analysisId: analysis.id,
        status: "PENDING",
        message: `Gap analysis started for "${body.keyword}". Poll /api/sites/${siteId}/serp-gap/${analysis.id} for results.`,
    });
}

// ─── GET — list analyses for site ────────────────────────────────────────────

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ siteId: string }> }
) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { siteId } = await params;

    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: session.user.id },
        select: { id: true },
    });
    if (!site) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const analyses = await prisma.serpGapAnalysis.findMany({
        where: { siteId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
            id: true,
            keyword: true,
            clientUrl: true,
            clientPosition: true,
            status: true,
            serpFormat: true,
            gapCount: true,
            criticalGapCount: true,
            estimatedPositionGain: true,
            topPriority: true,
            taskCount: true,
            automatedTaskCount: true,
            createdAt: true,
            completedAt: true,
        },
    });

    return NextResponse.json({ analyses });
}