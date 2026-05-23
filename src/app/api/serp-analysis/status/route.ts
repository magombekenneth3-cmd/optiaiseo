import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
        return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const record = await prisma.keywordSerpAnalysis.findUnique({
        where: { id },
        select: {
            id: true,
            status: true,
            errorMessage: true,
            fixes: true,
            headingGaps: true,
            serpResults: true,
            wordCountAvg: true,
            wordCountPage: true,
            drGap: true,
            rdGapRoot: true,
            rdGapPage: true,
            opportunityDoms: true,
            intentMismatch: true,
            intentNote: true,
            contentType: true,
            disclaimerNeeded: true,
            completedAt: true,
            expiresAt: true,
            // ── fields added by the Inngest worker ──────────────────────────
            yourPageH2s: true,   // was returning []
            clientDR: true,      // was returning 0
            clientRDs: true,     // was returning 0
            toxicCount: true,    // was returning 0
            topAnchors: true,    // was returning []
            newLastWeek: true,   // was returning 0
            lostLastWeek: true,  // was returning 0
            dofollowRatio: true, // was returning 0
            // ────────────────────────────────────────────────────────────────
            site: { select: { userId: true } },
        },
    });

    if (!record) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (record.site.userId !== session.user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (record.status !== "COMPLETED") {
        return NextResponse.json({ status: record.status, error: record.errorMessage ?? null });
    }

    return NextResponse.json({
        status: record.status,
        data: {
            fixes:             record.fixes,
            headingGaps:       record.headingGaps,
            serpResults:       record.serpResults,
            wordCountAvgTop10: record.wordCountAvg,
            wordCountYourPage: record.wordCountPage,
            yourPageH2s:       (record.yourPageH2s ?? []) as string[],
            drGap:             record.drGap,
            rdGapRoot:         record.rdGapRoot,
            rdGapPage:         record.rdGapPage,
            clientDR:          record.clientDR   ?? 0,
            clientRDs:         record.clientRDs  ?? 0,
            pageRDs:           record.rdGapPage  ?? 0,
            toxicCount:        record.toxicCount  ?? 0,
            topAnchors:        (record.topAnchors ?? []) as { anchor: string; count: number }[],
            newLastWeek:       record.newLastWeek  ?? 0,
            lostLastWeek:      record.lostLastWeek ?? 0,
            dofollowRatio:     record.dofollowRatio ?? 0,
            opportunityDoms:   record.opportunityDoms as { domain: string; dr: number }[],
            intentMismatch:    record.intentMismatch,
            intentNote:        record.intentNote ?? null,
            contentTypeTop10:  record.contentType ?? "",
            disclaimerNeeded:  record.disclaimerNeeded,
            cachedAt:          (record.completedAt ?? new Date()).toISOString(),
        },
    });
}
