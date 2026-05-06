export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";

/**
 * GET /api/content-score/decay?siteId=xxx
 *
 * Queries the last 6 months of audit history for a site, compares each audit's
 * categoryScores against the previous one, and surfaces categories that have
 * dropped ≥ 5 points. Returns enriched decay items with urgency classification
 * and actionable recommendations — equivalent to Semrush's Content Decay feature.
 */
export async function GET(req: Request) {
    const user = await getAuthUser(req as import("next/server").NextRequest);
    if (!user) return new NextResponse("Unauthorized", { status: 401 });

    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("siteId");

    if (!siteId) return new NextResponse("siteId required", { status: 400 });

    // Verify ownership
    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user!.id },
        select: { id: true, domain: true },
    });
    if (!site) return new NextResponse("Not found", { status: 404 });

    // Pull last 10 audits ordered newest-first
    const audits = await prisma.audit.findMany({
        where: { siteId },
        orderBy: { runTimestamp: "desc" },
        take: 10,
        select: {
            id: true,
            categoryScores: true,
            runTimestamp: true,
        },
    });

    if (audits.length < 2) {
        // Not enough history to detect decay
        return NextResponse.json({ decayItems: [], message: "Need at least 2 audits to detect decay." });
    }

    // Compare most recent audit vs each historical one to identify drops
    const latest = audits[0];
    const latestScores = (latest.categoryScores as Record<string, number>) ?? {};

    const decayItems: {
        category: string;
        currentScore: number;
        previousScore: number;
        drop: number;
        urgency: "critical" | "high" | "medium" | "low";
        detectedAt: string;
        recommendation: string;
    }[] = [];

    const recommendations: Record<string, string> = {
        technical: "Fix crawl errors, improve page speed, and update your sitemap.",
        content: "Refresh outdated content, add schema markup, and update internal links.",
        onpage: "Improve title tags, meta descriptions, and heading structure.",
        offpage: "Build quality backlinks and improve social signals.",
        local: "Update your Google Business Profile and NAP consistency.",
        accessibility: "Fix ARIA issues, improve color contrast, and add alt text.",
        schema: "Add or fix Schema.org structured data markup.",
        social: "Increase social sharing and engagement signals.",
    };

    // Find the earliest audit that has meaningful score data to compare against
    for (const category of Object.keys(latestScores)) {
        const currentScore = latestScores[category];
        let maxDrop = 0;
        let dropAudit = audits[1]; // default to previous audit

        for (let i = 1; i < audits.length; i++) {
            const historical = (audits[i].categoryScores as Record<string, number>) ?? {};
            if (historical[category] !== undefined) {
                const drop = historical[category] - currentScore;
                if (drop > maxDrop) {
                    maxDrop = drop;
                    dropAudit = audits[i];
                }
            }
        }

        // Only surface categories that dropped 5+ points
        if (maxDrop < 5) continue;

        const historicalScores = (dropAudit.categoryScores as Record<string, number>) ?? {};
        const previousScore = historicalScores[category] ?? currentScore + maxDrop;

        const urgency =
            maxDrop >= 30 ? "critical" :
            maxDrop >= 15 ? "high" :
            maxDrop >= 5  ? "medium" : "low";

        const catKey = category.toLowerCase().replace(/[-\s]/g, "");
        const recKey = Object.keys(recommendations).find(k => catKey.includes(k)) ?? "content";

        decayItems.push({
            category: category.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
            currentScore,
            previousScore,
            drop: Math.round(maxDrop),
            urgency,
            detectedAt: dropAudit.runTimestamp.toISOString(),
            recommendation: recommendations[recKey],
        });
    }

    // Sort by largest drop first
    decayItems.sort((a, b) => b.drop - a.drop);

    return NextResponse.json({
        decayItems,
        auditCount: audits.length,
        latestAuditAt: latest.runTimestamp.toISOString(),
        site: site.domain,
    });
}
