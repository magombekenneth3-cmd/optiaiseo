/**
 * POST /api/blogs/serp-gate
 *
 * UX preflight: fetches SERP, classifies format, evaluates the gate,
 * stores the result in Redis, and returns a preflightId.
 *
 * This route is INFORMATIONAL — enforcement lives in the server actions.
 * No credits are consumed here.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { fetchGoogleSerp, classifySerpFormat } from "@/lib/blog/serp";
import {
    evaluateSerpIntentGate,
    storeSerpPreflight,
} from "@/lib/blog/serp-gate";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
    try {
        const user = await getAuthUser(req);
        if (!user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json().catch(() => ({})) as {
            keyword?: string;
            siteId?: string;
        };

        const keyword = (body.keyword ?? "").trim();
        if (!keyword || keyword.length > 300) {
            return NextResponse.json({ error: "keyword is required (max 300 chars)" }, { status: 400 });
        }

        // Resolve siteId — needed for the preflight record
        const dbUser = await prisma.user.findUnique({
            where: { email: user.email },
            select: { id: true },
        });
        if (!dbUser) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        const siteId = body.siteId
            ? (await prisma.site.findFirst({
                  where: { id: body.siteId, userId: dbUser.id },
                  select: { id: true },
              }))?.id
            : (await prisma.site.findFirst({
                  where: { userId: dbUser.id },
                  orderBy: { createdAt: "desc" },
                  select: { id: true },
              }))?.id;

        if (!siteId) {
            return NextResponse.json({ error: "No site found" }, { status: 404 });
        }

        // Check Serper key early — avoids a useless network call
        if (!process.env.SERPER_API_KEY) {
            logger.warn("[SerpGate] SERPER_API_KEY not set — returning SKIP");
            return NextResponse.json({
                decision: { verdict: "SKIP", reason: "SERP_NOT_CONFIGURED" },
                preflightId: null,
                keyword,
                checkedAt: new Date().toISOString(),
            });
        }

        // I/O: fetch SERP and classify
        const { organic } = await fetchGoogleSerp(keyword, 7);

        if (organic.length === 0) {
            logger.info(`[SerpGate] No SERP results for "${keyword}" — SKIP`);
            return NextResponse.json({
                decision: { verdict: "SKIP", reason: "SERP_NO_RESULTS" },
                preflightId: null,
                keyword,
                checkedAt: new Date().toISOString(),
            });
        }

        const signal = classifySerpFormat(organic);

        // PURE: evaluate the gate decision
        const decision = evaluateSerpIntentGate(signal);

        const checkedAt = new Date().toISOString();

        // Store in Redis for server-side enforcement
        const preflightId = await storeSerpPreflight({
            userId: dbUser.id,
            siteId,
            keyword,
            signal,
            decision,
            checkedAt,
        });

        logger.info(`[SerpGate] Preflight for "${keyword}": ${decision.verdict}`, {
            format: signal.format,
            confidence: signal.confidence,
            preflightId,
        });

        return NextResponse.json({
            decision,
            preflightId,
            keyword,
            checkedAt,
            signal: { format: signal.format, confidence: signal.confidence, reasoning: signal.reasoning },
        });

    } catch (err: unknown) {
        const message = (err as Error)?.message ?? String(err);
        logger.error("[SerpGate] Unhandled error:", { error: message });

        // Fail-open: unexpected errors produce SKIP so generation isn't blocked
        return NextResponse.json({
            decision: { verdict: "SKIP", reason: "SERP_PROVIDER_UNAVAILABLE" },
            preflightId: null,
            checkedAt: new Date().toISOString(),
        });
    }
}
