export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { checkRateLimit } from "@/lib/rate-limit";

const trackSchema = z.object({
  siteId: z.string().cuid(),
  blogId: z.string().cuid().optional().nullable(),
  eventType: z.enum(["CTA_CLICK", "PAGE_VIEW", "FORM_SUBMIT", "CONVERSION"]),
  intent: z.string().max(200).optional().nullable(),
  revenue: z.number().min(0).max(1_000_000).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * GET /api/aeo/track
 * Pixel-style tracking endpoint embedded in blog CTAs.
 * Intentionally unauthenticated (fires from end-user browsers) — protected
 * by: IP rate-limit (60 req/min), CUID format validation, and a DB
 * ownership guard that ensures siteId belongs to a real site.
 */
export async function GET(req: NextRequest) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const rl = await checkRateLimit(`track:${ip}`, 60, 60);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const { searchParams } = new URL(req.url);
    const rawRedirect = searchParams.get("redirect") || "/";
    const SAFE_PATH = /^\/[a-zA-Z0-9/_\-?=&#%]*$/;
    const redirectUrl = SAFE_PATH.test(rawRedirect) ? rawRedirect : "/";
    const rawSiteId = searchParams.get("siteId");

    if (!rawSiteId || !/^c[a-z0-9]{24}$/.test(rawSiteId)) {
        return NextResponse.redirect(new URL(redirectUrl, req.url));
    }

    const site = await prisma.site.findUnique({ where: { id: rawSiteId }, select: { id: true } });
    if (!site) return NextResponse.json({ error: "Invalid site" }, { status: 404 });

    const blogId = searchParams.get("blogId");
    const eventType = searchParams.get("eventType") || "CTA_CLICK";
    const intent = searchParams.get("intent");
    const revenue = searchParams.get("revenue");

    try {
        await prisma.aeoEvent.create({
            data: {
                siteId: rawSiteId,
                blogId,
                eventType,
                intent,
                revenue: revenue ? parseFloat(revenue) : null,
                metadata: {
                    userAgent: req.headers.get("user-agent"),
                    referrer: req.headers.get("referer"),
                    targetUrl: redirectUrl,
                } as object,
            },
        });
     
     
    } catch (error: unknown) {
        logger.error("[AEO Track] Failed to log event:", { error: (error as Error).message || error });
    }

    // Always redirect, even if logging fails
    return NextResponse.redirect(new URL(redirectUrl, req.url));
}

/**
 * POST /api/aeo/track
 * Structured tracking for more complex events (e.g., form submits).
 * Requires authentication — the siteId must belong to the calling user.
 */
export async function POST(req: NextRequest) {
    // Auth check first — POST contains richer data and must be authenticated
    const user = await getAuthUser(req);
    if (!user!.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const rl = await checkRateLimit(`track:${ip}`, 60, 60);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    try {
        const body = await req.json();
        const parsed = trackSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
        const { siteId, blogId, eventType, intent, revenue, metadata } = parsed.data;

        // Ownership guard: ensure the site belongs to the calling user
        const site = await prisma.site.findUnique({
            where: { id: siteId },
            select: { id: true, userId: true },
        });
        if (!site) return NextResponse.json({ error: "Invalid site" }, { status: 404 });
        if (site.userId !== user!.id) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const event = await prisma.aeoEvent.create({
            data: {
                siteId,
                blogId,
                eventType,
                intent,
                revenue: revenue ?? null,
                metadata: (metadata || {}) as object,
            },
        });

         
        return NextResponse.json({ success: true, eventId: event.id });
     
    } catch (error: unknown) {
        logger.error("[AEO Track] Error:", { error: (error as Error).message || error });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
