import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const blog = await prisma.blog.findFirst({
        where: {
            id,
            site: { userId: session.user.id },
        },
        select: {
            id: true,
            title: true,
            evidenceCoverage: true,
        },
    });

    if (!blog) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [artifacts, claims] = await Promise.all([
        prisma.researchArtifact.findMany({
            where: { blogId: blog.id },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
                id: true,
                sourceType: true,
                retrievedAt: true,
                confidence: true,
                metadata: true,
                evidenceItems: {
                    select: {
                        id: true,
                        sourceType: true,
                        content: true,
                        extractedClaim: true,
                        confidence: true,
                        metadata: true,
                        createdAt: true,
                    },
                },
            },
        }),
        prisma.blogClaim.findMany({
            where: { blogId: blog.id },
            orderBy: { position: "asc" },
            select: {
                id: true,
                text: true,
                type: true,
                status: true,
                sectionId: true,
                position: true,
            },
        }),
    ]);

    const artifact = artifacts[0] ?? null;
    const meta = artifact?.metadata as Record<string, unknown> | null;

    const bySourceType: Record<string, number> = {};
    for (const item of artifact?.evidenceItems ?? []) {
        bySourceType[item.sourceType] = (bySourceType[item.sourceType] ?? 0) + 1;
    }

    return NextResponse.json({
        blogId: blog.id,
        title: blog.title,
        evidenceCoverage: blog.evidenceCoverage,
        hasLedger: artifact !== null,
        ledger: artifact
            ? {
                  id: artifact.id,
                  collectedAt: artifact.retrievedAt,
                  topic: meta?.topic ?? null,
                  searchIntent: meta?.searchIntent ?? null,
                  serpObservations: meta?.serpObservations ?? 0,
                  competitorObservations: meta?.competitorObservations ?? 0,
                  gscObservations: meta?.gscObservations ?? 0,
                  firstPartyContext: meta?.firstPartyContext ?? null,
                  evidenceItems: artifact.evidenceItems.map((item) => {
                      const m = item.metadata as Record<string, unknown> | null;
                      return {
                          id: item.id,
                          sourceType: item.sourceType,
                          content: item.content,
                          excerpt: item.extractedClaim,
                          confidence: item.confidence,
                          capturedAt: m?.capturedAt ?? null,
                          retrievalMethod: m?.retrievalMethod ?? null,
                          sourceUrl: m?.sourceUrl ?? null,
                          sourceTitle: m?.sourceTitle ?? null,
                          sourcePublisher: m?.sourcePublisher ?? null,
                          category: m?.category ?? null,
                      };
                  }),
                  bySourceType,
                  summary: {
                      totalItems: artifact.evidenceItems.length,
                      hasFirstPartyExperience: (bySourceType["FIRST_PARTY_EXPERIENCE"] ?? 0) > 0,
                      hasFirstPartyData: (bySourceType["FIRST_PARTY_DATA"] ?? 0) > 0,
                      hasGscData: (bySourceType["GSC_DATA"] ?? 0) > 0,
                      hasSerpObservations: (bySourceType["SERP_OBSERVATION"] ?? 0) > 0,
                      hasExternalSources: (bySourceType["EXTERNAL_SOURCE"] ?? 0) > 0,
                  },
              }
            : null,
        claims,
    });
}
