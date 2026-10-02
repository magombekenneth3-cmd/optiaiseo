import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const siteId = url.searchParams.get("siteId");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let resolvedSiteId = siteId;
  if (!resolvedSiteId) {
    const firstSite = await prisma.site.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    resolvedSiteId = firstSite?.id ?? null;
  }

  if (!resolvedSiteId) {
    return NextResponse.json({
      aeoReport: null,
      snapshot: null,
      citations: { thisMonth: 0, total: 0 },
      trend: [],
      diagnosticReadiness: null,
      siteId: null,
      domain: null,
    });
  }

  const site = await prisma.site.findUnique({
    where: { id: resolvedSiteId },
    select: { id: true, domain: true, userId: true },
  });
  if (!site || site.userId !== user.id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [latestReport, latestSnapshot, citationsThisMonth, citationsTotal, trendSnapshots, aiFindingsCount] = await Promise.all([
    prisma.aeoReport.findFirst({
      where: { siteId: resolvedSiteId, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        score: true,
        grade: true,
        citationScore: true,
        citationLikelihood: true,
        generativeShareOfVoice: true,
        schemaTypes: true,
        topRecommendations: true,
        layerScores: true,
        dimensions: true,
        auditConfidence: true,
        createdAt: true,
      },
    }),
    prisma.aeoSnapshot.findFirst({
      where: { siteId: resolvedSiteId },
      orderBy: { createdAt: "desc" },
      select: {
        score: true,
        grade: true,
        citationScore: true,
        generativeShareOfVoice: true,
        citationLikelihood: true,
        perplexityScore: true,
        chatgptScore: true,
        claudeScore: true,
        googleAioScore: true,
        grokScore: true,
        copilotScore: true,
        technicalReadiness: true,
        contentReadiness: true,
        aiVisibility: true,
        citationQuality: true,
        confidenceLevel: true,
        confidenceScore: true,
        successfulProviders: true,
        totalProviders: true,
        failedChecks: true,
        createdAt: true,
      },
    }),
    prisma.aeoEvent.count({
      where: { siteId: resolvedSiteId, eventType: "CITED", createdAt: { gte: startOfMonth } },
    }),
    prisma.aeoEvent.count({
      where: { siteId: resolvedSiteId, eventType: "CITED" },
    }),
    prisma.aeoSnapshot.findMany({
      where: { siteId: resolvedSiteId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        score: true,
        citationScore: true,
        technicalReadiness: true,
        contentReadiness: true,
        aiVisibility: true,
        citationQuality: true,
        createdAt: true,
      },
    }),
    prisma.diagnosticFindingRecord.count({
      where: {
        siteId: resolvedSiteId,
        lifecycleState: { not: "RESOLVED" },
        issueType: {
          in: [
            "MISSING_SCHEMA_MARKUP",
            "THIN_CONTENT",
            "MISSING_FAQ",
            "MISSING_HOWTO",
            "POOR_ENTITY_COVERAGE",
            "MISSING_AUTHOR_MARKUP",
            "MISSING_ORGANIZATION_SCHEMA",
            "LOW_CONTENT_DEPTH",
            "MISSING_STRUCTURED_DATA",
          ],
        },
      },
    }),
  ]);

  type LayerScoresShape = { aeo?: number; geo?: number; aio?: number } | null;
  type DimensionsShape = { technicalReadiness?: number; contentReadiness?: number; aiVisibility?: number; citationQuality?: number } | null;
  type ConfidenceShape = { level?: string; score?: number; successfulProviders?: number; totalProviders?: number } | null;

  const reportLayerScores = latestReport?.layerScores as LayerScoresShape;
  const reportDimensions = latestReport?.dimensions as DimensionsShape;
  const reportConfidence = latestReport?.auditConfidence as ConfidenceShape;

  const aeoReport = latestReport ? {
    score: latestReport.score,
    grade: latestReport.grade,
    citationScore: latestReport.citationScore,
    citationLikelihood: latestReport.citationLikelihood,
    generativeShareOfVoice: latestReport.generativeShareOfVoice,
    schemaTypes: latestReport.schemaTypes,
    topRecommendations: latestReport.topRecommendations,
    layerScores: reportLayerScores ?? null,
    dimensions: reportDimensions ?? null,
    confidence: reportConfidence ?? null,
    createdAt: latestReport.createdAt,
  } : null;

  const snapshot = latestSnapshot ? {
    score: latestSnapshot.score,
    grade: latestSnapshot.grade,
    citationScore: latestSnapshot.citationScore,
    generativeShareOfVoice: latestSnapshot.generativeShareOfVoice,
    citationLikelihood: latestSnapshot.citationLikelihood,
    platforms: {
      perplexity: latestSnapshot.perplexityScore,
      chatgpt: latestSnapshot.chatgptScore,
      claude: latestSnapshot.claudeScore,
      googleAio: latestSnapshot.googleAioScore,
      grok: latestSnapshot.grokScore,
      copilot: latestSnapshot.copilotScore,
    },
    dimensions: {
      technicalReadiness: latestSnapshot.technicalReadiness,
      contentReadiness: latestSnapshot.contentReadiness,
      aiVisibility: latestSnapshot.aiVisibility,
      citationQuality: latestSnapshot.citationQuality,
    },
    confidence: {
      level: latestSnapshot.confidenceLevel,
      score: latestSnapshot.confidenceScore,
      successfulProviders: latestSnapshot.successfulProviders,
      totalProviders: latestSnapshot.totalProviders,
    },
    failedChecks: latestSnapshot.failedChecks,
    createdAt: latestSnapshot.createdAt,
  } : null;

  const trend = trendSnapshots.reverse().map((s) => ({
    score: s.score,
    citationScore: s.citationScore,
    technicalReadiness: s.technicalReadiness,
    contentReadiness: s.contentReadiness,
    aiVisibility: s.aiVisibility,
    citationQuality: s.citationQuality,
    createdAt: s.createdAt,
  }));

  const diagnosticReadiness = aiFindingsCount > 0 ? {
    unresolvedAiFindings: aiFindingsCount,
  } : null;

  return NextResponse.json({
    aeoReport,
    snapshot,
    citations: { thisMonth: citationsThisMonth, total: citationsTotal },
    trend,
    diagnosticReadiness,
    siteId: resolvedSiteId,
    domain: site.domain,
  });
}
