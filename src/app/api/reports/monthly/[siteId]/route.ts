/**
 * src/app/api/reports/monthly/[siteId]/route.ts
 *
 * GET /api/reports/monthly/<siteId>
 * Starter tier and above. Returns a Puppeteer-rendered monthly PDF report.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { limiters } from "@/lib/rate-limit";
import { generateMonthlyReportPdf } from "@/lib/pdf/monthly-report";
import { logger } from "@/lib/logger";
import { hasFeature } from "@/lib/stripe/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // puppeteer needs headroom on Vercel


/** Derive a 0–100 score from the Audit.categoryScores JSON field. */
function deriveScore(categoryScores: unknown): number {
    if (!categoryScores || typeof categoryScores !== "object") return 0;
    const vals = Object.values(categoryScores as Record<string, unknown>)
        .map((v) => (typeof v === "number" ? v : 0));
    if (!vals.length) return 0;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}


export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ siteId: string }> },
) {
    void req;
    const { siteId } = await params;

    const user = await getAuthUser(req);
    if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await limiters.pdfReport.limit(
        `pdf-report:${user!.id ?? user!.email}`,
    );
    if (!rl.success) {
        return NextResponse.json(
            { error: "Too many requests — try again later" },
            { status: 429 },
        );
    }

    const dbUser = await prisma.user.findUnique({
        where: { email: user!.email },
        select: { id: true, subscriptionTier: true, whiteLabel: true },
    });
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!hasFeature(user!.subscriptionTier ?? "FREE", "emailReports")) {
        return NextResponse.json(
            { error: "Upgrade to Starter or above to download reports" },
            { status: 403 },
        );
    }

    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user!.id },
        select: { id: true, domain: true },
    });
    if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });

    try {
        const [latestAudit, prevAudit, latestAeo, snapshots] = await Promise.all([
            prisma.audit.findFirst({
                where: { siteId: site.id },
                orderBy: { runTimestamp: "desc" },
                select: { categoryScores: true },
            }),
            prisma.audit.findFirst({
                where: { siteId: site.id },
                orderBy: { runTimestamp: "desc" },
                skip: 1,
                select: { categoryScores: true },
            }),
            prisma.aeoReport.findFirst({
                where: { siteId: site.id },
                orderBy: { createdAt: "desc" },
                select: { score: true },
            }),
            prisma.rankSnapshot.findMany({
                where: {
                    siteId: site.id,
                    trackedId: { not: null },
                    recordedAt: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
                },
                orderBy: { recordedAt: "desc" },
                select: { keyword: true, position: true },
            }),
        ]);

        const seoScore = deriveScore(latestAudit?.categoryScores);
        const prevSeoScore = prevAudit ? deriveScore(prevAudit.categoryScores) : null;
        const month = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
        const topKeywords = snapshots.slice(0, 10).map((s) => ({
            keyword: s.keyword,
            position: s.position,
            change: 0,
        }));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wl = (dbUser?.whiteLabel as any) ?? {};

        const pdf = await generateMonthlyReportPdf({
            domain: site.domain,
            month,
            seoScore,
            prevSeoScore,
            aeoScore: latestAeo?.score ?? 0,
            keywordsTracked: snapshots.length,
            keywordsImproved: 0,
            keywordsDeclined: 0,
            issuesFixed: 0,
            issuesPending: 0,
            topKeywords,
            competitorSummary: [],
            whiteLabel: {
                logoUrl: wl.logoUrl,
                primaryColor: wl.primaryColor,
                companyName: wl.companyName,
                clientName: wl.clientName,
            },
        });

        logger.info("[MonthlyReport] Served PDF", {
            userId: user!.id,
            siteId: site.id,
            bytes: pdf.length,
        });

        const filename = `seo-report-${site.domain}-${month.replace(" ", "-")}.pdf`;

        // `pdf` is a plain Node Buffer — new Uint8Array(pdf) is the correct,
        // type-safe way to pass it to NextResponse (avoids the fragile
        // pdf.buffer.slice(byteOffset, ...) dance that breaks on Buffer views).
        return new NextResponse(new Uint8Array(pdf), {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${filename}"`,
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        });

    } catch (err: unknown) {
        logger.error("[MonthlyReport] PDF generation failed", {
            userId: user!.id,
            siteId: site.id,
            error: (err as Error)?.message,
            stack: (err as Error)?.stack?.split("\n").slice(0, 4).join(" | "),
        });
        return NextResponse.json({ error: "Report generation failed" }, { status: 500 });
    }
}
