export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import prisma from "@/lib/prisma";
import { sendAeoWeeklyDigest } from "@/lib/email/aeo-alert";
import { logger } from "@/lib/logger";

type DigestSite = {
  id: string;
  domain: string;
  aeoDigestEnabled: boolean;
  user: { email: string | null };
  aeoReports: Array<{
    score: number;
    generativeShareOfVoice: number;
    topRecommendations: string[];
    createdAt: Date;
  }>;
  aiShareOfVoice: Array<{
    keyword: string;
    brandMentioned: boolean;
    recordedAt: Date;
  }>;
};

function buildDigestData(site: DigestSite) {
  const [current, previous] = site.aeoReports;
  if (!current) return null;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentSov = site.aiShareOfVoice.filter((s) => s.recordedAt >= sevenDaysAgo);
  const olderSov = site.aiShareOfVoice.filter((s) => s.recordedAt < sevenDaysAgo);

  const recentMentioned = new Set(recentSov.filter((s) => s.brandMentioned).map((s) => s.keyword));
  const olderMentioned = new Set(olderSov.filter((s) => s.brandMentioned).map((s) => s.keyword));
  const olderNotMentioned = new Set(olderSov.filter((s) => !s.brandMentioned).map((s) => s.keyword));

  const gainedQueries = [...recentMentioned].filter((k) => olderNotMentioned.has(k));
  const lostQueries = [...olderMentioned].filter((k) =>
    recentSov.some((s) => s.keyword === k && !s.brandMentioned)
  );

  const recentTotal = recentSov.length;
  const recentMentionedCount = recentSov.filter((s) => s.brandMentioned).length;
  const gSovPct = recentTotal > 0 ? Math.round((recentMentionedCount / recentTotal) * 100) : current.generativeShareOfVoice;

  const olderTotal = olderSov.length;
  const olderMentionedCount = olderSov.filter((s) => s.brandMentioned).length;
  const previousGSovPct = olderTotal > 0 ? Math.round((olderMentionedCount / olderTotal) * 100) : (previous?.generativeShareOfVoice ?? gSovPct);

  return {
    domain: site.domain,
    currentScore: current.score,
    previousScore: previous?.score ?? current.score,
    gSovPct,
    previousGSovPct,
    gainedQueries,
    lostQueries,
    topFix: current.topRecommendations[0] ?? null,
    siteId: site.id,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const today = new Date();
  if (today.getDay() !== 1) {
    return NextResponse.json({ skipped: true, reason: "not_monday" });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const sites = await prisma.site.findMany({
    where: {
      aeoDigestEnabled: true,
      user: { subscriptionTier: { in: ["PRO", "AGENCY"] } },
    },
    select: {
      id: true,
      domain: true,
      aeoDigestEnabled: true,
      user: { select: { email: true } },
      aeoReports: {
        where: { status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        take: 2,
        select: { score: true, generativeShareOfVoice: true, topRecommendations: true, createdAt: true },
      },
      aiShareOfVoice: {
        where: { recordedAt: { gte: fourteenDaysAgo } },
        select: { keyword: true, brandMentioned: true, recordedAt: true },
        orderBy: { recordedAt: "desc" },
      },
    },
  });

  let sent = 0;
  let skipped = 0;

  await Promise.allSettled(
    sites
      .filter((s) => s.user.email !== null)
      .map(async (site) => {
        const data = buildDigestData(site as DigestSite);
        if (!data) { skipped++; return; }

        const result = await sendAeoWeeklyDigest(site.user.email as string, data);
        if (result.success) { sent++; } else { skipped++; logger.warn("[Digest] Failed for site", { siteId: site.id, error: result.error }); }
      })
  );

  return NextResponse.json({ success: true, sent, skipped });
}
