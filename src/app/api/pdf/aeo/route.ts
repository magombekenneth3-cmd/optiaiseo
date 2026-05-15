import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateAeoReportPdf, type AeoReportPdfData } from "@/lib/pdf/aeo-report";

function aeoGrade(score: number): string {
    if (score >= 90) return "A+";
    if (score >= 80) return "A";
    if (score >= 70) return "B";
    if (score >= 60) return "C";
    if (score >= 50) return "D";
    return "F";
}

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const reportId = req.nextUrl.searchParams.get("reportId");
    if (!reportId) {
        return NextResponse.json({ error: "Missing reportId" }, { status: 400 });
    }

    const report = await prisma.aeoReport.findFirst({
        where: {
            id: reportId,
            site: { userId: session.user.id },
        },
        include: {
            site: { select: { domain: true } },
        },
    });

    if (!report) {
        return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    type RawCheck = { id?: string; label?: string; passed?: boolean; impact?: string; recommendation?: string };
    const checks = (report.checks as RawCheck[] | null) ?? [];
    const recommendations = checks
        .filter((c) => !c.passed && c.recommendation)
        .map((c) => c.recommendation!)
        .slice(0, 8);

    const multiModelResults: Record<string, number> = {};
    const rawReport = report as typeof report & { modelScores?: Record<string, number> };
    const rawModels = rawReport.modelScores ?? null;
    if (rawModels) {
        for (const [model, score] of Object.entries(rawModels)) {
            if (typeof score === "number") multiModelResults[model] = score;
        }
    }

    const score = report.score ?? 0;
    const reportData: AeoReportPdfData = {
        domain: report.site.domain,
        score,
        grade: aeoGrade(score),
        citationScore: (report as unknown as { citationScore?: number }).citationScore ?? score,
        generativeShareOfVoice: (report as unknown as { shareOfVoice?: number }).shareOfVoice ?? 0,
        topRecommendations: recommendations,
        multiModelResults: Object.keys(multiModelResults).length > 0 ? multiModelResults : null,
        trend: "stable",
        projected90Day: Math.min(100, Math.round(score * 1.15)),
        topCompetitorAdvantage: "Run a competitor analysis to see how your AEO visibility compares.",
        createdAt: report.createdAt.toISOString(),
    };

    const pdfBuffer = await generateAeoReportPdf(reportData);
    const filename = `aeo-report-${report.site.domain.replace(/[^a-z0-9]/gi, "-")}-${report.createdAt.toISOString().slice(0, 10)}.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Length": String(pdfBuffer.length),
            "Cache-Control": "private, no-cache",
        },
    });
}
