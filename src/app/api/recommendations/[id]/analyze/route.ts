import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(
    _req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const limited = await rateLimit("competitorAnalyse", session.user.id);
        if (limited) {
            return limited;
        }

        const { id: decisionId } = await context.params;

        // 1. Fetch decision with ownership check
        const decision = await prisma.growthDecision.findUnique({
            where: { id: decisionId },
            include: {
                site: { select: { id: true, userId: true } },
            },
        });

        if (!decision || decision.site.userId !== session.user.id) {
            return NextResponse.json({ error: "Recommendation not found or unauthorized" }, { status: 404 });
        }

        // 2. Check if a recent analysis already exists (within 24 hours)
        const oneDayAgo = new Date();
        oneDayAgo.setHours(oneDayAgo.getHours() - 24);

        const existing = await prisma.serpGapAnalysis.findFirst({
            where: {
                siteId: decision.siteId,
                keyword: decision.primaryKeyword,
                createdAt: { gte: oneDayAgo },
                status: { in: ["PENDING", "SCRAPING", "PLANNING", "COMPLETED"] },
            },
            orderBy: { createdAt: "desc" },
        });

        if (existing) {
            return NextResponse.json({
                analysisId: existing.id,
                status: existing.status,
                message: existing.status === "COMPLETED"
                    ? "Analysis already completed within the last 24 hours."
                    : "Analysis already in progress.",
                alreadyExists: true,
            });
        }

        const parsedWhyNow = typeof decision.whyNow === "string"
            ? (() => { try { return JSON.parse(decision.whyNow); } catch { return null; } })()
            : (decision.whyNow as Record<string, any> | null);
        const rawPos = parsedWhyNow?.gscMetrics?.position;
        const resolvedPosition = typeof rawPos === "number" && Number.isFinite(rawPos) && rawPos > 0
            ? Math.round(rawPos)
            : 15;

        const analysis = await prisma.serpGapAnalysis.create({
            data: {
                siteId: decision.siteId,
                userId: session.user.id,
                keyword: decision.primaryKeyword,
                clientUrl: decision.url,
                clientPosition: resolvedPosition,
                status: "PENDING",
                autoQueued: true,
            },
        });

        // 4. Fire Inngest event
        await inngest.send({
            name: "serp-gap/requested",
            data: {
                siteId: decision.siteId,
                userId: session.user.id,
                keyword: decision.primaryKeyword,
                clientUrl: decision.url,
                clientPosition: analysis.clientPosition,
                analysisId: analysis.id,
            },
        });

        logger.info("[RecommendationsAPI] SERP gap analysis triggered from workspace", {
            decisionId,
            analysisId: analysis.id,
            keyword: decision.primaryKeyword,
        });

        return NextResponse.json({
            analysisId: analysis.id,
            status: "PENDING",
            message: "SERP gap analysis started. Results will appear shortly.",
            alreadyExists: false,
        });
    } catch (err: unknown) {
        logger.error("[RecommendationsAPI] Analyze trigger failed", { error: (err as Error)?.message || String(err) });
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
