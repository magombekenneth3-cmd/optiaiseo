import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const proposal = await (prisma as any).actionProposal.findUnique({
      where: { id },
      include: {
        decision: {
          select: {
            id: true,
            url: true,
            primaryKeyword: true,
            action: true,
            opportunityStatus: true,
            score: true,
            whyNow: true,
            category: true,
            discoveryConfidence: true,
            sourceFindings: {
              include: {
                finding: {
                  select: {
                    id: true,
                    type: true,
                    severity: true,
                    confidence: true,
                    title: true,
                    description: true,
                  },
                },
              },
              take: 10,
            },
            scoreRecords: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                finalScore: true,
                impactScore: true,
                confidenceScore: true,
                urgencyScore: true,
                decision: true,
                scoringVersion: true,
              },
            },
          },
        },
        operation: {
          select: {
            id: true,
            status: true,
            mutationType: true,
            riskLevel: true,
            riskScore: true,
            createdAt: true,
            completedAt: true,
          },
        },
      },
    });

    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }

    // Verify site ownership
    const site = await prisma.site.findFirst({
      where: { id: proposal.siteId, userId },
      select: { id: true },
    });
    if (!site) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Extract safe LLM metadata — never expose chain-of-thought
    const llmMeta = proposal.metadata?.llm ?? null;
    const safeMetadata = llmMeta
      ? {
          outcome: llmMeta.outcome,
          confidence: llmMeta.confidence,
          fallbackUsed: llmMeta.fallbackUsed ?? false,
          validationVerdict: llmMeta.validationVerdict,
          promptVersion: llmMeta.promptVersion,
          timestamp: llmMeta.timestamp,
        }
      : null;

    // Build enriched response
    const enriched = {
      ...proposal,
      // Replace raw metadata with safe subset
      metadata: undefined,
      llm: safeMetadata,
      isAiEnhanced: safeMetadata?.outcome === "ENHANCED",
      // Score breakdown from decision
      scoreBreakdown: proposal.decision?.scoreRecords?.[0] ?? null,
      // Evidence from decision source findings
      evidence: (proposal.decision?.sourceFindings ?? []).map((sf: any) => ({
        id: sf.finding.id,
        type: sf.finding.type,
        severity: sf.finding.severity,
        confidence: sf.finding.confidence,
        title: sf.finding.title,
        description: sf.finding.description,
      })),
    };

    return NextResponse.json({ proposal: enriched });
  } catch (err: unknown) {
    logger.error("[ProposalsAPI] GET /api/proposals/[id] failed", {
      id,
      error: (err as Error)?.message,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
