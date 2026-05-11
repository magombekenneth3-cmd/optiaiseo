import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireTiers, guardErrorToResult } from "@/lib/stripe/guards";
import { logger } from "@/lib/logger";
import { generateAeoReportPdf } from "@/lib/pdf/aeo-report";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const reportId = searchParams.get("reportId");

  if (!reportId) {
    return NextResponse.json({ error: "Missing reportId" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, subscriptionTier: true, role: true, whiteLabel: true },
  });
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (dbUser.role !== "AGENCY_ADMIN") {
    try {
        await requireTiers(dbUser.id, ["AGENCY"]);
    } catch (err) {
        return NextResponse.json({ error: guardErrorToResult(err).error }, { status: 403 });
    }
  }

  const report = await prisma.aeoReport.findFirst({
    where: { id: reportId, site: { userId: dbUser.id } },
    select: {
      score: true,
      grade: true,
      citationScore: true,
      generativeShareOfVoice: true,
      topRecommendations: true,
      multiModelResults: true,
      createdAt: true,
      site: { select: { domain: true } },
    },
  });

  if (!report) {
    return NextResponse.json(
      { error: "Report not found or access denied." },
      { status: 404 },
    );
  }

  type ModelMap = Record<string, number>;
  const multiModelResults =
    report.multiModelResults &&
      typeof report.multiModelResults === "object" &&
      !Array.isArray(report.multiModelResults)
      ? (report.multiModelResults as ModelMap)
      : null;

  const wl = (dbUser.whiteLabel as Record<string, string | undefined>) ?? {};

  try {
    const pdf = await generateAeoReportPdf({
      domain: report.site.domain,
      score: report.score,
      grade: report.grade,
      citationScore: report.citationScore,
      generativeShareOfVoice: report.generativeShareOfVoice,
      topRecommendations: report.topRecommendations,
      multiModelResults,
      trend: "stable",
      projected90Day: Math.min(100, Math.round(report.generativeShareOfVoice * 1.1)),
      topCompetitorAdvantage: "Run a visibility forecast for a detailed competitor gap analysis.",
      createdAt: report.createdAt.toISOString(),
      whiteLabel: {
        logoUrl: wl.logoUrl,
        primaryColor: wl.primaryColor,
        companyName: wl.companyName,
        clientName: wl.clientName,
      },
    });

    const filename = `aeo-report-${report.site.domain}-${report.createdAt.toISOString().slice(0, 10)}.pdf`;

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });

  } catch (err: unknown) {
    logger.error("[PDF] AEO report generation failed", {
      reportId,
      error: (err as Error)?.message,
    });
    return NextResponse.json(
      { error: "PDF generation failed. Please try again." },
      { status: 500 },
    );
  }
}