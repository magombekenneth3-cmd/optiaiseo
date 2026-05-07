export const dynamic = "force-dynamic";
export const config = { api: { bodyParser: { sizeLimit: "64kb" } } };


import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
    runCitationGapAnalysis,
    getCachedCitationGaps,
} from "@/lib/aeo/citation-gap";
import { rateLimit } from "@/lib/rate-limit";

// ─── GET — fast cached summary ────────────────────────────────────────────────

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const siteId = req.nextUrl.searchParams.get("siteId");
    if (!siteId) {
        return NextResponse.json({ error: "siteId required" }, { status: 400 });
    }

    // Ownership check
    const site = await prisma.site.findFirst({
        where: { id: siteId, user: { email: user.email } },
        select: { id: true, domain: true },
    });
    if (!site) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    try {
        const gaps = await getCachedCitationGaps(siteId);
        return NextResponse.json({
            success: true,
            source: "cached",
            domain: site.domain,
            gapCount: gaps.length,
            gaps,
        });
    } catch (err: unknown) {
        logger.error("[CitationGap GET] Failed", {
            error: (err as Error)?.message,
        });
        return NextResponse.json(
            { error: "Failed to load citation gaps" },
            { status: 500 }
        );
    }
}

// ─── POST — full live analysis ────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { siteId, maxKeywords = 15 } = body as {
        siteId?: string;
        maxKeywords?: number;
    };

    if (!siteId) {
        return NextResponse.json({ error: "siteId required" }, { status: 400 });
    }

    // Rate limit: 1 full analysis per site per 6 hours
    // (each analysis makes ~20 Perplexity + 20 Gemini calls)
    const rateLimitResponse = await rateLimit("citationGap", siteId);
    if (rateLimitResponse) {
        // rateLimit() already returns a fully-formed 429 Response
        return rateLimitResponse;
    }

    // Ownership check
    const site = await prisma.site.findFirst({
        where: { id: siteId, user: { email: user.email } },
        select: { id: true, domain: true },
    });
    if (!site) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Check site has competitors set up
    const competitorCount = await prisma.competitor.count({
        where: { siteId },
    });
    if (competitorCount === 0) {
        return NextResponse.json(
            {
                error:
                    "No competitors tracked yet. Add competitors in the Competitors section first.",
            },
            { status: 422 }
        );
    }

    try {
        logger.info("[CitationGap POST] Starting live analysis", {
            siteId,
            domain: site.domain,
            maxKeywords,
        });

        const report = await runCitationGapAnalysis(siteId, maxKeywords);

        return NextResponse.json({
            success: true,
            source: "live",
            ...report,
        });
    } catch (err: unknown) {
        logger.error("[CitationGap POST] Analysis failed", {
            siteId,
            error: (err as Error)?.message,
        });
        return NextResponse.json(
            { error: "Citation gap analysis failed. Check your API keys and try again." },
            { status: 500 }
        );
    }
}