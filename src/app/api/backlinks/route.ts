export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import {
    getBacklinkSummary,
    getBacklinkDetails,
    getCompetitorBacklinkGap,
} from "@/lib/backlinks/index";
import { getBacklinkQualitySummary } from "@/lib/backlinks/quality-analysis";
import { analyseAndStoreBacklinks } from "@/lib/backlinks/quality-analysis";
import { bustBacklinkCache } from "@/lib/backlinks/cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { hasFeature } from "@/lib/stripe/plans";
import prisma from "@/lib/prisma";

// ─── Per-mode rate limits (live DataForSEO calls only) ────────────────────────
// DB-read modes (quality / alerts / stored) are free — no rate limit applied.
const RATE_LIMITS: Record<string, { key: (uid: string) => string; max: number }> = {
    summary: { key: (uid) => `backlinks:summary:${uid}`, max: 20 },
    details: { key: (uid) => `backlinks:details:${uid}`, max: 10 },
    gap:     { key: (uid) => `backlinks:gap:${uid}`,     max: 5  },
};

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("siteId");
    const mode   = searchParams.get("mode") ?? "summary";

    if (!siteId) {
        return NextResponse.json({ error: "siteId is required" }, { status: 400 });
    }

    const site = await prisma.site.findUnique({
        where:  { id: siteId, userId: user.id },
        select: { id: true, domain: true },
    });

    if (!site) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    // ── Paywall: live DataForSEO modes require Pro or higher ─────────────────
    const isLiveMode = ["summary", "details", "gap"].includes(mode);
    if (isLiveMode) {
        const dbUser = await prisma.user.findUnique({
            where:  { id: user.id },
            select: { subscriptionTier: true },
        });
        if (!hasFeature(dbUser?.subscriptionTier ?? "FREE", "backlinks")) {
            return NextResponse.json(
                { error: "Backlink monitoring requires a Pro plan." },
                { status: 403 },
            );
        }
    }

    // Optional cache-bust — user clicked "Refresh" explicitly
    if (searchParams.get("refresh") === "true") {
        await bustBacklinkCache(site.domain);
    }

    // Rate-limit live DataForSEO modes only
    const limitConfig = RATE_LIMITS[mode];
    if (limitConfig) {
        const rl = await checkRateLimit(limitConfig.key(user.id), limitConfig.max, 86400);
        if (!rl.allowed) {
            return NextResponse.json(
                { error: "Rate limit exceeded. Try again tomorrow.", remaining: 0 },
                { status: 429 },
            );
        }
    }
    // quality / alerts / stored: fall through with no rate limit check

    switch (mode) {
        case "details": {
            const details = await getBacklinkDetails(site.domain);

            // Persist immediately — don't let the live data evaporate
            if (details.length > 0) {
                await analyseAndStoreBacklinks(
                    siteId,
                    details.map(d => ({
                        srcDomain:    (() => {
                            try { return new URL(d.sourceUrl).hostname; }
                            catch { return d.sourceUrl; }
                        })(),
                        anchorText:   d.anchorText,
                        domainRating: d.domainRating,
                        isDoFollow:   true,
                        targetUrl:    d.targetUrl,
                        firstSeen:    d.firstSeen ? new Date(d.firstSeen) : undefined,  // Bug 2
                    }))
                );
            }

            return NextResponse.json({ details });
        }

        case "gap": {
            const competitor = searchParams.get("competitor");
            if (!competitor) {
                return NextResponse.json(
                    { error: "competitor query param required for gap mode" },
                    { status: 400 },
                );
            }
            const report = await getCompetitorBacklinkGap(site.domain, competitor);
            return NextResponse.json({ report });
        }

        // DB-read: quality breakdown — no DataForSEO cost
        case "quality": {
            const quality = await getBacklinkQualitySummary(siteId);
            return NextResponse.json({ quality });
        }

        // DB-read: recent gained/lost alerts
        case "alerts": {
            const alerts = await prisma.backlinkAlert.findMany({
                where:   { siteId },
                orderBy: { detectedAt: "desc" },
                take:    50,
                select: {
                    id: true, type: true, domain: true, dr: true, detectedAt: true,
                },
            });
            return NextResponse.json({ alerts });
        }

        // DB-read: stored referring domains with cursor-based pagination
        case "stored": {
            const cursor = searchParams.get("cursor") ?? undefined;
            const limit  = Math.min(Number(searchParams.get("limit") ?? 50), 200);

            const items = await prisma.backlinkDetail.findMany({
                where:   { siteId },
                orderBy: { domainRating: "desc" },
                take:    limit + 1,   // fetch one extra to detect whether there's a next page
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                select: {
                    id:           true,
                    srcDomain:    true,
                    anchorText:   true,
                    domainRating: true,
                    isDoFollow:   true,
                    isToxic:      true,
                    toxicReason:  true,
                    firstSeen:    true,
                    lastSeen:     true,
                },
            });

            const hasMore    = items.length > limit;
            const page       = hasMore ? items.slice(0, -1) : items;
            const nextCursor = hasMore ? page[page.length - 1].id : null;

            return NextResponse.json({ stored: page, nextCursor, hasMore });
        }

        default: {
            // Pass siteId so the toxic count is read from the DB
            const summary = await getBacklinkSummary(site.domain, siteId);
            return NextResponse.json({ summary });
        }
    }
}