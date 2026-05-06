"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { extractAuditMetrics } from "@/lib/audit/helpers";

const LOW_VISIBILITY_THRESHOLD = 50;

export interface VoiceMetrics {
  seoHealth: number | null;
  aiVisibility: number | null;
  insights: Array<{ title: string; description: string; type: "seo" | "aeo" | "content" }>;
  recommendedActions: string[];
}

const EMPTY: VoiceMetrics = { seoHealth: null, aiVisibility: null, insights: [], recommendedActions: [] };

export async function getVoiceMetrics(domain?: string | null): Promise<VoiceMetrics> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return EMPTY;

  const userId = session.user.id;

  const site = domain
    ? await prisma.site.findFirst({ where: { userId, domain } })
    : await prisma.site.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });

  if (!site) return EMPTY;

  const [latestAudit, latestAeoSnapshot, latestAeoReport] = await Promise.all([
    prisma.audit.findFirst({
      where: { siteId: site.id },
      orderBy: { runTimestamp: "desc" },
    }),
    prisma.aeoSnapshot.findFirst({
      where: { siteId: site.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.aeoReport.findFirst({
      where: { siteId: site.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  let seoHealth: number | null = null;

  const aiVisibility: number | null =
    latestAeoSnapshot?.generativeShareOfVoice ??
    latestAeoReport?.generativeShareOfVoice ??
    null;

  const insights: VoiceMetrics["insights"] = [];

  const recommendedActions: string[] = Array.isArray(latestAeoReport?.topRecommendations)
    ? (latestAeoReport!.topRecommendations as string[])
    : [];

  if (latestAudit) {
    const { seoScore, issueCount } = extractAuditMetrics({
      categoryScores: latestAudit.categoryScores as Record<string, unknown> | null,
      issueList: latestAudit.issueList,
    });

    seoHealth = Math.max(0, Math.min(100, seoScore));

    insights.push(
      issueCount > 0
        ? {
          title: "SEO Issues Detected",
          description: `We found ${issueCount} technical issues holding back your search performance. Check your latest audit to resolve them.`,
          type: "seo",
        }
        : {
          title: "Excellent Technical SEO",
          description: "Your site is free of critical technical issues.",
          type: "seo",
        }
    );
  }

  if (latestAeoSnapshot) {
    const gsv = latestAeoSnapshot.generativeShareOfVoice;

    insights.push(
      gsv < LOW_VISIBILITY_THRESHOLD
        ? {
          title: "Low AI Visibility",
          description: `Your brand appears in only ${gsv}% of AI searches. Focus on Answer Engine Optimization.`,
          type: "aeo",
        }
        : {
          title: "Strong AI Visibility",
          description: `Your brand is being recommended frequently, with a GSoV of ${gsv}%. Keep it up!`,
          type: "aeo",
        }
    );
  }

  if (recommendedActions.length === 0) {
    recommendedActions.push("Run a new Audit", "Generate an SEO Blog", "Check Competitor Gaps");
  }

  return {
    seoHealth,
    aiVisibility,
    insights: insights.slice(0, 3),
    recommendedActions: recommendedActions.slice(0, 3),
  };
}