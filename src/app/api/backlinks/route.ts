export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import {
    getBacklinkDetails,
    getBacklinkSummary,
    getCompetitorBacklinkGap,
} from "@/lib/backlinks";
import { analyseAndStoreBacklinks, getBacklinkQualitySummary } from "@/lib/backlinks/quality-analysis";
import { bustBacklinkCache } from "@/lib/backlinks/cache";
import { isConfigured } from "@/lib/backlinks/client";
import { normaliseBacklinkDomain } from "@/lib/backlinks/domain";
import { syncBacklinkProfile } from "@/lib/backlinks/sync";
import {
    authorizeBacklinkOperation,
    type BacklinkOperation,
} from "@/lib/backlinks/access";

const MODES = [
    "summary",
    "details",
    "sync",
    "gap",
    "target-summary",
    "quality",
    "alerts",
    "stored",
] as const;

type BacklinkMode = typeof MODES[number];

function isBacklinkMode(value: string): value is BacklinkMode {
    return (MODES as readonly string[]).includes(value);
}

function isLiveMode(mode: BacklinkMode): mode is BacklinkOperation {
    return mode === "summary" ||
        mode === "details" ||
        mode === "sync" ||
        mode === "gap" ||
        mode === "target-summary";
}

function pageLimit(value: string | null): number {
    const parsed = Number(value ?? 50);
    return Number.isFinite(parsed) && parsed > 0
        ? Math.min(Math.floor(parsed), 200)
        : 50;
}

async function loadStoredBacklinks(siteId: string, cursor?: string, limit = 50) {
    const items = await prisma.backlinkDetail.findMany({
        where: { siteId },
        orderBy: [{ domainRating: "desc" }, { id: "asc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
            id: true,
            linkKey: true,
            srcDomain: true,
            sourceUrl: true,
            targetUrl: true,
            anchorText: true,
            domainRating: true,
            isDoFollow: true,
            isToxic: true,
            toxicReason: true,
            spamScore: true,
            status: true,
            firstSeen: true,
            lastSeen: true,
        },
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, -1) : items;
    return {
        stored: page,
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
        hasMore,
    };
}

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("siteId");
    const rawMode = searchParams.get("mode") ?? "summary";
    if (!siteId) {
        return NextResponse.json({ error: "siteId is required" }, { status: 400 });
    }
    if (!isBacklinkMode(rawMode)) {
        return NextResponse.json({ error: "Unsupported backlink mode." }, { status: 400 });
    }
    const mode = rawMode;

    const [site, dbUser] = await Promise.all([
        prisma.site.findFirst({
            where: { id: siteId, userId: user.id },
            select: { id: true, domain: true, targetKeyword: true },
        }),
        prisma.user.findUnique({
            where: { id: user.id },
            select: { subscriptionTier: true },
        }),
    ]);
    if (!site) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    // Historical backlink data is a paid feature too. Only live modes consume
    // the daily provider allowance.
    if (isLiveMode(mode)) {
        const access = await authorizeBacklinkOperation(
            user.id,
            dbUser?.subscriptionTier,
            mode,
            isConfigured(),
        );
        if (!access.allowed) {
            return NextResponse.json({ error: access.error }, { status: access.status });
        }
    } else {
        const access = await authorizeBacklinkOperation(
            user.id,
            dbUser?.subscriptionTier,
            "summary",
            false,
        );
        if (!access.allowed) {
            return NextResponse.json({ error: access.error }, { status: access.status });
        }
    }

    try {
        if (searchParams.get("refresh") === "true" && mode !== "sync") {
            await bustBacklinkCache(site.domain);
        }

        switch (mode) {
            case "summary": {
                const summary = await getBacklinkSummary(site.domain, siteId);
                return NextResponse.json({ summary });
            }

            case "details": {
                const limit = pageLimit(searchParams.get("limit"));
                const details = await getBacklinkDetails(site.domain, limit);
                const stored = await analyseAndStoreBacklinks(
                    siteId,
                    details.map((detail) => ({
                        srcDomain: detail.sourceDomain,
                        sourceUrl: detail.sourceUrl,
                        targetUrl: detail.targetUrl,
                        anchorText: detail.anchorText,
                        domainRating: detail.domainRating,
                        isDoFollow: detail.isDoFollow,
                        spamScore: detail.spamScore,
                        firstSeen: detail.firstSeen ? new Date(detail.firstSeen) : undefined,
                        lastSeen: detail.lastSeen ? new Date(detail.lastSeen) : undefined,
                        status: detail.status,
                    })),
                    { targetKeyword: site.targetKeyword },
                );
                return NextResponse.json({ details, stored });
            }

            case "sync": {
                const sync = await syncBacklinkProfile(siteId, site.domain, {
                    targetKeyword: site.targetKeyword,
                });
                const [summary, quality, alerts, stored] = await Promise.all([
                    getBacklinkSummary(site.domain, siteId),
                    getBacklinkQualitySummary(siteId),
                    prisma.backlinkAlert.findMany({
                        where: { siteId },
                        orderBy: { detectedAt: "desc" },
                        take: 50,
                        select: {
                            id: true,
                            type: true,
                            domain: true,
                            url: true,
                            dr: true,
                            detectedAt: true,
                        },
                    }),
                    loadStoredBacklinks(siteId, undefined, 200),
                ]);
                return NextResponse.json({
                    sync,
                    summary,
                    quality,
                    alerts,
                    stored: stored.stored,
                });
            }

            case "gap": {
                const competitor = normaliseBacklinkDomain(searchParams.get("competitor") ?? "");
                if (!competitor) {
                    return NextResponse.json(
                        { error: "Enter a valid competitor domain." },
                        { status: 400 },
                    );
                }
                const report = await getCompetitorBacklinkGap(site.domain, competitor);
                return NextResponse.json({ report });
            }

            case "target-summary": {
                const targetDomain = normaliseBacklinkDomain(searchParams.get("targetDomain") ?? "");
                if (!targetDomain) {
                    return NextResponse.json(
                        { error: "Enter a valid target domain." },
                        { status: 400 },
                    );
                }
                const summary = await getBacklinkSummary(targetDomain);
                return NextResponse.json({ summary });
            }

            case "quality": {
                const quality = await getBacklinkQualitySummary(siteId);
                return NextResponse.json({ quality });
            }

            case "alerts": {
                const alerts = await prisma.backlinkAlert.findMany({
                    where: { siteId },
                    orderBy: { detectedAt: "desc" },
                    take: 50,
                    select: {
                        id: true,
                        type: true,
                        domain: true,
                        url: true,
                        dr: true,
                        detectedAt: true,
                    },
                });
                return NextResponse.json({ alerts });
            }

            case "stored": {
                const cursor = searchParams.get("cursor") ?? undefined;
                return NextResponse.json(await loadStoredBacklinks(siteId, cursor, pageLimit(searchParams.get("limit"))));
            }
        }
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error
                    ? error.message
                    : "Backlink lookup failed. Please try again.",
            },
            { status: 502 },
        );
    }
}
