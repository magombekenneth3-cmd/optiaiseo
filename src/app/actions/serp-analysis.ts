"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { checkSerpAnalysisLimit } from "@/lib/rate-limit";
import { consumeCredits } from "@/lib/credits";
import { inngest } from "@/lib/inngest/client";

export interface SerpFix {
    title: string;
    description: string;
    priority: "high" | "medium" | "low";
    category: "content" | "structure" | "intent" | "links" | "authority" | "schema";
    linkToTab: "heading-gaps" | "link-authority" | null;
}

export interface HeadingGap {
    topic: string;
    freqInTop10: number;
    coveredOnYourPage: boolean;
}

export interface SerpResult {
    position: number;
    domain: string;
    title: string;
    snippet: string;
    url: string;
    wordCount: number;
    h2Count: number;
    contentType: string;
    dr: number;
}

export interface SerpAnalysisResult {
    fixes: SerpFix[];
    headingGaps: HeadingGap[];
    serpResults: SerpResult[];
    wordCountAvgTop10: number;
    wordCountYourPage: number;
    yourPageH2s: string[];
    drGap: number | null;
    rdGapRoot: number | null;
    rdGapPage: number | null;
    clientDR: number;
    clientRDs: number;
    pageRDs: number;
    toxicCount: number;
    topAnchors: { anchor: string; count: number }[];
    newLastWeek: number;
    lostLastWeek: number;
    dofollowRatio: number;
    opportunityDoms: { domain: string; dr: number }[];
    intentMismatch: boolean;
    intentNote: string | null;
    contentTypeTop10: string;
    disclaimerNeeded: boolean;
    cachedAt: string;
}

type ActionResult =
    | { data: SerpAnalysisResult; pending?: never; analysisId?: never; error: null }
    | { pending: true; analysisId: string; data?: never; error: null }
    | { data: null; pending?: never; analysisId?: never; error: string };

function toResult(row: NonNullable<Awaited<ReturnType<typeof prisma.keywordSerpAnalysis.findUnique>>>): ActionResult {
    return {
        data: {
            fixes:            row.fixes            as unknown as SerpFix[],
            headingGaps:      row.headingGaps      as unknown as HeadingGap[],
            serpResults:      row.serpResults      as unknown as SerpResult[],
            wordCountAvgTop10: row.wordCountAvg,
            wordCountYourPage: row.wordCountPage,
            yourPageH2s:      [],
            drGap:            row.drGap,
            rdGapRoot:        row.rdGapRoot,
            rdGapPage:        row.rdGapPage,
            clientDR:         0,
            clientRDs:        0,
            pageRDs:          row.rdGapPage ?? 0,
            toxicCount:       0,
            topAnchors:       [],
            newLastWeek:      0,
            lostLastWeek:     0,
            dofollowRatio:    0,
            opportunityDoms:  row.opportunityDoms  as unknown as { domain: string; dr: number }[],
            intentMismatch:   row.intentMismatch,
            intentNote:       row.intentNote ?? null,
            contentTypeTop10: row.contentType ?? "",
            disclaimerNeeded: row.disclaimerNeeded,
            cachedAt:         (row.completedAt ?? row.createdAt).toISOString(),
        },
        error: null,
    };
}

export async function analyseKeywordVsSerp(
    siteId: string,
    keyword: string,
    landingPageUrl: string,
): Promise<ActionResult> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { data: null, error: "Unauthorised" };

    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { id: true, subscriptionTier: true },
    });
    if (!user) return { data: null, error: "User not found" };

    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user.id },
        select: { domain: true },
    });
    if (!site) return { data: null, error: "Site not found" };

    const existing = await prisma.keywordSerpAnalysis.findUnique({
        where: { siteId_keyword: { siteId, keyword } },
    });

    if (existing) {
        if (existing.status === "COMPLETED" && existing.expiresAt > new Date()) {
            return toResult(existing);
        }
        if (existing.status === "PENDING" || existing.status === "SCRAPING" || existing.status === "PLANNING") {
            return { pending: true, analysisId: existing.id, error: null };
        }
    }

    const tier = user.subscriptionTier ?? "FREE";
    const limitRes = await checkSerpAnalysisLimit(user.id, tier);
    if (!limitRes.allowed) {
        return {
            data: null,
            error: `Monthly SERP analysis limit reached. Resets ${limitRes.resetAt.toLocaleDateString()}. Upgrade your plan for more analyses.`,
        };
    }

    const creditResult = await consumeCredits(user.id, "serp_analysis");
    if (!creditResult.allowed) {
        return { data: null, error: "Insufficient credits. Top up or upgrade your plan." };
    }

    const record = await prisma.keywordSerpAnalysis.upsert({
        where:  { siteId_keyword: { siteId, keyword } },
        create: { siteId, keyword, landingUrl: landingPageUrl, status: "PENDING", expiresAt: new Date() },
        update: { status: "PENDING", errorMessage: null, expiresAt: new Date() },
    });

    await inngest.send({
        name: "serp-analysis/requested",
        data: {
            analysisId:     record.id,
            siteId,
            userId:         user.id,
            keyword,
            landingPageUrl,
            domain:         site.domain,
        },
    });

    logger.info("[SerpAnalysis] Job queued", { analysisId: record.id, keyword, siteId });
    return { pending: true, analysisId: record.id, error: null };
}

export async function forceRefreshSerpAnalysis(
    siteId: string,
    keyword: string,
    landingPageUrl: string,
): Promise<ActionResult> {
    await prisma.keywordSerpAnalysis.deleteMany({ where: { siteId, keyword } });
    return analyseKeywordVsSerp(siteId, keyword, landingPageUrl);
}
